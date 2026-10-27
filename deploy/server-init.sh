#!/usr/bin/env bash
# Runs ON the server, once per installation (idempotent): creates the secrets file.
#
#   sudo bash server-init.sh /opt/mboka-school school.mboketech.com
#
# Every secret is generated here and never leaves the server through this script. Read them with
# `sudo cat /opt/mboka-school/.env` when you need one (e.g. the first super-admin password).
# Keep a copy of APP_SECRETS_KEY and BACKUP_PASSPHRASE outside the server: losing the first locks out
# every MFA user and payment provider; losing the second makes the backups unreadable.
set -euo pipefail
DIR="${1:?install directory}"
HOST="${2:?public host name}"
mkdir -p "$DIR/backups"
chmod 700 "$DIR" "$DIR/backups"
ENV="$DIR/.env"
if [ -f "$ENV" ]; then
  echo "secrets: $ENV already exists, kept"
  exit 0
fi
rand() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
umask 077
cat > "$ENV" <<EOF
PUBLIC_HOST=$HOST
RELEASE=none
WEB_PORT=3110
OWNER_DB_PASSWORD=$(rand 40)
APP_DB_PASSWORD=$(rand 40)
APP_SECRETS_KEY=$(openssl rand -base64 32)
METRICS_TOKEN=$(rand 40)
BACKUP_PASSPHRASE=$(rand 48)
SEED_ADMIN_EMAIL=admin@mboketech.com
SEED_ADMIN_PASSWORD=$(rand 24)
# Demo school accounts (directeur@ / enseignant@demo.mboka.local), seeded only with SEED_NODE_ENV=development.
SEED_DEMO_PASSWORD=$(rand 20)
EOF
echo "secrets: $ENV created (mode 600)"
