# Security — OWASP ASVS 4.0 mapping

Target: ASVS **Level 2** for the whole application (school records of minors, payments, salaries).
Each row names the control, where it lives and the test that proves it. "Ops" rows are
deployment duties described in [operations.md](operations.md).

## V1 Architecture

| ASVS | Control | Where | Proof |
|---|---|---|---|
| 1.4.1 | Access control enforced server-side at a single choke point | `SessionGuard` → `TenantGuard` → `@RequirePermissions` (global guards) | every e2e suite; `tenant-isolation.e2e-spec.ts` |
| 1.4.4 | Tenant isolation defended twice: explicit `tenantId` filters **and** PostgreSQL RLS under a non-owner role | [ADR 0001](adr/0001-tenant-isolation.md), `prisma.scoped()` | RLS tests run as `mboka_app` |
| 1.6.x | Secrets encrypted at rest with one application key (AES-256-GCM) | `common/secrets.ts`, `APP_SECRETS_KEY` | `secrets.spec.ts` |
| 1.14.x | Migrations are a separate release step with the owner role; the API runs as `mboka_app` | `apps/api/Dockerfile` (`migrator` target) | Docker build |

## V2 Authentication

| ASVS | Control | Where | Proof |
|---|---|---|---|
| 2.1.1 / 2.1.7 | Passwords ≥ 10 characters, any characters, passphrases encouraged; new password must differ | `passwordChangeSchema` | `phase5.e2e-spec.ts` |
| 2.2.1 | Login throttled per client (`LOGIN_RATE_LIMIT` / min) on top of the global limit | `auth.controller.ts`, `RATE_LIMIT_PER_MINUTE` | `tenant-isolation.e2e-spec.ts` |
| 2.2.2 | Uniform error for unknown e-mail and wrong password; constant-time verification | `password.ts`, `auth.controller.ts` | e2e login tests |
| 2.4.1 | scrypt (N=2^15) with per-user salt, NFKC-normalised | `auth/password.ts` | unit tests |
| 2.5.x | Password change requires the current password and signs out every other session | `account.service.ts` | `phase5.e2e-spec.ts` |
| 2.7 / 2.8 | TOTP (RFC 6238, 30 s, ±1 step), **replay rejected** (last accepted step stored), seeds encrypted at rest | `auth/totp.ts`, `account.service.ts` | `totp.spec.ts` (RFC vectors), `phase5.e2e-spec.ts` |
| 2.8.x | 10 single-use recovery codes, stored as SHA-256 hashes, shown once | `account.service.ts` | `phase5.e2e-spec.ts` |
| 2.x (policy) | Platform super-admins **must** enrol MFA (no other route works until they do); schools can require MFA for privileged permissions | `session.guard.ts`, `tenant.guard.ts` (`PRIVILEGED`) | `phase5.e2e-spec.ts` |

## V3 Session management

| ASVS | Control | Where | Proof |
|---|---|---|---|
| 3.2.1–3.2.3 | 256-bit random token in an `HttpOnly`, `SameSite=Lax`, `Secure` (production) cookie; only its SHA-256 is stored | `session.service.ts`, `auth.controller.ts` | e2e |
| 3.3.1 | Logout revokes the session server-side; absolute lifetime `SESSION_TTL_HOURS` | `session.service.ts` | e2e |
| 3.3.3 / 3.3.4 | Users list their sessions and revoke any or all others; password change and MFA activation revoke the others | `GET/DELETE /auth/sessions` | `phase5.e2e-spec.ts` |
| 3.5.x | A session that passed the password but not MFA is limited to the MFA routes | `mfaVerified` flag, `@AllowDuringMfa` | `phase5.e2e-spec.ts` |

## V4 Access control

| ASVS | Control | Where | Proof |
|---|---|---|---|
| 4.1.3 | Least privilege: 51 catalogued permissions, default roles are templates | `packages/shared/src/permissions.ts`, `roles.ts` | `permissions.test.ts` |
| 4.2.1 | IDOR: every lookup is tenant-scoped; portal users get 404 for anything not theirs | `assertCanSee`, RLS | `community.e2e-spec.ts` |
| 4.3.x | Separation of duties: grades approved by someone else, refunds/reversals approved by someone else, leave not approved by the requester | finance, grades, HR services | finance, grades, community e2e |
| 4.3.1 | Platform admins manage tenants but get no school data through that role | `platform-tenants.controller.ts` | `tenant-isolation.e2e-spec.ts` |

## V5 Validation, sanitisation and encoding

| ASVS | Control | Where | Proof |
|---|---|---|---|
| 5.1.x | Every body and query validated by zod schemas shared with the web app | `common/zod.ts`, `packages/shared` | e2e validation cases |
| 5.2.x / 5.3.x | No HTML rendering of user input on the server; React escapes; PDF text only | web, `pdfkit` | — |
| 5.3.4 | Parameterised SQL only (Prisma, tagged `$queryRaw`); the one dynamic identifier (export) is regex-checked from `information_schema` | `export.service.ts` | `phase5.e2e-spec.ts` |
| 5.2.x | CSV exports neutralise formulas (`=`, `+`, `-`, `@`) | `community/insights.service.ts` | `community.e2e-spec.ts` |

## V7 Errors and logging

| ASVS | Control | Where | Proof |
|---|---|---|---|
| 7.1.1 / 7.1.2 | No secrets, tokens, passwords, bodies or query strings in logs; slow-query logs carry SQL text without parameters | `observability.ts`, `prisma.service.ts`, `http-exception.filter.ts` | code review |
| 7.2.x | Append-only audit log for security and money events (logins, MFA, role and policy changes, exports, payments, reversals) | `AuditService`, DB triggers | e2e |
| 7.4.1 | Generic 5xx message with a request id the user can quote; stack only in server logs | `http-exception.filter.ts` | `phase5.e2e-spec.ts` |

## V8 Data protection

| ASVS | Control | Where | Proof |
|---|---|---|---|
| 8.1.x | Compensation readable only with `hr.compensation.read`, each view audited | HR | `community.e2e-spec.ts` |
| 8.2.x | Offline copies (registers, mark drafts) are per school and erased at sign-out, with a warning if unsynchronised | `apps/web/src/lib/offline.ts` | manual (UAT F) |
| 8.3.x | School data export for portability, privileged + audited, without credentials or password hashes | `GET /tenant/export` | `phase5.e2e-spec.ts` |
| 8.3.x | Backups encrypted (AES-256, PBKDF2) before touching disk; restore tested | `scripts/backup.sh`, `restore-test.sh` | [operations.md](operations.md) |

## V9 Communications, V14 Configuration

| ASVS | Control | Where | Proof |
|---|---|---|---|
| 9.1.x | TLS terminated at the reverse proxy / load balancer; HSTS there | Ops | — |
| 13.2.3 | CSRF: synchroniser token header on every state-changing request | `session.guard.ts` (`X-CSRF-Token`) | e2e |
| 13.2.x | Provider callbacks authenticated by HMAC over the raw body | finance | `finance.e2e-spec.ts` |
| 14.4.x | Security headers: Helmet (CSP, HSTS, nosniff, frame-ancestors) on the API; nosniff, `X-Frame-Options`, referrer policy on nginx | `bootstrap.ts`, `apps/web/nginx.conf` | `curl -I` |
| 14.1.x | Images contain no `.env`, no host `node_modules` (`.dockerignore`); API runs as `node`, not root | Dockerfiles | Docker build |
| 14.2.x | Dependencies locked (`package-lock.json`), CI installs with `npm ci` | CI | CI |

## Known gaps (accepted for go-live, tracked)

- No WebAuthn/passkeys yet (TOTP only).
- No automated dependency-vulnerability gate in CI (`npm audit` is run manually before each release).
- Account lockout is throttling-based (per client), not per account, to avoid lock-out denial of service.
