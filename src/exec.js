import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db } from './db.js';

// Job manager: menjalankan perintah shell, streaming output, stop, dan timeout.
// Shell bebas (sesuai keputusan), tetapi hanya boleh dipanggil oleh admin dari server.js.

const MAX_OUTPUT = 512 * 1024;
const live = new Map(); // id -> job yang sedang berjalan

export const SHELLS = config.isWin ? ['powershell', 'cmd'] : ['sh', 'bash'];

export class JobError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function buildSpawn(shell, command) {
  if (config.isWin) {
    if (shell === 'cmd') {
      return { file: 'cmd.exe', args: ['/d', '/s', '/c', command] };
    }
    // Paksa output UTF-8 supaya teks Indonesia tidak rusak di PowerShell.
    const script =
      "try{[Console]::OutputEncoding=[Text.Encoding]::UTF8}catch{}; " +
      "$OutputEncoding=[Text.Encoding]::UTF8; " + command;
    return {
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    };
  }
  if (shell === 'bash') return { file: 'bash', args: ['-lc', command] };
  return { file: 'sh', args: ['-c', command] };
}

function killTree(job) {
  const pid = job.child?.pid;
  if (!pid) return;
  if (config.isWin) {
    // /T = seluruh tree proses, /F = paksa
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM'); // process group (dibuat karena detached: true)
  } catch {
    try { job.child.kill('SIGTERM'); } catch { /* sudah mati */ }
  }
  setTimeout(() => {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* sudah mati */ }
  }, 3000).unref();
}

function emit(job, event) {
  for (const fn of job.listeners) {
    try { fn(event); } catch { /* listener rusak jangan ganggu job */ }
  }
}

function appendOutput(job, text) {
  job.output += text;
  if (job.output.length > MAX_OUTPUT) {
    job.output = '...[output dipangkas]\n' + job.output.slice(-MAX_OUTPUT);
  }
  emit(job, { type: 'data', text });
}

function finish(job, code, forcedStatus = null) {
  if (job.done) return;
  job.done = true;
  clearTimeout(job.timer);
  live.delete(job.id);
  const status = forcedStatus
    || (job.stopRequested ? 'stopped' : job.timedOut ? 'timeout' : code === 0 ? 'success' : 'failed');
  db.prepare('UPDATE jobs SET status = ?, exit_code = ?, ended_at = ?, output = ? WHERE id = ?')
    .run(status, code ?? null, new Date().toISOString(), job.output, job.id);
  emit(job, { type: 'end', status, exitCode: code ?? null });
  job.listeners.clear();
}

export function startJob({ userId, command, shell, cwd, timeoutSec }) {
  const cmd = String(command ?? '');
  if (!cmd.trim()) throw new JobError('Perintah kosong.');
  if (cmd.length > 4000) throw new JobError('Perintah terlalu panjang (maks 4000 karakter).');
  if (cmd.includes('\0')) throw new JobError('Perintah mengandung karakter tidak valid.');

  const sh = shell || config.defaultShell;
  if (!SHELLS.includes(sh)) {
    throw new JobError(`Shell "${sh}" tidak tersedia di ${config.platform}. Pilihan: ${SHELLS.join(', ')}.`);
  }

  const dir = path.resolve(String(cwd || config.defaultCwd));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new JobError(`Folder kerja tidak ditemukan: ${dir}`);
  }

  if (live.size >= config.maxConcurrentJobs) {
    throw new JobError('Terlalu banyak job berjalan. Tunggu atau hentikan salah satu.', 429);
  }

  const timeout = Math.min(Math.max(Number(timeoutSec) || config.jobTimeoutSec, 1), 86400);
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  db.prepare(`INSERT INTO jobs (id, user_id, command, shell, cwd, status, started_at) VALUES (?, ?, ?, ?, ?, 'running', ?)`)
    .run(id, userId, cmd, sh, dir, startedAt);

  const job = {
    id, output: '', listeners: new Set(), stopRequested: false, timedOut: false,
    done: false, timer: null, child: null,
  };
  live.set(id, job);

  const { file, args } = buildSpawn(sh, cmd);
  let child;
  try {
    child = spawn(file, args, {
      cwd: dir,
      env: process.env,
      windowsHide: true,
      detached: !config.isWin, // Unix: buat process group supaya seluruh anak proses bisa dihentikan
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    finish(job, null, 'failed');
    throw new JobError(`Gagal menjalankan shell: ${err.message}`, 500);
  }

  job.child = child;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d) => appendOutput(job, d));
  child.stderr.on('data', (d) => appendOutput(job, d));
  child.on('error', (err) => {
    appendOutput(job, `\n[error] ${err.message}\n`);
    finish(job, null, 'failed');
  });
  child.on('close', (code) => finish(job, code));

  job.timer = setTimeout(() => {
    job.timedOut = true;
    appendOutput(job, `\n[dihentikan: melewati batas ${timeout} detik]\n`);
    killTree(job);
  }, timeout * 1000);

  db.prepare('UPDATE jobs SET pid = ? WHERE id = ?').run(child.pid ?? null, id);
  return toDto(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id));
}

export function stopJob(id) {
  const job = live.get(id);
  if (!job) throw new JobError('Job tidak sedang berjalan.', 404);
  job.stopRequested = true;
  appendOutput(job, '\n[dihentikan oleh pengguna]\n');
  killTree(job);
}

export const liveJob = (id) => live.get(id) || null;

export function subscribe(id, fn) {
  const job = live.get(id);
  if (!job) return () => {};
  job.listeners.add(fn);
  return () => job.listeners.delete(fn);
}

export function killAll() {
  for (const job of live.values()) killTree(job);
}

export function toDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    command: row.command,
    shell: row.shell,
    cwd: row.cwd,
    status: row.status,
    exitCode: row.exit_code,
    pid: row.pid,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export function listJobs(limit = 100) {
  return db.prepare('SELECT * FROM jobs ORDER BY started_at DESC LIMIT ?').all(limit).map(toDto);
}

export function getJobRow(id) {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
}
