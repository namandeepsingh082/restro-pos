#!/usr/bin/env bash
#
# Every deployment after the first. Run on the server, after deploy/sync.sh has
# copied the new code up:
#
#   cd /opt/restro-pos && bash deploy/release.sh
#
# Takes a database snapshot before touching anything, because a schema change is
# the one step here that cannot be undone by re-running it.

set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

say "1/5  Snapshot the database first"
bash deploy/backup.sh

say "2/5  Dependencies"
npm install --include=dev --ignore-scripts
npx prisma generate

say "3/5  Schema"
# `db push` is additive for the changes this app makes (new columns, new tables).
# If a release ever needs to drop or rename a column, stop and do it by hand.
npx prisma db push --skip-generate

say "4/5  Build"
npm run build

say "5/5  Reload"
# `reload` rather than `restart`: pm2 starts the new process before dropping the
# old one, so a cashier mid-bill does not get a connection error.
pm2 reload restro-pos --update-env
pm2 save

sleep 2
curl -fsS -o /dev/null -w "local health check: HTTP %{http_code}\n" http://127.0.0.1:3000/login
pm2 status restro-pos
