#!/usr/bin/env bash
#
# One-time server setup for Restro POS on a fresh Ubuntu VM.
# Written for an Oracle Cloud "Always Free" instance, but nothing here is
# Oracle-specific except the firewall step, which is noted below.
#
#   ssh ubuntu@<server-ip>
#   DOMAIN=pos-yourshop.duckdns.org bash provision.sh
#
# Idempotent: safe to run again after a failure.

set -euo pipefail

DOMAIN="${DOMAIN:?Set DOMAIN, e.g. DOMAIN=pos-yourshop.duckdns.org}"
APP_DIR="${APP_DIR:-/opt/restro-pos}"
APP_USER="${APP_USER:-$(id -un)}"
NODE_MAJOR="${NODE_MAJOR:-20}"   # matches the development machine (v20.20.2)

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

say "1/7  Base packages"
sudo apt-get update -y
sudo apt-get install -y curl git rsync sqlite3 ca-certificates gnupg \
  debian-keyring debian-archive-keyring apt-transport-https

say "2/7  Node ${NODE_MAJOR}"
if ! command -v node >/dev/null || [[ "$(node -v)" != v${NODE_MAJOR}* ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

say "3/7  Caddy (this is what gets and renews the HTTPS certificate)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y caddy
fi

say "4/7  pm2 (keeps the app running and restarts it after a reboot)"
sudo npm install -g pm2

say "5/7  2 GB swap"
# `next build` peaks well above what the 1 GB free shape has. The running app
# only needs ~120 MB, so this exists for the build, not for service.
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
free -h | head -2

say "6/7  Firewall"
# THE Oracle gotcha. Their Ubuntu images ship iptables rules that REJECT
# everything except SSH, so opening the ports in the web console is only half
# the job — miss this and the site times out with no clue why.
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent
sudo netfilter-persistent save

say "7/7  Timezone and app directory"
sudo timedatectl set-timezone Asia/Kolkata
sudo mkdir -p "$APP_DIR"
sudo chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# Caddy config: one line of proxying, and it handles the certificate itself.
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
${DOMAIN} {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}
EOF
sudo systemctl reload caddy || sudo systemctl restart caddy

cat <<EOF

Done. The server is ready; the app is not on it yet.

Next, from your laptop:
    deploy/sync.sh ${APP_USER}@<server-ip>

Then back here:
    cd ${APP_DIR} && bash deploy/first-run.sh

Checks if something looks wrong:
    sudo systemctl status caddy      # certificate / proxy
    pm2 logs restro-pos              # the app
    curl -I http://localhost:3000    # is the app itself alive
EOF
