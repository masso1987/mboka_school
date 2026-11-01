#!/usr/bin/env node
// Read-heavy load test against a running API (docs/performance.md).
//
//   LOAD_EMAIL=directeur@demo.mboka.local LOAD_PASSWORD=... node scripts/load-test.mjs [baseUrl] [concurrency] [seconds]
//
// Signs in once, then `concurrency` workers loop over the screens staff open most (dashboard,
// student list, class list, invoices, payments, finance summary) for `seconds` and report
// p50/p95/p99 per route. The API must run with RATE_LIMIT_PER_MINUTE raised, or the throttler
// answers 429 and the test measures that instead. The password is read from the environment
// and never printed.
const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '') + '/api/v1';
const concurrency = Number(process.argv[3] ?? 20);
const seconds = Number(process.argv[4] ?? 30);
const email = process.env.LOAD_EMAIL ?? 'directeur@demo.mboka.local';
const password = process.env.LOAD_PASSWORD;
if (!password) {
  console.error('Set LOAD_PASSWORD (the demo director password from apps/api/.env).');
  process.exit(2);
}

const login = await fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const me = await (await fetch(`${base}/auth/me`, { headers: { cookie } })).json();
const tenantId = me.tenants?.[0]?.id;
if (!tenantId) throw new Error('no school membership for this account');
const headers = { cookie, 'X-Tenant-Id': tenantId };

const today = new Date().toISOString().slice(0, 10);
const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
const routes = [
  '/tenant/context',
  '/dashboard',
  '/students?pageSize=25',
  '/classes',
  '/invoices?pageSize=25',
  '/payments?pageSize=25',
  `/finance/reports/summary?from=${yearAgo}&to=${today}`,
  '/notifications',
];

const samples = new Map(routes.map((r) => [r, []]));
const statuses = new Map();
const deadline = Date.now() + seconds * 1000;

async function worker(offset) {
  let i = offset;
  while (Date.now() < deadline) {
    const route = routes[i++ % routes.length];
    const t0 = performance.now();
    let status = 0;
    try {
      const res = await fetch(base + route, { headers });
      await res.arrayBuffer();
      status = res.status;
    } catch {
      status = -1;
    }
    samples.get(route).push(performance.now() - t0);
    statuses.set(status, (statuses.get(status) ?? 0) + 1);
  }
}

const started = performance.now();
await Promise.all(Array.from({ length: concurrency }, (_, k) => worker(k)));
const elapsed = (performance.now() - started) / 1000;

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
const row = (name, xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return `| ${name} | ${s.length} | ${pct(s, 50).toFixed(0)} | ${pct(s, 95).toFixed(0)} | ${pct(s, 99).toFixed(0)} |`;
};
const all = [...samples.values()].flat();
console.log(`\n${all.length} requests in ${elapsed.toFixed(1)} s with ${concurrency} concurrent clients = ${(all.length / elapsed).toFixed(0)} req/s`);
console.log(`statuses: ${JSON.stringify(Object.fromEntries(statuses))}\n`);
console.log('| Route | Requests | p50 ms | p95 ms | p99 ms |');
console.log('| --- | ---: | ---: | ---: | ---: |');
for (const [route, xs] of samples) console.log(row(`\`GET ${route.split('?')[0]}\``, xs));
console.log(row('**All**', all));
process.exit([...statuses.keys()].every((s) => s === 200) ? 0 : 1);
