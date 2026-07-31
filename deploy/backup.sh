#!/usr/bin/env bash
#
# Database snapshot, for cron and for release.sh.
#
#   bash deploy/backup.sh
#
# The app already ships `npm run backup`, which uses SQLite's backup API (safe to
# run while the app is serving) and keeps the last 30 files in ./backups. This
# wrapper exists so cron has something with an absolute path and a log, and so a
# second copy can be pushed off the machine — a backup that only exists on the
# server it protects is not a backup.

set -euo pipefail
cd "$(dirname "$0")/.."

npm run backup

# Optional off-box copy. Set OFFSITE to an rsync target, e.g.
#   OFFSITE="you@home-nas:/backups/restro-pos/"   (needs an SSH key)
if [ -n "${OFFSITE:-}" ]; then
  latest="$(ls -t backups/*.db 2>/dev/null | head -1 || true)"
  if [ -n "$latest" ]; then
    rsync -az "$latest" "$OFFSITE" && echo "copied $latest -> $OFFSITE"
  fi
fi

ls -lt backups/ 2>/dev/null | head -4
