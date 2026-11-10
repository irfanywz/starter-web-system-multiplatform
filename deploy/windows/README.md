# Deploy di Windows (termasuk VPS Windows dan RDP)

## 1. Pasang Node.js
Unduh Node.js LTS (22.13 atau lebih baru) dari nodejs.org, lalu centang "Add to PATH".
Cek dengan `node -v` di PowerShell.

## 2. Siapkan project
```powershell
cd C:\starter-panel
node scripts\setup.js
```
Catat username dan sandi admin yang tampil. Sandi hanya tampil sekali.

## 3. Jalankan manual
```powershell
npm start
```
Buka http://127.0.0.1:3000 di browser.

## 4. Jalankan sebagai service (otomatis saat boot)
Pakai NSSM (https://nssm.cc):
```powershell
nssm install StarterPanel "C:\Program Files\nodejs\node.exe" "--no-warnings" "C:\starter-panel\src\server.js"
nssm set StarterPanel AppDirectory C:\starter-panel
nssm set StarterPanel AppStdout C:\starter-panel\data\service.log
nssm set StarterPanel AppStderr C:\starter-panel\data\service.log
nssm start StarterPanel
```
Alternatif tanpa NSSM: Task Scheduler, trigger "At startup", jalankan `node.exe` dengan argumen di atas.

## 5. Akses dari RDP
- Biarkan `HOST=127.0.0.1`. Setelah login RDP, buka browser dan akses http://127.0.0.1:3000.
- Untuk akses dari laptop lain, jangan buka port 3000 langsung. Pakai SSH tunnel atau reverse proxy HTTPS (Caddy untuk Windows, atau IIS + ARR).

## Catatan keamanan
Panel ini menjalankan shell bebas. Siapa pun yang berhasil login sebagai admin punya kendali penuh atas mesin ini,
dengan hak akses user yang menjalankan service. Karena itu:
- Jangan jalankan service sebagai Administrator. Buat user Windows khusus dengan hak minimum.
- Pakai sandi kuat dan segera ganti sandi awal.
- Batasi akses jaringan dengan firewall.
