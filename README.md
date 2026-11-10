# Starter Web System Multiplatform

Base panel web (Node.js) untuk menjalankan perintah sistem dari browser.
Jalan di Windows, Linux, VPS, dan RDP. **Tanpa dependency npm**, jadi tidak ada `npm install`.

## Fitur

- Login dengan sesi cookie, sandi di-hash scrypt, rate limit login.
- Dua role: `admin` dan `user`. Admin bisa menjalankan shell dan mengelola akun.
- Terminal: jalankan perintah (PowerShell/cmd di Windows, sh/bash di Linux), output realtime, stop, timeout, riwayat.
- Info sistem: OS, CPU, RAM, disk, uptime.
- Kelola akun: buat, nonaktifkan, reset sandi, ganti sandi sendiri. Sandi awal wajib diganti.
- Audit log untuk login, eksekusi perintah, dan perubahan akun.
- CLI admin dan pemeriksaan sistem (doctor).

## Persyaratan

- Node.js 22.13 atau lebih baru (LTS terbaru disarankan).

## Mulai cepat

```bash
node scripts/setup.js     # atau: npm run setup
npm start                 # buka http://127.0.0.1:3000
```

Setup membuat `.env`, memeriksa sistem, dan membuat admin dengan sandi acak (ditampilkan sekali).

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run setup` | Instalasi awal, cek sistem, buat admin |
| `npm start` | Jalankan panel |
| `npm run doctor` | Cek kesiapan sistem |
| `npm run admin -- init-admin` | Buat admin jika belum ada |
| `npm run admin -- add <user> [sandi] [admin\|user]` | Buat akun |
| `npm run admin -- reset <user> [sandi]` | Reset sandi |
| `npm run admin -- disable <user>` / `enable <user>` | Nonaktifkan / aktifkan akun |
| `npm run admin -- list` | Lihat akun |
| `npm test` | Jalankan tes unit |

## Konfigurasi

Lihat `.env.example`. Yang paling penting: `HOST`, `PORT`, `DEFAULT_SHELL`, `DEFAULT_CWD`, `JOB_TIMEOUT_SEC`, `MAX_CONCURRENT_JOBS`, dan `COOKIE_SECURE` (set `true` jika sudah pakai HTTPS).

## Struktur

```
src/
  server.js    HTTP server, route API, SSE, static file
  config.js    membaca .env dan konfigurasi per platform
  db.js        SQLite bawaan Node (node:sqlite) dan skema
  accounts.js  akun, sandi, audit
  exec.js      eksekusi shell lintas OS, streaming, stop, timeout
  security.js  hash sandi dan token
  http.js      router kecil, JSON, cookie
  system.js    info sistem
  checks.js    pemeriksaan untuk doctor dan setup
  admin.js     CLI admin
  doctor.js    npm run doctor
scripts/setup.js
public/        UI (HTML, CSS, JS vanilla, tanpa build)
tests/         tes unit (node:test)
deploy/        panduan Windows dan VPS Linux (systemd, Caddy)
```

## Memperluas untuk aplikasi kamu

- Tambah route baru di `src/server.js` dengan `router.add(method, path, handler)`, lalu panggil `auth(req, { admin: true })` untuk membatasi akses.
- Tambah tab baru di `public/index.html` dan `TABS` di `public/app.js`.
- Tabel data baru: tambahkan `CREATE TABLE IF NOT EXISTS` di `src/db.js`.

## Catatan keamanan

- Shell bebas berarti admin punya kendali penuh atas mesin dengan hak user yang menjalankan panel. Jangan jalankan sebagai root atau Administrator.
- Jangan buka port ke internet tanpa HTTPS. Pakai `deploy/`.
- Sebelum dipakai untuk orang lain, audit kode ini dan tambahkan pembatasan sesuai kebutuhan.
