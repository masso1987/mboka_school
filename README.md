# Mboka School System

Multi-tenant school management SaaS for primary, secondary, technical and vocational schools
(Cameroon first). French and English, multi-currency, online-first with offline resilience.

**Status: Phases 0 to 5 delivered; Phase 6 in progress** (each phase is its own stacked pull request).
See [docs/architecture.md](docs/architecture.md) and [ADR 0001 — Tenant isolation](docs/adr/0001-tenant-isolation.md).
Running it: [operations runbook](docs/operations.md) · [security (ASVS)](docs/security.md) ·
[performance baseline](docs/performance.md) · [UAT checklist](docs/uat-checklist.md).

## What Phase 6 adds (in progress) — expansion

| Area | Delivered |
|---|---|
| Mobile Money | MTN MoMo (request to pay) and Orange Money (web payment) per school, credentials encrypted; payments settle only from the operator's own status answer, once, for the exact amount; unsigned notifications only trigger a check; periodic reconciliation and a "Check with the operator" button; operator hosts allow-listed |
| Payroll | Monthly payroll for Cameroon: CNPS (pension, family benefits, work accident, ceiling), IRPP with CAC, CFC, FNE, RAV, TDL; versioned, school-editable rules (defaults to validate with the accountant); draft → submitted → approved by someone else → paid, frozen by the database once submitted; monthly variables, unpaid days, PDF payslips, CNPS/tax declaration CSV; employees see their own payslips |
| Subscriptions | Self-service sign-up with e-mail confirmation and a 30-day trial; plans with student, campus and user limits; subscription invoices confirmed by the platform; 7-day grace then read-only (data always readable); Platform page for plans and payments ([operations §11](docs/operations.md)) |
| Hosting | Single-host deployment kit for school.mboketech.com (`deploy/`, [operations §10](docs/operations.md)) |

## What Phase 5 adds — resilience, security, production readiness

| Area | Delivered |
|---|---|
| Accounts | Two-factor authentication (TOTP, replay rejected, 10 single-use recovery codes), mandatory for platform admins and optionally for a school's privileged roles; password change; list and sign out sessions |
| Year rollover | Preview from class-council decisions with exceptions, then an idempotent commit (scenario 7): new enrollments, graduates, source year closed |
| Offline | Installable app shell (service worker, no API caching); attendance registers kept on the device and sent on reconnection; mark drafts restored; sync status and sign-out warning |
| Observability | Request ids end to end, JSON access log without personal data, Prometheus metrics (token-protected), liveness and readiness probes, slow-query warnings |
| Data | Full school export (JSON, exact amounts, audited); encrypted backups and a restore test that proves them |
| Delivery | Production Docker images (API, web, migrator), `.dockerignore`, nginx cache and security headers; measured load baseline |

## What Phase 2 adds — assessments and report cards

| Area | Delivered |
|---|---|
| Grading engine | Pure, deterministic (packages/shared/src/grading.ts): weighted subject averages, coefficients applied once, absences excluded by default, half-up rounding, competition or dense ranking, mentions; hand-verified unit tests |
| Rules | Versioned grading schemes (Cameroonian defaults: out of 20, pass mark 10); a change creates a new version |
| Marks | Assessments with maximum and weight; entry only by the assigned teacher; ABS / EXC / DISP / NC statuses; all-or-nothing CSV import with per-row errors; teacher comments |
| Workflow | Submit → approve by someone else → locked; send back or reopen with a reason; every later change recorded |
| Report cards | Generated only from approved marks; frozen snapshot with its rule version; regeneration creates a new version; publication; server-side PDF; public verification code |
| Class council | Promotion proposals from the annual average, recorded decisions and overrides; class and subject statistics |

## What Phase 4 adds — HR, dashboards, portals, communication

| Area | Delivered |
|---|---|
| HR | Contracts with expiry alerts, confidential compensation history (insert-only, every view logged), leave requests in working days with annual balances, approval by someone other than the requester or the person on leave |
| Portals | Parent and student accounts granted from the student file; a parent sees only linked children, a student only themself (anything else is 404); fees, attendance, published report cards (PDF) and timetable; revocable without touching the record |
| Communication | Announcements by audience (school, staff, parents, students, one class); in-app notifications with read status; automatic absence alerts (once per student and day) and report-card alerts; email delivery outbox with visible, retryable failures (EMAIL_PROVIDER=log in development) |
| Dashboards | One dashboard whose blocks follow permissions: school KPIs and finance for the director, approvals to process, today's lessons and registers for teachers, cash desk for accountants, children for parents |
| Reports | Year-over-year comparison; CSV exports (students, payments, staff without salaries, compensation) with the data's own permissions, formula neutralisation and audit |

## What Phase 3 adds — finance and multi-currency

| Area | Delivered |
|---|---|
| Currencies and rates | ISO 4217 reference data with minor units (XAF 0, EUR 2), currencies enabled per school, fixed reporting currency, append-only dated exchange rates read as "1 EUR = 655.957 XAF", never applied retroactively |
| Billing | Fee categories, schedules with installments by level or class, idempotent billing of enrollments (re-running bills only newcomers), invoices numbered `INV-2026-00042`, discounts / scholarships / waivers as lines, cancellation only without payments, student statements |
| Payments | Cash, transfer, card, cheque, Mobile Money; idempotency keys (a double click or retry never pays twice); oldest-due-first or explicit allocation across invoices and currencies; credit kept on overpayment; receipts `REC-2026-000042`; printable receipt |
| Corrections | Reversals keep the original payment and receipt and are dated in an open period; refunds of credit only, approved by someone other than the requester |
| Providers | Signed (HMAC-SHA256) callbacks, secrets encrypted at rest (AES-256-GCM), pending until confirmed, exact amount required, replays are no-ops |
| Cash registers | One open register per cashier and currency, closing report with expected vs counted and discrepancy |
| Expenses and budgets | Submission, approval by someone else, threshold requiring a higher permission, payment, cancellation, history; budget per year with overrun warnings and budget vs actual |
| Periods and reports | Financial periods that refuse back-dated postings once closed; summary (billed, collected, outstanding, collection rate, expenses, refunds, exchange differences, cash and operating results) marked final or provisional with documented definitions; aging by installment |

Configure `PAYMENT_SECRETS_KEY` (see `apps/api/.env.example`) before registering a payment provider.
Provider callback URL: `POST /api/v1/payment-callbacks/<school-slug>/<provider-code>` with header
`X-Mboka-Signature: hex(HMAC-SHA256(secret, raw body))`.

Not yet in Phase 3: real Mobile Money operator integrations (MTN MoMo, Orange Money — the generic signed
callback is the integration point), PDF and Excel exports, accounting exports, payroll costs, petty cash.

## What Phase 1 adds

| Module | Delivered |
|---|---|
| Academic structure | Periods (terms, semesters, sequences) inside the year without overlap, education levels and cycles, programs, subjects, classes with capacity, class subjects with coefficients and weekly hours |
| Students | Identity file, generated matricules (`2026-00042`), duplicate detection with explicit confirmation, guardians shared between siblings, archival instead of deletion, search and pagination |
| Admissions and enrollment | Admission workflow with enforced transitions, one active enrollment per student and year (DB-enforced), capacity checks, class changes and transfers/withdrawals that close records without erasing history |
| Staff | Staff records with generated numbers, link to a user account, teaching assignments (main, co-teacher, replacement) ended rather than deleted |
| Timetable | Rooms, weekly lessons, teacher/room/class double-booking rejected (exclusion constraints) with all conflicts reported |
| Attendance | Daily registers for assigned teachers, idempotent submission by client operation id, version conflicts never overwritten, corrections require a reason and are audited, past days restricted to management, per-student summary; the web app keeps unsent registers locally and retries when back online |
| Administration | Campuses within plan limits, user invitations with role selection, role changes (never one's own), access revocation |

Demo data (development only): the seed fills the demo school with levels 6e–Tle, eight subjects,
classes 6e A and 3e B with 24 students and guardians, rooms, a timetable and a teacher account
`enseignant@demo.mboka.local` (password `SEED_DEMO_PASSWORD`) assigned to French in both classes.

Not yet in Phase 1: Excel/CSV student import (STD-011), document uploads (STD-007), certificates
and student cards (STD-013), disciplinary records (ATT-008), absence notifications (ATT-006, needs
Phase 4 messaging), automatic timetable generation, and offline mode (delivered in Phase 5).

## What Phase 0 contains

| Area | Delivered |
|---|---|
| Monorepo | npm workspaces: `apps/api`, `apps/web`, `packages/shared` |
| Database | PostgreSQL 17, Prisma migrations, UUID keys, `timestamptz`/`date` conventions |
| Tenant isolation | Membership-verified tenant resolution, `tenant_id` scoping, **Row-Level Security** for a non-owner runtime role, composite FKs |
| Auth | Server-side sessions (httpOnly cookie, hashed tokens), CSRF synchronizer token, scrypt passwords, login rate limiting, timing-safe login |
| RBAC | `module.resource.action` permission catalogue, 9 default roles per school, `@RequirePermissions` guard |
| Tenants | Platform admin: provision, list, suspend/reactivate a school (TEN-001/007) |
| Audit | Append-only audit log (DB-enforced), written in the same transaction as the change |
| Reference module | Academic years: create/list/get, overlap prevented by an exclusion constraint (ACA-001/003) |
| Web | Login, permission-filtered navigation (spec §8.2), school switcher, FR/EN switcher, academic years screen, responsive layout |
| API docs | OpenAPI at `/api/docs` (non-production), generated from the zod schemas |
| Ops | Docker Compose, API and web Dockerfiles, GitHub Actions CI with a real Postgres |

### Not yet in Phase 0 (next items)

- MFA (TOTP) for platform and privileged roles (spec §11.1) — the `mfa_secret` column exists; flow not built.
- Invitations and password reset by email (owners currently receive a one-time temporary password).
- User and role management screens; campus-scoped role restrictions are modelled but not enforced.
- Staging/production environments and deployment pipeline.

## Getting started

Requirements: Node 22+, Docker.

```bash
npm install
```

```bash
cp apps/api/.env.example apps/api/.env
```

```bash
npm run db:up
```

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

Then in two terminals:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Open http://localhost:5173. Development accounts created by the seed:

| Account | Email | Password (from `.env`) |
|---|---|---|
| Platform super admin | `admin@mboka.local` | `SEED_ADMIN_PASSWORD` |
| Demo school director | `directeur@demo.mboka.local` | `SEED_DEMO_PASSWORD` |

The platform admin has no school membership, so the web app shows "no school" for it —
by design; it uses the `/api/v1/platform/tenants` endpoints. At its first sign-in it must set up
two-factor authentication (any authenticator app) before anything else works.

## Tests

```bash
npm test
```

Unit tests (shared, API, web). No database needed.

```bash
npm run test:e2e
```

Tenant-isolation, RLS, CSRF, permission and suspension tests against the migrated, seeded local database.

## Database roles

| Role | Used by | RLS |
|---|---|---|
| `mboka` (owner) | migrations, seed — `DIRECT_DATABASE_URL` | bypassed |
| `mboka_app` | the running API — `DATABASE_URL` | **enforced** |

`docker/postgres/init/01-roles.sql` creates `mboka_app` on first start of the local volume.
In other environments, create the role before running migrations (they grant to it if present).
