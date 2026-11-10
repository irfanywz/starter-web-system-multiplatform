import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Loader .env sederhana (tanpa dependency). Nilai di environment sistem lebih diutamakan.
export function loadEnv(file = path.join(root, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv();

const isWin = process.platform === 'win32';

export const config = {
  root,
  platform: process.platform,
  isWin,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  dbPath: process.env.DB_PATH || path.join(root, 'data', 'app.db'),
  dataDir: path.dirname(process.env.DB_PATH || path.join(root, 'data', 'app.db')),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  trustProxy: process.env.TRUST_PROXY === '1',
  defaultShell: process.env.DEFAULT_SHELL || (isWin ? 'powershell' : 'sh'),
  defaultCwd: process.env.DEFAULT_CWD || root,
  jobTimeoutSec: Number(process.env.JOB_TIMEOUT_SEC || 600),
  maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS || 5),
  sessionHours: Number(process.env.SESSION_HOURS || 12),
};
