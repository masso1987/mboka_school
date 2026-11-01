#!/usr/bin/env bash
# Encrypted logical backup of the Mboka database (docs/operations.md §Backups).
#
#   BACKUP_PASSPHRASE=... scripts/backup.sh [output-dir]
#
# Produces <output-dir>/mboka-<UTC timestamp>.dump.enc: a pg_dump custom-format archive
# encrypted with AES-256 (PBKDF2-derived key) plus a .sha256 file to detect corruption in transit.
# The passphrase lives in the secret store, never next to the backups.
set -euo pipefail

OUT_DIR="${1:-backups}"
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE (from the secret store)}"
DB="${PGDATABASE:-mboka}"
DB_USER="${PGUSER:-mboka}"
# docker compose by default; set PG_DUMP="pg_dump -h host" to run against a managed server.
PG_DUMP="${PG_DUMP:-docker compose exec -T postgres pg_dump}"

mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT_DIR/mboka-$STAMP.dump.enc"

# The archive is streamed straight into openssl: no unencrypted copy ever touches the disk.
$PG_DUMP -U "$DB_USER" -d "$DB" --format=custom \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$FILE"

(cd "$OUT_DIR" && sha256sum "$(basename "$FILE")" > "$(basename "$FILE").sha256")
echo "backup: $FILE ($(wc -c < "$FILE") bytes)"
