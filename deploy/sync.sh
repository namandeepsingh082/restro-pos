#!/usr/bin/env bash
#
# Copy the app from this laptop to the server. Run from the project root:
#
#   deploy/sync.sh ubuntu@203.0.113.10
#
# What it deliberately does NOT copy:
#   prisma/dev.db  — the server's database is the real one. Overwriting it with
#                    the laptop's copy would replace a day of live billing with
#                    whatever was last tested here. This is the whole reason the
#                    exclude list exists.
#   .env           — the server has its own secret and its own settings.
#   node_modules   — rebuilt on the server for its own CPU architecture (the free
#                    Oracle shape is ARM; your Mac is ARM too, but a Linux binary
#                    is still not a macOS one).
#   .next          — built on the server.

set -euo pipefail

TARGET="${1:?Usage: deploy/sync.sh user@server-ip [remote-dir]}"
REMOTE_DIR="${2:-/opt/restro-pos}"

[ -f package.json ] || { echo "Run this from the project root."; exit 1; }

rsync -az --delete --human-readable --info=stats1 \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude '.env' \
  --exclude 'prisma/dev.db' \
  --exclude 'prisma/dev.db-journal' \
  --exclude 'prisma/dev.db-wal' \
  --exclude 'prisma/dev.db-shm' \
  --exclude 'backups' \
  ./ "${TARGET}:${REMOTE_DIR}/"

cat <<EOF

Copied to ${TARGET}:${REMOTE_DIR}

On the server:
    cd ${REMOTE_DIR}
    bash deploy/first-run.sh     # first time only
    bash deploy/release.sh       # every time after that
EOF
