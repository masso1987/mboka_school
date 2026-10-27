# Performance — measured baseline

Measured on 2026-10-27 with [`scripts/load-test.mjs`](../scripts/load-test.mjs): one signed-in director,
20 concurrent clients looping for 30 s over the eight screens staff open most. The API ran as the
production Docker image (`NODE_ENV=production`, one Node process, `RATE_LIMIT_PER_MINUTE` raised so the
throttler stays out of the measurement), PostgreSQL 17 in Docker Desktop, on an 8-core Windows 10 laptop
that also ran the load generator. Development dataset (≈ 100 students, a few hundred finance and grade rows).

```bash
LOAD_PASSWORD=<demo director password> node scripts/load-test.mjs http://localhost:3002 20 30
```

## Results

1565 requests in 30.3 s = **52 req/s**, all 200.

| Route | Requests | p50 ms | p95 ms | p99 ms |
| --- | ---: | ---: | ---: | ---: |
| `GET /tenant/context` | 196 | 287 | 493 | 803 |
| `GET /dashboard` | 197 | 657 | 1104 | 1328 |
| `GET /students` | 194 | 298 | 482 | 800 |
| `GET /classes` | 195 | 291 | 614 | 778 |
| `GET /invoices` | 197 | 313 | 483 | 684 |
| `GET /payments` | 196 | 298 | 562 | 760 |
| `GET /finance/reports/summary` | 194 | 469 | 801 | 948 |
| `GET /notifications` | 196 | 270 | 449 | 790 |
| **All** | 1565 | 321 | 728 | 988 |

With a single client (no queueing) the same screens answer in 30–45 ms at p50, the dashboard in
~120 ms and the finance summary in ~90 ms.

## Where the time goes

| Observation | Value |
|---|---|
| Health probes (no session) | 960 req/s (`/live`), 750 req/s (`/ready`, one query) |
| Authenticated, single route, 20 clients | `/auth/me` 170 req/s, `/classes` 115 req/s |
| API container CPU during the mixed test | ≈ 4.5 cores |
| PostgreSQL CPU during the mixed test | ≈ 0.5 core |
| Node main thread (CPU profile) | ≈ 50 % idle; the largest JS share is the Prisma client |
| Connection pool 10 vs 17 (default) vs 40 | no gain — the pool is not the limit |

The database is not the bottleneck. Each authenticated request runs about a dozen statements
(session, membership and permissions, then the RLS-scoped interactive transaction: `BEGIN`, `set_config`,
the queries, `COMMIT`), and Prisma's query engine spends far more CPU per statement than PostgreSQL does.

## What this means

- A school of 1 000 students with 60 staff online at the morning peak produces a few requests per
  second; one API replica covers roughly ten such schools at peak with p95 under 1 s. Scale out with
  replicas (the API is stateless) before tuning further.
- Targets for go-live: p95 < 1 s on every list screen and < 1.5 s on the dashboard at expected peak;
  alert threshold in [operations.md](operations.md).

## Improvements, in order of expected gain

1. **Prisma driver adapter (`@prisma/adapter-pg`) with the query compiler** — removes the Rust engine
   hop that dominates CPU; needs a full regression run, so it is its own change.
2. **One scoped transaction per request** — the tenant guard and the handler currently open separate
   transactions; merging them saves 3–4 round trips per request.
3. **Dashboard aggregates in SQL** (single `GROUP BY` queries) and a 30–60 s per-school cache for
   school-wide KPIs.
4. Re-run this test on staging hardware (Linux, managed PostgreSQL) and replace the table above.
