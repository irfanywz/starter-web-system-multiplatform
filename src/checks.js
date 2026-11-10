import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { config } from './config.js';

// Dipakai oleh doctor dan setup. Setiap item: { label, ok, detail, hint }
export async function runChecks() {
  const items = [];
  const add = (label, ok, detail = '', hint = '') => items.push({ label, ok, detail, hint });

  const [maj, min] = process.versions.node.split('.').map(Number);
  add('Node.js 22.13 atau lebih baru', maj > 22 || (maj === 22 && min >= 13), process.version,
    'Pasang Node.js LTS terbaru dari nodejs.org');

  let sqlite = false;
  try { await import('node:sqlite'); sqlite = true; } catch { /* versi lama */ }
  add('Modul SQLite bawaan (node:sqlite)', sqlite, '', 'Gunakan Node.js 22.13 atau lebih baru');

  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.accessSync(config.dataDir, fs.constants.W_OK);
    add('Folder data bisa ditulis', true, config.dataDir);
  } catch (err) {
    add('Folder data bisa ditulis', false, err.message, 'Periksa izin folder project');
  }

  const probe = config.isWin ? 'where' : 'which';
  const shellName = config.defaultShell === 'cmd' ? 'cmd.exe'
    : config.defaultShell === 'powershell' ? 'powershell.exe' : config.defaultShell;
  const found = spawnSync(probe, [shellName], { windowsHide: true }).status === 0;
  add(`Shell default "${config.defaultShell}" ditemukan`, found, '',
    'Atur DEFAULT_SHELL di .env ke shell yang tersedia');

  const portFree = await new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(config.port, config.host);
  });
  add(`Port ${config.port} tersedia`, portFree, '',
    'Hentikan proses lain yang memakai port itu, atau ubah PORT di .env');

  return items;
}
