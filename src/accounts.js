import { db } from './db.js';
import { hashPassword, randomPassword } from './security.js';

export const ROLES = ['admin', 'user'];
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;

export function validateUsername(u) {
  if (!USERNAME_RE.test(u)) {
    throw new Error('Username 3-32 karakter: huruf, angka, titik, garis bawah, atau strip.');
  }
}

export function validatePassword(p) {
  if (typeof p !== 'string' || p.length < 8 || p.length > 200) {
    throw new Error('Sandi minimal 8 karakter.');
  }
}

export function publicUser(r) {
  return {
    id: r.id,
    username: r.username,
    role: r.role,
    disabled: !!r.disabled,
    mustChangePassword: !!r.must_change_password,
    createdAt: r.created_at,
  };
}

export const findUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
export const findUserByName = (name) => db.prepare('SELECT * FROM users WHERE username = ?').get(name);
export const listUsers = () => db.prepare('SELECT * FROM users ORDER BY id').all().map(publicUser);

// Membuat akun. Kalau password kosong, dibuat acak dan dikembalikan sekali (generated = true).
export async function createUser({ username, password, role = 'user', mustChange = true }) {
  username = String(username ?? '').trim();
  validateUsername(username);
  if (!ROLES.includes(role)) throw new Error('Role tidak dikenal.');
  if (findUserByName(username)) throw new Error('Username sudah dipakai.');
  const generated = password == null || password === '';
  if (generated) password = randomPassword();
  validatePassword(password);
  const hash = await hashPassword(password);
  const info = db
    .prepare('INSERT INTO users (username, password_hash, role, must_change_password) VALUES (?, ?, ?, ?)')
    .run(username, hash, role, mustChange ? 1 : 0);
  return { user: publicUser(findUser(info.lastInsertRowid)), password: generated ? password : null };
}

// keepTokenHash: sesi ini tetap hidup (dipakai saat user ganti sandi sendiri).
export async function setPassword(id, password, { mustChange = false, keepTokenHash = null } = {}) {
  validatePassword(password);
  const hash = await hashPassword(password);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?')
    .run(hash, mustChange ? 1 : 0, id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash IS NOT ?').run(id, keepTokenHash);
}

export function setDisabled(id, disabled) {
  db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, id);
  if (disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
}

// Dipanggil saat setup: buat admin awal dengan sandi acak, hanya jika belum ada admin.
export async function ensureAdmin() {
  const exists = db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
  if (exists) return null;
  const { password } = await createUser({ username: 'admin', role: 'admin', mustChange: true });
  return password;
}

export function audit(userId, action, detail = '') {
  db.prepare('INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)')
    .run(userId ?? null, action, String(detail).slice(0, 2000));
}
