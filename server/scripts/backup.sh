#!/usr/bin/env bash
# PostgreSQL backup: one compressed custom-format dump per run.
#
#   DATABASE_URL=postgres://... ./scripts/backup.sh [/backups/medisync]
#
# Restore with:
#   pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" medisync-YYYYMMDD-HHMMSS.dump
#
# On Render, run this from a Cron Job (daily) writing to a disk or uploading to object
# storage, and keep the last 30 files. A database backup is not a substitute for backing up
# the prescription upload disk: snapshot/copy UPLOAD_DIR on the same schedule.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"
OUT_DIR="${1:-./backups}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/medisync-$STAMP.dump"

mkdir -p "$OUT_DIR"
pg_dump --format=custom --no-owner --no-privileges --file="$FILE" "$DATABASE_URL"
gzip -f "$FILE"
echo "backup: $FILE.gz"

# Keep the 30 newest dumps.
ls -1t "$OUT_DIR"/medisync-*.dump.gz 2>/dev/null | tail -n +31 | xargs -r rm --
