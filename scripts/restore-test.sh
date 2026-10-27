#!/usr/bin/env bash
# Proves a backup can be restored (docs/operations.md §Restore test). Run monthly and after every
# schema change; an untested backup is not a backup.
#
#   BACKUP_PASSPHRASE=... scripts/restore-test.sh backups/mboka-<stamp>.dump.enc
#
# Restores into a scratch database next to the live one, compares row counts table by table
# with the live database, prints the result, then drops the scratch database.
# Row counts can differ legitimately when the live database changed since the backup was taken.
set -euo pipefail

FILE="${1:?Usage: restore-test.sh <backup.dump.enc>}"
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE (from the secret store)}"
DB="${PGDATABASE:-mboka}"
DB_USER="${PGUSER:-mboka}"
SCRATCH="mboka_restore_test_$(date -u +%s)"
PSQL="${PSQL:-docker compose exec -T postgres psql}"
PG_RESTORE="${PG_RESTORE:-docker compose exec -T postgres pg_restore}"

if [ -f "$FILE.sha256" ]; then
  (cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256")
fi

cleanup() { $PSQL -U "$DB_USER" -d postgres -q -c "DROP DATABASE IF EXISTS $SCRATCH" >/dev/null; }
trap cleanup EXIT

started=$(date +%s)
$PSQL -U "$DB_USER" -d postgres -q -c "CREATE DATABASE $SCRATCH"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$FILE" \
  | $PG_RESTORE -U "$DB_USER" -d "$SCRATCH" --no-owner --exit-on-error
elapsed=$(( $(date +%s) - started ))

# Exact row counts for every table in both databases.
COUNT_SQL="SELECT table_name || '=' || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', table_name), false, true, '')))[1]::text
           FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1"
live=$($PSQL -U "$DB_USER" -d "$DB" -At -c "$COUNT_SQL" | tr -d '\r')
restored=$($PSQL -U "$DB_USER" -d "$SCRATCH" -At -c "$COUNT_SQL" | tr -d '\r')

tables=$(echo "$restored" | wc -l)
rows=$(echo "$restored" | awk -F= '{s+=$2} END {print s}')
policies=$($PSQL -U "$DB_USER" -d "$SCRATCH" -At -c "SELECT count(*) FROM pg_policies WHERE schemaname = 'public'" | tr -d '\r')
# Grants matter: without them the runtime role mboka_app cannot read the restored database.
grants=$($PSQL -U "$DB_USER" -d "$SCRATCH" -At -c "SELECT count(*) FROM information_schema.role_table_grants WHERE grantee = 'mboka_app'" | tr -d '\r')
migrations=$($PSQL -U "$DB_USER" -d "$SCRATCH" -At -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL" | tr -d '\r')

echo "restore: $tables tables, $rows rows, $policies RLS policies, $grants mboka_app grants, $migrations migrations, ${elapsed}s"
if [ "$live" = "$restored" ]; then
  echo "restore-test: OK (row counts identical to the live database)"
else
  echo "restore-test: row counts differ from the live database (expected if it changed since the backup):"
  diff <(echo "$live") <(echo "$restored") || true
fi
