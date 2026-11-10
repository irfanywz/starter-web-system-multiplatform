# Deploy di VPS Linux (Ubuntu 22.04 / 24.04)

```bash
# 1. Node.js 24 LTS
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# 2. Caddy untuk HTTPS
sudo apt install -y caddy

# 3. Firewall: SSH + HTTP/HTTPS saja. Port 3000 jangan dibuka.
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable

# 4. User khusus (jangan jalankan sebagai root)
sudo useradd -r -m -d /opt/starter-panel -s /usr/sbin/nologin panel
sudo cp -r . /opt/starter-panel && sudo chown -R panel:panel /opt/starter-panel
cd /opt/starter-panel && sudo -u panel node scripts/setup.js

# 5. Service + reverse proxy
sudo cp deploy/linux/starter-panel.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now starter-panel
sudo cp deploy/linux/Caddyfile /etc/caddy/Caddyfile   # edit domain dulu
sudo systemctl reload caddy
```

Di `.env` ubah `HOST=127.0.0.1`, `COOKIE_SECURE=true`, dan `TRUST_PROXY=1`.

Catatan: shell bebas berjalan sebagai user `panel`. Jangan beri user ini sudo tanpa password.
