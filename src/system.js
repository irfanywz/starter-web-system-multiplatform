import os from 'node:os';
import fs from 'node:fs';
import { config } from './config.js';

// Info sistem sederhana, aman di Windows dan Linux.
export function systemInfo() {
  let disk = null;
  try {
    const s = fs.statfsSync(config.root);
    disk = {
      totalBytes: s.blocks * s.bsize,
      freeBytes: s.bavail * s.bsize,
    };
  } catch { /* beberapa platform tidak mendukung statfs */ }

  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    platform: process.platform,
    release: os.release(),
    arch: os.arch(),
    uptimeSec: Math.round(os.uptime()),
    cpu: { model: cpus[0]?.model || 'unknown', cores: cpus.length, loadavg: os.loadavg() },
    memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
    disk,
    node: process.version,
    defaultShell: config.defaultShell,
    shells: config.isWin ? ['powershell', 'cmd'] : ['sh', 'bash'],
    defaultCwd: config.defaultCwd,
  };
}
