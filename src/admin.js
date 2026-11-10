// CLI admin: npm run admin -- <perintah>
import * as accounts from './accounts.js';
import { db } from './db.js';

const USAGE = `Perintah:
  init-admin                       buat admin awal (hanya jika belum ada admin)
  add <user> [sandi] [admin|user]  buat akun (sandi kosong = dibuat acak)
  list                             lihat semua akun
  reset <user> [sandi]             reset sandi (sandi kosong = dibuat acak)
  disable <user> | enable <user>   nonaktifkan / aktifkan akun`;

const [cmd, ...args] = process.argv.slice(2);
const find = (name) => {
  const u = accounts.findUserByName(name);
  if (!u) throw new Error(`Akun "${name}" tidak ditemukan.`);
  return u;
};
const genOrGiven = (v) => v || undefined;

try {
  switch (cmd) {
    case 'init-admin': {
      const pw = await accounts.ensureAdmin();
      console.log(pw ? `Admin dibuat. username: admin | sandi: ${pw}\nSandi hanya ditampilkan sekali.`
        : 'Sudah ada admin. Tidak ada perubahan.');
      break;
    }
    case 'add': {
      const [user, pass, role = 'user'] = args;
      const r = await accounts.createUser({ username: user, password: genOrGiven(pass), role });
      console.log(`Akun ${r.user.username} (${r.user.role}) dibuat.`);
      if (r.password) console.log(`Sandi sementara: ${r.password}`);
      break;
    }
    case 'list': {
      const rows = accounts.listUsers();
      console.table(rows.map((u) => ({ id: u.id, username: u.username, role: u.role, disabled: u.disabled })));
      break;
    }
    case 'reset': {
      const u = find(args[0]);
      const pw = genOrGiven(args[1]) ?? (await import('./security.js')).randomPassword();
      await accounts.setPassword(u.id, pw, { mustChange: true });
      console.log(`Sandi ${u.username} direset. Sandi: ${pw}`);
      break;
    }
    case 'disable':
    case 'enable': {
      const u = find(args[0]);
      accounts.setDisabled(u.id, cmd === 'disable');
      console.log(`${u.username} ${cmd === 'disable' ? 'dinonaktifkan' : 'diaktifkan'}.`);
      break;
    }
    default:
      console.log(USAGE);
  }
} catch (err) {
  console.error(`Gagal: ${err.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
