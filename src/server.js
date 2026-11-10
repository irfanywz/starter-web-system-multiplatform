import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config, root } from './config.js';
import { db } from './db.js';
import { createRouter, sendJson, readJson, parseCookies, JsonError } from './http.js';
import { verifyPassword, newToken, hashToken, randomPassword } from './security.js';
import * as accounts from './accounts.js';
import * as jobs from './exec.js';
import { systemInfo } from './system.js';

const COOKIE = 'sid';
const SESSION_MS = config.sessionHours * 3600 * 1000;
const publicDir = path.join(root, 'public');
const router = createRouter();

// Rate limit login di memori: 5 gagal -> kunci 15 menit (per IP + username)
const attempts = new Map();
const LOCK_MS = 15 * 60_000;

const clientIp = (req) => {
  if (config.trustProxy && req.headers['x-forwarded-for']) {
    return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
};

function sessionUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = db.prepare(`
    SELECT u.id, u.username, u.role, u.disabled, u.must_change_password, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?`).get(tokenHash);
  if (!row || row.disabled || row.expires_at < Date.now()) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    mustChangePassword: !!row.must_change_password,
    tokenHash,
  };
}

// Semua route protected lewat sini. allowChange: route yang boleh dipakai saat wajib ganti sandi.
function auth(req, { admin = false, allowChange = false } = {}) {
  const u = sessionUser(req);
  if (!u) throw new JsonError(401, 'Belum login.');
  if (admin && u.role !== 'admin') throw new JsonError(403, 'Hanya admin.');
  if (u.mustChangePassword && !allowChange) throw new JsonError(403, 'Ganti sandi dulu.');
  return u;
}

const cookieHeader = (value, maxAgeSec) => {
  const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (config.cookieSecure) parts.push('Secure');
  return parts.join('; ');
};

// ---------- Auth ----------
router.add('POST', '/api/login', async (req, res) => {
  const body = await readJson(req);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const key = `${clientIp(req)}|${username.toLowerCase()}`;
  const rec = attempts.get(key);
  if (rec?.until && rec.until > Date.now()) {
    throw new JsonError(429, 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.');
  }

  const user = accounts.findUserByName(username);
  const ok = !!user && !user.disabled && await verifyPassword(password, user.password_hash);
  if (!ok) {
    const count = (rec?.count || 0) + 1;
    attempts.set(key, count >= 5 ? { count: 0, until: Date.now() + LOCK_MS } : { count, until: 0 });
    accounts.audit(user?.id ?? null, 'login.failed', username);
    throw new JsonError(401, 'Username atau sandi salah.');
  }

  attempts.delete(key);
  const token = newToken();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), user.id, Date.now() + SESSION_MS);
  accounts.audit(user.id, 'login', username);
  res.setHeader('Set-Cookie', cookieHeader(token, config.sessionHours * 3600));
  sendJson(res, 200, { user: accounts.publicUser(user) });
});

router.add('POST', '/api/logout', async (req, res) => {
  const u = sessionUser(req);
  if (u) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(u.tokenHash);
  res.setHeader('Set-Cookie', cookieHeader('', 0));
  sendJson(res, 200, { ok: true });
});

router.add('GET', '/api/me', async (req, res) => {
  const u = auth(req, { allowChange: true });
  sendJson(res, 200, { user: { id: u.id, username: u.username, role: u.role, mustChangePassword: u.mustChangePassword } });
});

router.add('POST', '/api/password', async (req, res) => {
  const u = auth(req, { allowChange: true });
  const body = await readJson(req);
  const row = accounts.findUser(u.id);
  if (!(await verifyPassword(String(body.old || ''), row.password_hash))) {
    throw new JsonError(400, 'Sandi lama salah.');
  }
  try {
    await accounts.setPassword(u.id, String(body.new || ''), { keepTokenHash: u.tokenHash });
  } catch (err) {
    throw new JsonError(400, err.message);
  }
  accounts.audit(u.id, 'password.change', u.username);
  sendJson(res, 200, { ok: true });
});

// ---------- Sistem ----------
router.add('GET', '/api/system', async (req, res) => {
  auth(req);
  sendJson(res, 200, systemInfo());
});

// ---------- Job / shell (admin) ----------
router.add('GET', '/api/jobs', async (req, res) => {
  auth(req, { admin: true });
  sendJson(res, 200, { jobs: jobs.listJobs(100) });
});

router.add('POST', '/api/jobs', async (req, res) => {
  const u = auth(req, { admin: true });
  const body = await readJson(req);
  try {
    const job = jobs.startJob({
      userId: u.id,
      command: body.command,
      shell: body.shell,
      cwd: body.cwd,
      timeoutSec: body.timeoutSec,
    });
    accounts.audit(u.id, 'job.start', `[${job.shell}] ${job.command}`);
    sendJson(res, 201, { job });
  } catch (err) {
    if (err instanceof jobs.JobError) throw new JsonError(err.status, err.message);
    throw err;
  }
});

router.add('GET', '/api/jobs/:id', async (req, res, { id }) => {
  auth(req, { admin: true });
  const row = jobs.getJobRow(id);
  if (!row) throw new JsonError(404, 'Job tidak ditemukan.');
  const live = jobs.liveJob(id);
  sendJson(res, 200, { job: jobs.toDto(row), output: live ? live.output : row.output });
});

router.add('POST', '/api/jobs/:id/stop', async (req, res, { id }) => {
  const u = auth(req, { admin: true });
  try {
    jobs.stopJob(id);
  } catch (err) {
    if (err instanceof jobs.JobError) throw new JsonError(err.status, err.message);
    throw err;
  }
  accounts.audit(u.id, 'job.stop', id);
  sendJson(res, 200, { ok: true });
});

// Server-Sent Events: output realtime satu job
router.add('GET', '/api/jobs/:id/stream', async (req, res, { id }) => {
  auth(req, { admin: true });
  const row = jobs.getJobRow(id);
  if (!row) throw new JsonError(404, 'Job tidak ditemukan.');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  let unsub = () => {};
  req.on('close', () => { clearInterval(ping); unsub(); });

  const live = jobs.liveJob(id);
  if (live) {
    send({ type: 'snapshot', output: live.output });
    unsub = jobs.subscribe(id, (ev) => {
      send(ev);
      if (ev.type === 'end') {
        clearInterval(ping);
        res.end();
      }
    });
  } else {
    send({ type: 'snapshot', output: row.output });
    send({ type: 'end', status: row.status, exitCode: row.exit_code });
    clearInterval(ping);
    res.end();
  }
});

// ---------- Pengguna (admin) ----------
router.add('GET', '/api/users', async (req, res) => {
  auth(req, { admin: true });
  sendJson(res, 200, { users: accounts.listUsers() });
});

router.add('POST', '/api/users', async (req, res) => {
  const u = auth(req, { admin: true });
  const body = await readJson(req);
  try {
    const { user, password } = await accounts.createUser({
      username: body.username,
      password: body.password || undefined,
      role: body.role || 'user',
      mustChange: true,
    });
    accounts.audit(u.id, 'user.create', `${user.username} (${user.role})`);
    sendJson(res, 201, { user, password });
  } catch (err) {
    throw new JsonError(400, err.message);
  }
});

router.add('POST', '/api/users/:id/disable', async (req, res, { id }) => {
  const u = auth(req, { admin: true });
  const target = accounts.findUser(Number(id));
  if (!target) throw new JsonError(404, 'Akun tidak ditemukan.');
  if (target.id === u.id) throw new JsonError(400, 'Tidak bisa menonaktifkan akun sendiri.');
  const body = await readJson(req);
  accounts.setDisabled(target.id, !!body.disabled);
  accounts.audit(u.id, body.disabled ? 'user.disable' : 'user.enable', target.username);
  sendJson(res, 200, { ok: true });
});

router.add('POST', '/api/users/:id/reset', async (req, res, { id }) => {
  const u = auth(req, { admin: true });
  const target = accounts.findUser(Number(id));
  if (!target) throw new JsonError(404, 'Akun tidak ditemukan.');
  const body = await readJson(req);
  const generated = !body.password;
  const password = generated ? randomPassword() : String(body.password);
  try {
    await accounts.setPassword(target.id, password, { mustChange: true });
  } catch (err) {
    throw new JsonError(400, err.message);
  }
  accounts.audit(u.id, 'user.reset', target.username);
  sendJson(res, 200, { password: generated ? password : null });
});

// ---------- Static ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(res, pathname) {
  let rel;
  try {
    rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  } catch {
    res.writeHead(400); return res.end('Bad request');
  }
  const file = path.resolve(publicDir, rel);
  if (!file.startsWith(publicDir + path.sep)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- Handler utama ----------
async function handle(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:");

  const pathname = new URL(req.url, 'http://local').pathname;
  try {
    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
      }
      return serveStatic(res, pathname);
    }
    const m = router.match(req.method, pathname);
    if (!m) throw new JsonError(404, 'Endpoint tidak ditemukan.');
    await m.handler(req, res, m.params);
  } catch (err) {
    if (res.headersSent) return res.end();
    if (err instanceof JsonError) return sendJson(res, err.status, { error: err.message });
    console.error('[error]', err);
    sendJson(res, 500, { error: 'Terjadi kesalahan di server.' });
  }
}

// ---------- Boot ----------
export function start() {
  // Job yang masih "running" dari sesi sebelumnya sudah tidak punya proses pemantau.
  db.prepare("UPDATE jobs SET status = 'interrupted', ended_at = ? WHERE status = 'running'")
    .run(new Date().toISOString());
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600_000).unref();

  const server = http.createServer(handle);
  server.listen(config.port, config.host, () => {
    console.log(`Starter panel berjalan di http://${config.host}:${config.port}`);
    console.log(`Platform: ${config.platform} | Shell default: ${config.defaultShell}`);
    if (!db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get()) {
      console.log('Belum ada admin. Jalankan: npm run setup');
    }
  });

  const shutdown = () => {
    console.log('\nMematikan... menghentikan semua job.');
    jobs.killAll();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.js')) {
  start();
}
