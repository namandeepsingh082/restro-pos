#!/usr/bin/env bash
#
# First deployment on the server. Creates .env with a fresh secret, sets up the
# database, builds, and registers the app with pm2 so it survives a reboot.
#
#   cd /opt/restro-pos && bash deploy/first-run.sh
#
# Run release.sh for every deployment after this one.

set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

say "1/5  Environment"
if [ ! -f .env ]; then
  # A secret generated here and never seen anywhere else. The development
  # machine's secret stays on the development machine: two environments should
  # not be able to mint each other's session cookies.
  SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
  cat > .env <<EOF
DATABASE_URL="file:./dev.db"
AUTH_SECRET="${SECRET}"
NODE_ENV="production"
SESSION_HOURS="12"
EOF
  chmod 600 .env
  echo "wrote .env with a freshly generated AUTH_SECRET"
else
  echo ".env already exists — left untouched"
fi

say "2/5  Dependencies"
npm ci --omit=dev --ignore-scripts
# Prisma's postinstall is skipped above (--ignore-scripts), so generate here.
npx prisma generate

say "3/5  Database"
if [ -f prisma/dev.db ]; then
  echo "prisma/dev.db already present — applying any schema changes only"
  npx prisma db push --skip-generate
else
  echo "no database yet: creating one and seeding the sample menu"
  npx prisma db push --skip-generate
  npx tsx prisma/seed.ts
  cat <<'WARN'

  ------------------------------------------------------------------
  The seed created admin@restaurant.local / admin@123.
  CHANGE IT NOW: sign in, go to Staff, edit both accounts.
  This server is reachable from the internet.
  ------------------------------------------------------------------
WARN
fi

say "4/5  Build"
npm install --include=dev --ignore-scripts   # build needs typescript/tailwind
npm run build

say "5/5  Start under pm2, and survive reboots"
pm2 start deploy/ecosystem.config.cjs --update-env
pm2 save
# Prints a command to run with sudo; run it once so pm2 comes back after a reboot.
pm2 startup | tail -3

cat <<EOF

App is running on 127.0.0.1:3000 behind Caddy.
Open https://<your-domain> and sign in.

    pm2 logs restro-pos     # what the app is doing
    pm2 restart restro-pos  # after changing .env
    bash deploy/backup.sh   # database snapshot
EOF
