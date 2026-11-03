#!/usr/bin/env bash
# Runs in the backup-agent container (deploy/docker-compose.prod.yml), the only place holding the database
# owner's password. It carries out the requests the platform console drops in /backups/requests:
#   <id>.backup   → scripts/backup.sh /backups           (whole-database backup, encrypted)
#   <id>.restore  → scripts/restore-test.sh /backups/<file named inside the request>
# and leaves <id>.log (output) and <id>.exit (exit code) for the console. The API never sees the owner password.
set -uo pipefail

DIR=/backups
REQ="$DIR/requests"
mkdir -p "$REQ"
# The API (non-root "node" user) lists the backups (encrypted) and writes requests and reads their results.
chmod 755 "$DIR"
chmod 1777 "$REQ"

export PGHOST=postgres PGUSER=mboka PGPASSWORD="$OWNER_DB_PASSWORD"
export PG_DUMP="pg_dump" PSQL="psql" PG_RESTORE="pg_restore"

run() { # id kind command...
  local id="$1"; shift
  mv "$REQ/$id.$1" "$REQ/$id.running"; shift
  "$@" > "$REQ/$id.log" 2>&1
  echo $? > "$REQ/$id.exit"
  rm -f "$REQ/$id.running"
  # Backups are encrypted; let the API read them to list and download (the host folder itself stays root-only).
  chmod 644 "$DIR"/mboka-*.dump.enc "$DIR"/mboka-*.dump.enc.sha256 "$REQ/$id".* 2>/dev/null || true
}

echo "backup-agent: watching $REQ"
while true; do
  date -u +%Y-%m-%dT%H:%M:%SZ > "$DIR/agent.heartbeat"
  chmod 644 "$DIR/agent.heartbeat"
  for f in "$REQ"/*.backup; do
    [ -e "$f" ] || continue
    id="$(basename "$f" .backup)"
    run "$id" backup bash /scripts/backup.sh "$DIR"
  done
  for f in "$REQ"/*.restore; do
    [ -e "$f" ] || continue
    id="$(basename "$f" .restore)"
    file="$(tr -cd 'A-Za-z0-9.-' < "$f")"
    if [[ "$file" =~ ^mboka-[0-9]{8}T[0-9]{6}Z\.dump\.enc$ && -f "$DIR/$file" ]]; then
      run "$id" restore bash /scripts/restore-test.sh "$DIR/$file"
    else
      mv "$f" "$REQ/$id.running"; echo "unknown backup file: $file" > "$REQ/$id.log"; echo 2 > "$REQ/$id.exit"; rm -f "$REQ/$id.running"
    fi
  done
  # Results older than 30 days are of no use any more.
  find "$REQ" -type f -mtime +30 -delete 2>/dev/null || true
  sleep 15
done
