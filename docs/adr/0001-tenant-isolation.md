# ADR 0001 — Tenant isolation

- **Status:** Accepted (Phase 0)
- **Spec references:** §2.3, §3.3, §6.4, §11.2, §18 (highest-risk area #1)

## Context

Mboka is a multi-tenant SaaS. A defect that exposes one school's student, staff or
financial records to another school is the most serious failure the product can have.
The spec requires tenant resolution from verified membership, scoped queries, PostgreSQL
Row-Level Security as defense in depth, composite constraints, and automated cross-tenant tests.

## Decision

Shared database, shared schema, `tenant_id` column on every tenant-owned table, with three
independent layers of enforcement:

### 1. Application layer — tenant resolution
- The tenant is selected with the `X-Tenant-Id` header but **resolved** by `TenantGuard`
  from the authenticated user's *active membership* in that tenant. A header naming a tenant
  the user is not a member of is answered `403 FORBIDDEN`, identical to a malformed id.
- The guard loads the caller's effective permissions *in that tenant* and enforces the
  route's `@RequirePermissions(...)`. Suspended tenants are rejected with `TENANT_SUSPENDED`.
- Platform roles (`SUPER_ADMIN`, `SUPPORT`) live on the user record and carry **no**
  tenant-data access. A support agent needs an explicit, audited membership to see school data.

### 2. Application layer — query scoping
- Every service filters by `tenantId` explicitly (`where: { id, tenantId }`), so a record id
  from another tenant yields `404`, never data.

### 3. Database layer — Row-Level Security
- The API connects as `mboka_app`: not the table owner, not a superuser, `NOBYPASSRLS`.
  Migrations and seeds use the owner role through `DIRECT_DATABASE_URL`.
- All tenant data access goes through `PrismaService.scoped({ tenantId, userId }, fn)`, which
  opens a transaction and sets `app.tenant_id` / `app.user_id` with `set_config(…, true)`
  (transaction-local, so pooled connections cannot leak context).
- Policies (`prisma/migrations/0002_rls`) are `ENABLE` + `FORCE ROW LEVEL SECURITY` with
  `USING` and `WITH CHECK` on `tenant_id = app_current_tenant()`. Without context, queries
  return nothing and inserts fail.
- `user_tenant_memberships` is additionally readable by its own user (to list "my schools").
- `audit_logs` is append-only for `mboka_app` (no `UPDATE`/`DELETE` grant). It is written
  with `createMany` because Postgres applies SELECT policies to `INSERT … RETURNING`, and
  platform rows (no tenant) are intentionally unreadable by the runtime role.
- Composite foreign keys `(tenant_id, id)` on role assignments and role permissions make a
  cross-tenant relationship impossible even for a buggy query running with the right context.

## Not covered by RLS (by design, Phase 0)

| Table | Why | Control |
|---|---|---|
| `tenants` | Platform-level; needed before a tenant context exists | Only platform controllers and membership-joined queries read it |
| `users`, `sessions` | Identity is global; login runs before any tenant is known | Never returned in bulk; only own record via `/auth/me` |
| `permissions` | Global catalogue | Read-only for `mboka_app` |

## Consequences

- **Every new tenant-owned table must**: have `tenant_id`, a `@@unique([tenantId, id])` for
  composite FKs, be added to the RLS loop in a migration, and be read/written only inside
  `prisma.scoped(...)`. The checklist in `docs/architecture.md` repeats this.
- Interactive transactions per request cost a round trip for `set_config`; acceptable at
  the planned scale (§12.1) and revisited under load testing.
- Background jobs, exports and caches (later phases) must carry the tenant id and re-run
  through `scoped(...)`; cache keys and storage paths must be prefixed with it.

## Verification

`apps/api/test/tenant-isolation.e2e-spec.ts` covers: foreign-tenant selection, foreign record
by id, malformed vs unknown tenant ids, RLS with no context, RLS cross-tenant writes,
audit immutability, and suspension. CI runs it against a real PostgreSQL.
