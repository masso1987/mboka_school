#!/usr/bin/env bash
# Builds the current commit and releases it to a single host over SSH (docs/operations.md).
#
#   deploy/deploy.sh <ssh-host> [install-dir]        e.g. deploy/deploy.sh inos-vps
#   SEED_NODE_ENV=development deploy/deploy.sh ...  also seeds the demo school (showcase instances)
#
# Steps: build images locally -> copy them and the compose files -> nightly backup before migrating
# -> apply migrations through an SSH tunnel with the owner role -> seed (permissions, platform admin)
# -> restart api and web -> check readiness. Secrets are read from the server's .env into this
# process's environment only; nothing is printed.
set -euo pipefail

SSH_HOST="${1:?ssh host (from ~/.ssh/config)}"
DIR="${2:-/opt/mboka-school}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -n "$(git status --porcelain)" ]; then
  echo "deploy: commit or stash your changes first (the release is tagged with the commit)" >&2
  exit 1
fi
RELEASE="$(git rev-parse --short HEAD)"
echo "deploy: release $RELEASE to $SSH_HOST:$DIR"

docker build -q -f apps/api/Dockerfile -t "mboka-school-api:$RELEASE" . >/dev/null
docker build -q -f apps/web/Dockerfile -t "mboka-school-web:$RELEASE" . >/dev/null
echo "deploy: images built"

ssh "$SSH_HOST" "mkdir -p '$DIR'"
scp -q deploy/docker-compose.prod.yml "$SSH_HOST:$DIR/docker-compose.yml"
scp -q -r deploy/postgres-init deploy/server-init.sh scripts/backup.sh scripts/restore-test.sh "$SSH_HOST:$DIR/"
HOST_NAME="$(basename deploy/nginx/*.conf .conf)"
ssh "$SSH_HOST" "chmod +x '$DIR'/postgres-init/*.sh '$DIR'/*.sh && bash '$DIR/server-init.sh' '$DIR' '$HOST_NAME'"

docker save "mboka-school-api:$RELEASE" "mboka-school-web:$RELEASE" | gzip -1 | ssh "$SSH_HOST" 'gunzip | docker load -q' >/dev/null
echo "deploy: images loaded on the server"

compose="cd '$DIR' && docker compose --env-file .env"
ssh "$SSH_HOST" "$compose up -d postgres >/dev/null 2>&1 && until $compose exec -T postgres pg_isready -U mboka -d mboka -q; do sleep 2; done"

# Backup before touching the schema (skipped on the very first release: nothing to save yet).
ssh "$SSH_HOST" "cd '$DIR' && set -a && . ./.env && set +a && \
  if [ \"\$RELEASE\" != none ]; then PG_DUMP='docker compose --env-file .env exec -T postgres pg_dump' bash backup.sh backups; fi"

# Migrations and seed run from here through a tunnel, with the owner role.
OWNER_PW="$(ssh "$SSH_HOST" "grep '^OWNER_DB_PASSWORD=' '$DIR/.env' | cut -d= -f2-")"
ADMIN_EMAIL="$(ssh "$SSH_HOST" "grep '^SEED_ADMIN_EMAIL=' '$DIR/.env' | cut -d= -f2-")"
ADMIN_PW="$(ssh "$SSH_HOST" "grep '^SEED_ADMIN_PASSWORD=' '$DIR/.env' | cut -d= -f2-")"
DEMO_PW="$(ssh "$SSH_HOST" "grep '^SEED_DEMO_PASSWORD=' '$DIR/.env' | cut -d= -f2-")"
ssh -f -o ExitOnForwardFailure=yes -L 15433:127.0.0.1:5433 "$SSH_HOST" sleep 120
DIRECT="postgresql://mboka:${OWNER_PW}@127.0.0.1:15433/mboka?schema=public"
(cd apps/api && DIRECT_DATABASE_URL="$DIRECT" DATABASE_URL="$DIRECT" npx prisma migrate deploy | grep -E "applied|No pending|migrations found")
(cd apps/api && DIRECT_DATABASE_URL="$DIRECT" DATABASE_URL="$DIRECT" NODE_ENV="${SEED_NODE_ENV:-production}" \
  SEED_ADMIN_EMAIL="$ADMIN_EMAIL" SEED_ADMIN_PASSWORD="$ADMIN_PW" SEED_DEMO_PASSWORD="$DEMO_PW" npx tsx prisma/seed.ts)
unset OWNER_PW ADMIN_PW DEMO_PW DIRECT

ssh "$SSH_HOST" "cd '$DIR' && sed -i 's/^RELEASE=.*/RELEASE=$RELEASE/' .env && $compose up -d >/dev/null 2>&1"
for i in $(seq 1 30); do
  if ssh "$SSH_HOST" "curl -sf http://127.0.0.1:\$(grep '^WEB_PORT=' '$DIR/.env' | cut -d= -f2)/api/v1/health/ready" >/dev/null; then
    echo "deploy: $RELEASE is live and ready"
    exit 0
  fi
  sleep 2
done
echo "deploy: readiness check failed — see: ssh $SSH_HOST 'cd $DIR && docker compose logs api --tail 50'" >&2
exit 1
