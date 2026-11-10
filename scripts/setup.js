// npm run setup: instalasi awal lintas platform (Windows, Linux, macOS).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) {
  console.error(`Node.js ${process.version} terlalu lama. Pasang Node.js 22.13 atau lebih baru.`);
  process.exit(1);
}

const envFile = path.join(root, '.env');
if (!fs.existsSync(envFile)) {
  fs.copyFileSync(path.join(root, '.env.example'), envFile);
  console.log('[OK] .env dibuat dari .env.example');
} else {
  console.log('[OK] .env sudah ada, tidak diubah');
}

// Import setelah .env ada, supaya konfigurasi terbaca.
const { ensureAdmin } = await import('../src/accounts.js');
const { runChecks } = await import('../src/checks.js');
const { db } = await import('../src/db.js');

const items = await runChecks();
for (const i of items) {
  console.log(`${i.ok ? '[OK]   ' : '[GAGAL]'} ${i.label}${i.detail ? ` - ${i.detail}` : ''}`);
  if (!i.ok && i.hint) console.log(`         Saran: ${i.hint}`);
}
if (items.some((i) => !i.ok && !i.label.startsWith('Port'))) {
  console.error('\nAda pemeriksaan penting yang gagal. Perbaiki lalu jalankan ulang: npm run setup');
  process.exit(1);
}

const pw = await ensureAdmin();
if (pw) {
  console.log('\n==============================================');
  console.log(' Akun admin dibuat');
  console.log('   username : admin');
  console.log(`   sandi    : ${pw}`);
  console.log(' Sandi hanya tampil sekali. Ganti setelah login pertama.');
  console.log('==============================================');
} else {
  console.log('[OK] Admin sudah ada, tidak dibuat ulang.');
}
db.close();
console.log('\nSelesai. Jalankan panel dengan: npm start');
