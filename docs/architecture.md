# Architecture (Phase 0)

Modular monolith (spec §7.2): one API deployment and one PostgreSQL database, with modules
separated by folder and service boundaries. Extract a service only when evidence justifies it.

```
apps/
  api/        NestJS 11 + Prisma 6 (REST, /api/v1, OpenAPI at /api/docs outside production)
  web/        React 19 + Vite + Tailwind 4 + TanStack Query + i18next (FR/EN)
packages/
  shared/     Permission catalogue, default roles, zod request schemas, API error type
docker/       Local Postgres init (runtime role)
docs/         Architecture, ADRs
```

## Request lifecycle

1. **ThrottlerGuard** — global rate limit (300/min), login 10/min (`LOGIN_RATE_LIMIT`).
2. **SessionGuard** (global) — resolves the `mboka_sid` httpOnly cookie to a server-side
   session (only its SHA-256 is stored). Non-GET requests must send `X-CSRF-Token` equal to
   the session's synchronizer token. Routes opt out with `@Public()`.
3. **TenantGuard** (per route, via `@RequirePermissions(...)`) — verifies membership in the
   `X-Tenant-Id` tenant, loads permissions there, enforces the listed ones. See ADR 0001.
4. **ZodPipe** — validates bodies with the same schemas the web forms use; the schema also
   documents the body in OpenAPI.
5. **Service** — runs inside `prisma.scoped({ tenantId, userId }, tx => …)`, filters by
   `tenantId`, and writes the audit record with the same `tx`.
6. **HttpExceptionFilter** — every error becomes `{ error: { code, message, details? } }`;
   5xx log the stack only, never request bodies.

## Adding a tenant-scoped module — checklist

- [ ] Prisma model has `tenantId`, `@@unique([tenantId, id])`, `@@map` snake_case, `Timestamptz`/`Date` types, `Decimal` for money.
- [ ] Relations to other tenant tables use composite `(tenantId, id)` foreign keys.
- [ ] New migration adds the table to RLS (`ENABLE` + `FORCE` + `tenant_isolation` policy) and grants.
- [ ] New permissions added to `packages/shared/src/permissions.ts` and to default roles; run `npm run db:seed`.
- [ ] Every query inside `prisma.scoped(...)` **and** filtered by `tenantId`.
- [ ] Controllers use `@RequirePermissions(...)`; bodies use `@ZodBody(schema)` + `@ApiZodBody(schema)`.
- [ ] Sensitive changes call `audit.record(..., tx)`.
- [ ] e2e test: cross-tenant read by id → 404, missing permission → 403.
- [ ] FR and EN strings added (the locale parity test fails otherwise).
- [ ] UI has loading, empty, error and success states; nav item permission set in `apps/web/src/nav.ts`.

## Conventions

- Dates that are calendar dates (`start_date`) are `DATE` and travel as `YYYY-MM-DD`; instants are `timestamptz` in UTC.
- Money (Phase 3): `Decimal`/`NUMERIC` with an ISO 4217 code next to every amount; never floats.
- Posted financial records are never updated or deleted; corrections are new records.
- Translation keys, never hard-coded UI text. API returns stable error `code`s that the UI translates.
