# Operations runbook

For whoever deploys and runs Mboka. Security rationale: [security.md](security.md). Measured
performance: [performance.md](performance.md).

## 1. Components

| Component | Image / source | Notes |
|---|---|---|
| PostgreSQL 17 | managed service or `postgres:17-alpine` | the only stateful component; two roles (below) |
| API | `apps/api/Dockerfile` (default target) | stateless; scale horizontally; runs as `node` |
| Migrator | `apps/api/Dockerfile --target migrator` | one-shot job per release: `prisma migrate deploy` |
| Web | `apps/web/Dockerfile` (nginx) | static SPA + same-origin proxy of `/api/` |

Build:

```bash
docker compose --profile full build
```

```bash
docker build -f apps/api/Dockerfile --target migrator -t mboka-migrator .
```

## 2. Configuration (API)

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | runtime role `mboka_app` (RLS enforced) |
| `DIRECT_DATABASE_URL` | migrator only | owner role `mboka`; never given to the API |
| `APP_SECRETS_KEY` | yes | 32 random bytes, base64; encrypts payment credentials and MFA seeds. **Losing it locks out every MFA user and every payment provider.** Keep two copies in the secret store. `PAYMENT_SECRETS_KEY` is read as a fallback name. |
| `CORS_ORIGINS` | yes | the web origin(s) |
| `SESSION_TTL_HOURS` | no (12) | absolute session lifetime |
| `LOGIN_RATE_LIMIT` | no (10) | login attempts per client per minute |
| `RATE_LIMIT_PER_MINUTE` | no (300) | all routes, per client per minute |
| `SLOW_QUERY_MS` | no (500) | slow-query warning threshold; `0` disables |
| `METRICS_TOKEN` | recommended | bearer token for `/api/v1/health/metrics`; unset = 404 |
| `ACCESS_LOG` | no (on) | one JSON line per request; `off` to silence |
| `EMAIL_PROVIDER` | yes in production | `log` only in development |
| `PUBLIC_URL` | with Mobile Money | public address, used in operator callback URLs |
| `MOBILE_MONEY_POLL_SECONDS` | no (60) | reconciliation of pending operator payments; `0` disables |
| `MOBILE_MONEY_ALLOWED_HOSTS` | no | operator API hosts schools may configure (default: MTN sandbox and production, `api.orange.com`) |
| `TRUST_PROXY_HOPS` | no (1) | proxies in front of the API; 2 behind host nginx + web nginx |

Behind a proxy, the API sees client IPs through `X-Forwarded-For`; configure the proxy to
overwrite (not append to) that header, or rate limits apply to the proxy's address.

## 3. Release procedure

1. Take a backup (§5) and confirm it finished.
2. Run the migrator image with `DIRECT_DATABASE_URL`. Migrations are forward-only and additive;
   a failed migration leaves `_prisma_migrations` marked failed — fix forward, never edit an applied file.
3. Roll the API replicas (readiness probe gates traffic).
4. Roll the web image. `index.html` and `sw.js` are served `no-cache`, so browsers pick up the new
   version on next load; hashed assets are cached for a year.
5. Smoke test: sign in, open the dashboard, record one attendance register on the demo or a test class.

### Rollback

- **Application only** (no migration in the release): redeploy the previous API and web images.
- **With a migration**: migrations are additive, so the previous API image keeps working against the
  new schema; roll back the images only. Restoring the database (§6) is the last resort, because it
  loses every write since the backup.

### First deployment

1. Create the runtime role before migrating (`docker/postgres/init/01-roles.sql` shows the statements;
   use a strong password). Migrations grant to `mboka_app` when it exists.
2. Run the migrator, then the seed **once** with `NODE_ENV=production`: it creates the permission
   catalogue and the platform super-admin (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`), never the demo school.
3. Sign in as the super-admin: the app forces two-factor enrolment before anything else. Store the
   recovery codes offline. Then change the seed password (Account → Password).
4. Provision schools from `POST /api/v1/platform/tenants`.

## 4. Monitoring

| Probe / signal | Endpoint | Meaning |
|---|---|---|
| Liveness | `GET /api/v1/health/live` | process answers; never touches the DB — do not restart on DB outages |
| Readiness | `GET /api/v1/health/ready` (also `/health`) | DB answers; 503 `DATABASE_UNAVAILABLE` otherwise |
| Metrics | `GET /api/v1/health/metrics` + `Authorization: Bearer $METRICS_TOKEN` | Prometheus text: `mboka_http_requests_total`, `mboka_http_request_duration_seconds` (route templates, no ids), memory, uptime |
| Access log | stdout, logger `Access` | `{rid, method, route, status, ms, tenant}` — no bodies, no query strings |
| Slow queries | stdout, logger `Database` | `{slowQueryMs, sql}` — SQL text only, never parameter values |
| Errors | stdout, logger `HttpExceptionFilter` | 5xx with `rid=`; the client receives the same `requestId` to quote to support |

Suggested alerts:

- readiness failing for 2 minutes on any replica;
- 5xx rate > 1 % over 5 minutes (`status=~"5.."`);
- p95 of `mboka_http_request_duration_seconds` > 1.5 s for 10 minutes;
- more than 20 `slowQueryMs` lines in 5 minutes;
- e-mail delivery failures (Administration → notifications, `notification_deliveries.status = 'FAILED'`) growing;
- backup job missing for 26 hours.

Every request carries an `X-Request-Id` (accepted from the client when it is 8–64 safe characters,
generated otherwise) and returns it in the response header — use it to join web reports, access log
and error log.

## 5. Backups

```bash
BACKUP_PASSPHRASE=<from the secret store> scripts/backup.sh /var/backups/mboka
```

- `pg_dump` custom format, streamed into `openssl enc -aes-256-cbc -pbkdf2 -iter 200000`:
  no clear-text copy touches the disk. A `.sha256` file accompanies each archive.
- The archive includes grants (the `mboka_app` role must exist on the target server).
- Set `PG_DUMP="pg_dump -h <host>"` for a managed database instead of the compose container.
- Schedule: nightly full dump, kept 14 days; monthly kept 12 months; copy off-site (another region or provider).
- Managed PostgreSQL: also enable point-in-time recovery (WAL archiving) — it is what brings RPO under one hour.

| Objective | Target | How |
|---|---|---|
| RPO | ≤ 24 h with dumps alone; ≤ 15 min with PITR | nightly dump + WAL archiving |
| RTO | ≤ 4 h | restore (§6) measured at seconds for the demo dataset; scales with data size — re-measure monthly |

## 6. Restore

**Test restore** (monthly, and after each release with a migration):

```bash
BACKUP_PASSPHRASE=<passphrase> scripts/restore-test.sh /var/backups/mboka/mboka-<stamp>.dump.enc
```

It checks the checksum, restores into a scratch database, compares per-table row counts with the
live database, counts RLS policies, `mboka_app` grants and applied migrations, then drops the scratch database.

Result on 2026-10-27 (development dataset):

```
restore: 70 tables, 12864 rows, 67 RLS policies, 231 mboka_app grants, 8 migrations, 10s
restore-test: OK (row counts identical to the live database)
```

**Disaster restore**:

1. Stop the API replicas (readiness will fail anyway).
2. Create an empty database and the `mboka_app` role on the target server.
3. `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in <file> | pg_restore -d <db> --no-owner --exit-on-error`
4. Run the migrator (applies anything newer than the backup).
5. Start the API, run the smoke test, then tell schools what period of data was lost (from the backup timestamp).

## 7. School data export

`GET /api/v1/tenant/export` (permission `tenant.data.export`, director by default, MFA if the school
requires it for privileged permissions) returns every row of the school as one JSON file: all tables with
a `tenant_id`, the school record, and member identities (no password hashes, MFA seeds, sessions or
encrypted provider credentials). Amounts keep their exact decimal form. Each export is audited with row counts.
Use it for portability requests and at end of contract, before suspending the school.

## 8. Security operations

- **Platform admins** must use two-factor authentication; there is no bypass. A lost device is handled
  with a recovery code; if those are lost too, another super-admin clears `mfa_enabled_at`, `mfa_secret`
  and `mfa_recovery_codes` on the user row with the owner role, and the event is recorded in the incident log.
- **Schools** can require two-factor authentication for privileged permissions (Administration → Security).
- **Key rotation** (`APP_SECRETS_KEY`): not online yet — rotate by decrypting with the old key and re-encrypting
  with the new one in a maintenance window; plan it rather than doing it under pressure.
- **Suspected account compromise**: the user (or an administrator through the database) revokes all sessions
  (Account → Sessions → Sign out other sessions), changes the password, and the audit log is reviewed for the period.
- Before each release: `npm audit --omit=dev` and review of the findings.

## 9. Mobile Money (MTN MoMo, Orange Money)

Each school configures its own merchant account (`PUT /api/v1/finance/providers`, permission
`finance.settings.manage`); credentials are encrypted with `APP_SECRETS_KEY` and never returned.

| Kind | Body | Flow |
|---|---|---|
| `MTN_MOMO` | `code`, `baseUrl`, `targetEnvironment` (`sandbox` or MTN's production value), `subscriptionKey`, `apiUser`, `apiKey` | request to pay → the payer approves on their phone |
| `ORANGE_MONEY` | `code`, `baseUrl` (`https://api.orange.com`), `clientId`, `clientSecret`, `merchantKey`, `returnUrl` | web payment → the payer confirms on Orange's page (link shown to the cashier) |
| `SIGNED_WEBHOOK` | `code`, `secret` | aggregator posting HMAC-signed results (unchanged) |

- Operator notifications (`/api/v1/payment-callbacks/<school>/<code>/notify`) are unsigned: they only
  trigger a status request to the operator; the payment is confirmed from that answer only, once, and only
  for the exact amount. A reconciliation pass checks pending payments every `MOBILE_MONEY_POLL_SECONDS`.
- A refused request (4xx) fails the payment with its reason. An unreachable MTN keeps it pending (MTN may have
  received it); the status check settles it.
- **Before go-live**: run one real payment per operator in their sandbox with the school's credentials —
  the integration is tested against a local imitation of both APIs, not against the operators themselves.

## 10. Single-host deployment (school.mboketech.com)

`deploy/` holds the stack used on a shared VPS behind the host's nginx:

1. DNS `A` record to the server (done for `school.mboketech.com` → `64.177.41.97`).
2. From a clean checkout: `deploy/deploy.sh <ssh-host>` (add `SEED_NODE_ENV=development` for a showcase with the
   demo school). It creates `/opt/mboka-school/.env` with generated secrets on first run, ships the images,
   backs up, migrates through an SSH tunnel, seeds and starts the stack.
3. Once, on the server: copy `deploy/nginx/school.mboketech.com.conf` to `/etc/nginx/sites-available/`, link it in
   `sites-enabled`, `nginx -t && systemctl reload nginx`, then `certbot --nginx -d school.mboketech.com --hsts`.
4. Nightly backup (root crontab):
   `15 2 * * * cd /opt/mboka-school && set -a && . ./.env && PG_DUMP='docker compose --env-file .env exec -T postgres pg_dump' bash backup.sh backups && find backups -mtime +14 -delete`
5. The first super-admin password is in `/opt/mboka-school/.env` (`SEED_ADMIN_PASSWORD`); MFA enrolment is forced at first sign-in.
