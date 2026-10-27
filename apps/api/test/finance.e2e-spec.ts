/**
 * Phase 3 exit criteria (spec §14): partial payments, duplicate submissions and callbacks,
 * refunds, cross-currency transactions — plus reversals, closed periods (§13.2 scenarios
 * 3, 4, 11), cashier reconciliation, expense approval rules, budgets and reports.
 *
 * Amounts are worked out by hand in the comments; the API must match them to the unit.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { addDays, addMember, type Client, client, createApp, owner, provisionSchool, today } from './helpers';

const run = randomUUID().slice(0, 8);
const t = today();
let app: NestExpressApplication;
let director: Client;
let cashier: Client;
let accountant: Client;
let other: Client;
let tenantId: string;
let slug: string;
const ids: Record<string, string> = {};
const MOMO_SECRET = 'momo-test-secret-0123456789';

const pay = (c: Client, body: Record<string, unknown>) =>
  c.post('/payments', { idempotencyKey: randomUUID(), currency: 'XAF', receivedOn: t, ...body });

beforeAll(async () => {
  app = await createApp();
  const school = await provisionSchool(run, 'fin');
  tenantId = school.tenantId;
  slug = `fin-${run}`;
  director = await client(app, school.email, tenantId);
  const c = await addMember(tenantId, `cashier-${run}@e2e.local`, ['cashier']);
  const acc = await addMember(tenantId, `accountant-${run}@e2e.local`, ['chief_accountant']);
  cashier = await client(app, c.email, tenantId);
  accountant = await client(app, acc.email, tenantId);
  const otherSchool = await provisionSchool(run, 'fin2');
  other = await client(app, otherSchool.email, otherSchool.tenantId);

  // Academic fixtures: a year spanning today, one class, two enrolled students.
  ids.year = (await director.post('/academic-years', { name: `F-${run}`, startDate: addDays(t, -150), endDate: addDays(t, 200) }).expect(201)).body.id;
  ids.campus = (await director.get('/campuses').expect(200)).body[0].id;
  ids.level = (await director.post('/education-levels', { code: '6E', nameFr: '6e', nameEn: 'F1', cycle: 'SECONDARY_FIRST' }).expect(201)).body.id;
  ids.class = (await director.post('/classes', { academicYearId: ids.year, campusId: ids.campus, levelId: ids.level, code: '6A', name: '6e A' }).expect(201)).body.id;
  for (const [key, first] of [['s1', 'Amina'], ['s2', 'Junior']] as const) {
    ids[key] = (await director.post('/students', { firstName: first, lastName: `Fin${run}`, dateOfBirth: '2015-01-01' }).expect(201)).body.id;
    await director.post('/enrollments', { studentId: ids[key], classId: ids.class, enrolledOn: addDays(t, -100) }).expect(201);
  }
});

afterAll(async () => {
  await app?.close();
  await owner.$disconnect();
});

describe('setup: currencies and rates', () => {
  it('enables EUR and records a dated rate', async () => {
    const s = await director.put('/finance/settings', { enabledCurrencies: ['XAF', 'EUR'], expenseApprovalThreshold: '500000' }).expect(200);
    expect(s.body).toMatchObject({ reportingCurrency: 'XAF', enabledCurrencies: ['XAF', 'EUR'] });
    const r = await director.post('/finance/exchange-rates', { baseCurrency: 'EUR', quoteCurrency: 'XAF', rate: '655.957', effectiveDate: addDays(t, -30) }).expect(201);
    expect(r.body.label).toBe('1 EUR = 655.957 XAF');
  });

  it('refuses to drop the reporting currency and to overwrite a rate', async () => {
    expect((await director.put('/finance/settings', { enabledCurrencies: ['EUR'], expenseApprovalThreshold: '1' }).expect(422)).body.error.code).toBe(
      'REPORTING_CURRENCY_REQUIRED',
    );
    expect(
      (await director.post('/finance/exchange-rates', { baseCurrency: 'EUR', quoteCurrency: 'XAF', rate: '600', effectiveDate: addDays(t, -30) }).expect(409)).body.error
        .code,
    ).toBe('RATE_EXISTS');
  });
});

describe('billing', () => {
  it('bills a schedule once per enrollment, even when applied twice', async () => {
    ids.feeCat = (await director.post('/fee-categories', { code: 'SCO', nameFr: 'Scolarité', nameEn: 'Tuition', kind: 'TUITION' }).expect(201)).body.id;
    const schedule = await director
      .post('/fee-schedules', {
        academicYearId: ids.year,
        categoryId: ids.feeCat,
        name: 'Scolarité 6e',
        currency: 'XAF',
        levelId: ids.level,
        installments: [
          { label: 'Tranche 1', dueDate: addDays(t, -10), amount: '50000' },
          { label: 'Tranche 2', dueDate: addDays(t, 60), amount: '50000' },
        ],
      })
      .expect(201);
    expect(schedule.body.amount).toBe('100000');
    ids.schedule = schedule.body.id;
    expect((await director.post(`/fee-schedules/${ids.schedule}/apply`, { issueDate: addDays(t, -15) }).expect(200)).body).toEqual({ invoicesCreated: 2, alreadyBilled: 0 });
    expect((await director.post(`/fee-schedules/${ids.schedule}/apply`, { issueDate: addDays(t, -15) }).expect(200)).body).toEqual({ invoicesCreated: 0, alreadyBilled: 2 });
    const invoices = (await director.get(`/invoices?studentId=${ids.s1}`).expect(200)).body;
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ total: '100000', balance: '100000', paymentStatus: 'UNPAID' });
    expect(invoices[0].number).toMatch(/^INV-\d{4}-\d{5}$/);
    ids.inv1 = invoices[0].id;
    ids.inv2 = (await director.get(`/invoices?studentId=${ids.s2}`).expect(200)).body[0].id;
  });

  it('keeps other schools out', async () => {
    await other.get(`/invoices/${ids.inv1}`).expect(404);
    await other.post('/payments', { idempotencyKey: randomUUID(), studentId: ids.s1, method: 'BANK_TRANSFER', currency: 'XAF', amount: '1000', receivedOn: t, externalReference: 'VIR-X' }).expect(404);
  });
});

describe('payments', () => {
  it('requires an open cash register for cash and a reference for other methods', async () => {
    expect((await pay(accountant, { studentId: ids.s1, method: 'CASH', amount: '1000' }).expect(409)).body.error.code).toBe('NO_OPEN_CASHIER_SESSION');
    expect((await pay(accountant, { studentId: ids.s1, method: 'BANK_TRANSFER', amount: '1000' }).expect(422)).body.error.code).toBe('REFERENCE_REQUIRED');
  });

  it('rejects decimals XAF does not have', async () => {
    await cashier.post('/cashier-sessions', { currency: 'XAF', openingFloat: '10000' }).expect(201);
    expect((await pay(cashier, { studentId: ids.s1, method: 'CASH', amount: '100.5' }).expect(422)).body.error.code).toBe('AMOUNT_PRECISION');
  });

  it('records a partial payment, reduces the right balance and issues a receipt', async () => {
    ids.p1Key = randomUUID();
    const res = await cashier.post('/payments', { idempotencyKey: ids.p1Key, studentId: ids.s1, method: 'CASH', currency: 'XAF', amount: '30000', receivedOn: t }).expect(201);
    expect(res.body).toMatchObject({ status: 'CONFIRMED', amount: '30000', credit: '0', replayed: false });
    expect(res.body.receipt).toMatch(/^REC-\d{4}-\d{6}$/);
    expect(res.body.allocations).toEqual([expect.objectContaining({ invoiceId: ids.inv1, amount: '30000', invoiceAmount: '30000' })]);
    ids.p1 = res.body.id;
    expect((await director.get(`/invoices/${ids.inv1}`).expect(200)).body).toMatchObject({ paid: '30000', balance: '70000', paymentStatus: 'PARTIALLY_PAID' });
  });

  it('never records the same payment twice (scenario 3)', async () => {
    const body = { idempotencyKey: ids.p1Key, studentId: ids.s1, method: 'CASH', currency: 'XAF', amount: '30000', receivedOn: t };
    const replay = await cashier.post('/payments', body).expect(201);
    expect(replay.body).toMatchObject({ id: ids.p1, replayed: true });
    expect(await owner.payment.count({ where: { tenantId, studentId: ids.s1 } })).toBe(1);
    expect((await cashier.post('/payments', { ...body, amount: '31000' }).expect(409)).body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('settles an XAF invoice with euros at the rate in force (cross-currency)', async () => {
    // 100 EUR × 655.957 = 65 595.7 → 65 596 XAF (XAF has no decimals, half-up).
    const res = await pay(accountant, { studentId: ids.s1, method: 'BANK_TRANSFER', currency: 'EUR', amount: '100', receivedOn: addDays(t, -1), externalReference: 'VIR-001' }).expect(201);
    expect(res.body.allocations[0]).toMatchObject({ amount: '100.00', invoiceAmount: '65596', rate: '655.957' });
    expect(res.body.reporting).toEqual({ currency: 'XAF', amount: '65596', rate: '655.957' });
    ids.p2 = res.body.id;
    expect((await director.get(`/invoices/${ids.inv1}`).expect(200)).body.balance).toBe('4404');
  });

  it('applies a new rate only from its effective date and leaves credit on overpayment', async () => {
    await director.post('/finance/exchange-rates', { baseCurrency: 'EUR', quoteCurrency: 'XAF', rate: '650', effectiveDate: t }).expect(201);
    // Earlier payment keeps its own rate.
    expect((await director.get(`/payments/${ids.p2}`).expect(200)).body.reporting.rate).toBe('655.957');
    // 10 EUR × 650 = 6 500 XAF but only 4 404 is due → 4 404 / 650 = 6.775… → 6.78 EUR used, 3.22 EUR credit.
    const res = await pay(accountant, { studentId: ids.s1, method: 'BANK_TRANSFER', currency: 'EUR', amount: '10', externalReference: 'VIR-002' }).expect(201);
    expect(res.body.allocations[0]).toMatchObject({ amount: '6.78', invoiceAmount: '4404', rate: '650' });
    expect(res.body.credit).toBe('3.22');
    ids.p3 = res.body.id;
    expect((await director.get(`/invoices/${ids.inv1}`).expect(200)).body.paymentStatus).toBe('PAID');
  });
});

describe('refunds (separation of duties)', () => {
  it('limits refunds to credit and forbids approving one\'s own request', async () => {
    expect((await accountant.post(`/payments/${ids.p3}/refunds`, { amount: '5', reason: 'Trop-perçu' }).expect(422)).body.error.code).toBe('REFUND_EXCEEDS_CREDIT');
    const refund = await accountant.post(`/payments/${ids.p3}/refunds`, { amount: '3.22', reason: 'Trop-perçu restitué' }).expect(201);
    await accountant.post(`/refunds/${refund.body.id}/decision`, { approve: true }).expect(403);
    await cashier.post(`/refunds/${refund.body.id}/decision`, { approve: true }).expect(403);
    await director.post(`/refunds/${refund.body.id}/decision`, { approve: true }).expect(200);
    expect((await director.get(`/payments/${ids.p3}`).expect(200)).body.credit).toBe('0.00');
  });
});

describe('reversal and closed periods (scenario 11)', () => {
  it('reverses a payment without touching the original record', async () => {
    const res = await director.post(`/payments/${ids.p1}/reverse`, { reason: 'Billet contrefait' }).expect(200);
    expect(res.body).toMatchObject({ status: 'REVERSED', amount: '30000', receivedOn: t, reversal: { date: t } });
    expect(res.body.receipt).toMatch(/^REC-/);
    expect((await director.get(`/invoices/${ids.inv1}`).expect(200)).body.balance).toBe('30000');
    expect((await director.post(`/payments/${ids.p1}/reverse`, { reason: 'again' }).expect(409)).body.error.code).toBe('PAYMENT_NOT_CONFIRMED');
  });

  it('refuses postings into a closed period but reverses into the open one', async () => {
    ids.p4 = (await pay(accountant, { studentId: ids.s2, method: 'BANK_TRANSFER', amount: '5000', receivedOn: addDays(t, -5), externalReference: 'VIR-003' }).expect(201)).body.id;
    const period = await director.post('/finance/periods', { name: `P-${run}`, startDate: addDays(t, -20), endDate: addDays(t, -1) }).expect(201);
    await director.post(`/finance/periods/${period.body.id}/close`).expect(200);
    const late = await pay(accountant, { studentId: ids.s2, method: 'BANK_TRANSFER', amount: '1000', receivedOn: addDays(t, -2), externalReference: 'VIR-004' }).expect(409);
    expect(late.body.error.code).toBe('PERIOD_CLOSED');
    const rev = await director.post(`/payments/${ids.p4}/reverse`, { reason: 'Chèque rejeté' }).expect(200);
    expect(rev.body).toMatchObject({ receivedOn: addDays(t, -5), reversal: { date: t } });
  });

  it('keeps closed-period figures final and books the reversal on its own date', async () => {
    const closed = (await director.get(`/finance/reports/summary?from=${addDays(t, -20)}&to=${addDays(t, -1)}`).expect(200)).body;
    // Received in the closed range: 65 596 (EUR payment) + 5 000 (reversed later, not within the range).
    expect(closed).toMatchObject({ status: 'FINAL', collected: '70596', billed: '200000' });
  });
});

describe('provider callbacks (scenario 4)', () => {
  const signed = (body: object, secret = MOMO_SECRET) => {
    const raw = JSON.stringify(body);
    return request(app.getHttpServer())
      .post(`/api/v1/payment-callbacks/${slug}/momo`)
      .set('Content-Type', 'application/json')
      .set('X-Mboka-Signature', createHmac('sha256', secret).update(raw).digest('hex'))
      .send(raw);
  };

  it('keeps an initiated Mobile Money payment pending until the provider confirms', async () => {
    await director.put('/finance/providers', { code: 'momo', secret: MOMO_SECRET }).expect(200);
    ids.momoKey = randomUUID();
    const res = await cashier.post('/payments', { idempotencyKey: ids.momoKey, studentId: ids.s2, method: 'MOBILE_MONEY', provider: 'momo', currency: 'XAF', amount: '25000', receivedOn: t }).expect(201);
    expect(res.body).toMatchObject({ status: 'PENDING_VERIFICATION', receipt: null, allocations: [] });
    ids.p5 = res.body.id;
    expect((await director.get(`/invoices/${ids.inv2}`).expect(200)).body.balance).toBe('100000');
  });

  it('rejects unsigned callbacks and never confirms an unexpected amount', async () => {
    await signed({ transactionId: 'MM-1', status: 'SUCCESS', amount: '25000', currency: 'XAF', reference: ids.momoKey }, 'wrong-secret-0000000000').expect(401);
    const mismatch = await signed({ transactionId: 'MM-0', status: 'SUCCESS', amount: '2500', currency: 'XAF', reference: ids.momoKey }).expect(200);
    expect(mismatch.body.outcome).toBe('amount_mismatch');
    expect((await director.get(`/payments/${ids.p5}`).expect(200)).body.status).toBe('PENDING_VERIFICATION');
  });

  it('confirms once, however many times the provider repeats the callback', async () => {
    const cb = { transactionId: 'MM-1', status: 'SUCCESS', amount: '25000', currency: 'XAF', reference: ids.momoKey };
    expect((await signed(cb).expect(200)).body.outcome).toBe('confirmed');
    expect((await signed(cb).expect(200)).body.outcome).toBe('duplicate');
    expect((await signed(cb).expect(200)).body.outcome).toBe('duplicate');
    const p = (await director.get(`/payments/${ids.p5}`).expect(200)).body;
    expect(p).toMatchObject({ status: 'CONFIRMED', externalReference: 'MM-1' });
    expect(p.allocations).toHaveLength(1);
    expect(await owner.receipt.count({ where: { paymentId: ids.p5 } })).toBe(1);
    expect((await signed({ ...cb, status: 'FAILED' }).expect(200)).body.outcome).toBe('ignored_confirmed');
    expect((await director.get(`/invoices/${ids.inv2}`).expect(200)).body.balance).toBe('75000');
  });

  it('answers unknown schools with 404', async () => {
    await request(app.getHttpServer()).post('/api/v1/payment-callbacks/no-such-school/momo').send({}).expect(404);
  });
});

describe('cash register closing (FIN-014)', () => {
  it('reports the gap between counted and recorded cash', async () => {
    await pay(cashier, { studentId: ids.s2, method: 'CASH', amount: '20000' }).expect(201);
    const [session] = (await cashier.get('/cashier-sessions/mine').expect(200)).body;
    // Float 10 000 + cash 20 000 (the reversed 30 000 does not count) = 30 000 expected.
    expect(session).toMatchObject({ expectedAmount: '30000', cashTaken: '20000' });
    const closed = await cashier.post(`/cashier-sessions/${session.id}/close`, { countedAmount: '29500' }).expect(200);
    expect(closed.body).toMatchObject({ status: 'CLOSED', expectedAmount: '30000', countedAmount: '29500', discrepancy: '-500' });
    const log = await owner.auditLog.findFirst({ where: { tenantId, action: 'cashier_session.closed_with_discrepancy' } });
    expect(log).not.toBeNull();
  });
});

describe('expenses and budgets', () => {
  it('enforces who may submit and approve', async () => {
    ids.expCat = (await director.post('/expense-categories', { code: 'FOURN', nameFr: 'Fournitures', nameEn: 'Supplies' }).expect(201)).body.id;
    await director.put('/budgets', { academicYearId: ids.year, name: 'Budget', lines: [{ categoryId: ids.expCat, amount: '400000' }] }).expect(200);
    const exp = { categoryId: ids.expCat, description: 'Craies et cahiers', currency: 'XAF', expenseDate: t };
    await cashier.post('/expenses', { ...exp, amount: '1000' }).expect(403);
    const e1 = (await accountant.post('/expenses', { ...exp, amount: '300000' }).expect(201)).body;
    expect(e1.number).toMatch(/^EXP-\d{4}-\d{5}$/);
    await accountant.post(`/expenses/${e1.id}/actions`, { action: 'APPROVE' }).expect(403);
    expect((await director.post(`/expenses/${e1.id}/actions`, { action: 'APPROVE' }).expect(200)).body.budgetWarning).toBeNull();

    const big = (await director.post('/expenses', { ...exp, amount: '600000' }).expect(201)).body;
    expect((await accountant.post(`/expenses/${big.id}/actions`, { action: 'APPROVE' }).expect(403)).body.error.code).toBe('ABOVE_APPROVAL_THRESHOLD');

    const e2 = (await director.post('/expenses', { ...exp, amount: '200000' }).expect(201)).body;
    const approved = await accountant.post(`/expenses/${e2.id}/actions`, { action: 'APPROVE' }).expect(200);
    expect(approved.body.budgetWarning).toMatchObject({ code: 'BUDGET_OVERRUN', budgeted: '400000', afterApproval: '500000' });
    await accountant.post(`/expenses/${e2.id}/actions`, { action: 'PAY', paymentReference: 'CHQ-77' }).expect(200);

    const budget = (await director.get(`/budgets/${ids.year}`).expect(200)).body;
    expect(budget.lines[0]).toMatchObject({ budgeted: '400000', actual: '500000', overrun: true });
  });
});

describe('reports reconcile with the records', () => {
  it('computes today\'s collections, reversals, refunds and collection rate', async () => {
    const r = (await director.get(`/finance/reports/summary?from=${t}&to=${t}`).expect(200)).body;
    // Received today: 30 000 (p1, reversed) + 10 EUR × 650 = 6 500 (the whole payment, credit included)
    // + 25 000 (momo) + 20 000 (cash) = 81 500, minus reversals dated today: 30 000 (p1) + 5 000 (p4) → 46 500.
    // The 3.22 EUR credit returned to the payer appears as a refund, not as reduced collections.
    expect(r.collected).toBe('46500');
    expect(r.refunds).toBe('2093'); // 3.22 EUR × 650
    expect(r.expenses).toBe('500000');
    expect(r.status).toBe('PROVISIONAL');
    // Due by today: 50 000 per student. Paid as of today: s1 65 596 + 4 404 = 70 000 → capped 50 000; s2 25 000 + 20 000 = 45 000.
    expect(r).toMatchObject({ amountsDue: '100000', eligibleCollected: '95000', collectionRate: 95 });
    // Outstanding: s1 30 000 (after reversal) + s2 55 000.
    expect(r.outstanding).toBe('85000');
    expect(r.definitions.collectionRate).toMatch(/capped/);
  });

  it('ages overdue balances by installment', async () => {
    const aging = (await director.get(`/finance/reports/aging?asOf=${t}`).expect(200)).body;
    // s1 owes 30 000 and s2 55 000 against [50 000 due t−10, 50 000 due t+60]; payments cover the oldest first,
    // so not-due = 30 000 + 50 000 = 80 000 and 0–30 days overdue = 5 000 (s2).
    expect(aging.buckets).toMatchObject({ notDue: '80000', d0_30: '5000', d31_60: '0', d61_90: '0', d90plus: '0' });
  });
});

describe('database guarantees', () => {
  const appDb = new PrismaClient();
  afterAll(() => appDb.$disconnect());
  const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof appDb.$transaction>[0]>[0]) => Promise<T>) =>
    appDb.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });

  it('freezes a payment\'s amount even for the application role', async () => {
    await expect(asTenant((tx) => tx.payment.update({ where: { id: ids.p2 }, data: { amount: 1 } }))).rejects.toThrow(/immutable/);
  });

  it('forbids deleting allocations, receipts and rates', async () => {
    await expect(asTenant((tx) => tx.$executeRaw`DELETE FROM payment_allocations`)).rejects.toThrow();
    await expect(asTenant((tx) => tx.$executeRaw`DELETE FROM receipts`)).rejects.toThrow();
    await expect(asTenant((tx) => tx.$executeRaw`UPDATE exchange_rates SET rate = 1`)).rejects.toThrow();
  });
});
