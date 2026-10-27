/**
 * Phase 6 — Mobile Money through the operators (MTN MoMo, Orange Money), against a local fake of
 * their APIs. The rule under test: an operator notification is never trusted; only the operator's
 * own status answer settles a payment, once, for the exact amount asked.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { clearOperatorTokens } from '../src/finance/mobile-money';
import { MobileMoneyService } from '../src/finance/mobile-money.service';
import { addDays, type Client, client, createApp, owner, provisionSchool, today } from './helpers';

process.env.MOBILE_MONEY_POLL_SECONDS = '0';
process.env.PUBLIC_URL = 'https://school.example.test';

const run = randomUUID().slice(0, 8);
const t = today();
let app: NestExpressApplication;
let dir: Client;
let tenantId: string;
let slug: string;
const ids: Record<string, string> = {};

// ------------------------------------------------------------------ fake operator APIs

interface Captured {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: string;
}
const captured: Captured[] = [];
/** MTN status per X-Reference-Id; Orange status per order_id. */
const mtnStatus = new Map<string, { status: string; amount: string; currency: string; financialTransactionId?: string; reason?: string }>();
const orangeStatus = new Map<string, { status: string; txnid?: string }>();
let mtnRequestToPayCode = 202;
let fake: Server;
let fakeUrl: string;

function startFake(): Promise<void> {
  fake = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const path = req.url ?? '';
      captured.push({ method: req.method ?? '', path, headers: req.headers, body });
      const json = (code: number, b?: object) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(b ? JSON.stringify(b) : undefined);
      };
      if (path === '/collection/token/') return json(200, { access_token: 'mtn-token', token_type: 'access_token', expires_in: 3600 });
      if (path === '/collection/v1_0/requesttopay' && req.method === 'POST') {
        const b = JSON.parse(body) as { amount: string; currency: string };
        const ref = String(req.headers['x-reference-id']);
        if (mtnRequestToPayCode === 202) mtnStatus.set(ref, { status: 'PENDING', amount: b.amount, currency: b.currency });
        return json(mtnRequestToPayCode);
      }
      const m = path.match(/^\/collection\/v1_0\/requesttopay\/(.+)$/);
      if (m) {
        const s = mtnStatus.get(decodeURIComponent(m[1]!));
        return s ? json(200, { ...s, externalId: m[1] }) : json(404, { code: 'RESOURCE_NOT_FOUND' });
      }
      if (path === '/oauth/v3/token') return json(200, { access_token: 'orange-token', token_type: 'Bearer', expires_in: 7776000 });
      if (path === '/orange-money-webpay/cm/v1/webpayment') {
        const b = JSON.parse(body) as { order_id: string };
        orangeStatus.set(b.order_id, { status: 'INITIATED' });
        return json(201, { status: 201, message: 'OK', pay_token: `pt-${b.order_id}`, payment_url: `https://pay.example/${b.order_id}`, notif_token: `nt-${b.order_id}` });
      }
      if (path === '/orange-money-webpay/cm/v1/transactionstatus') {
        const b = JSON.parse(body) as { order_id: string; pay_token: string };
        if (b.pay_token !== `pt-${b.order_id}`) return json(400, { message: 'bad token' });
        return json(201, orangeStatus.get(b.order_id) ?? { status: 'FAILED' });
      }
      json(404);
    });
  });
  return new Promise((resolve) =>
    fake.listen(0, '127.0.0.1', () => {
      fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
      resolve();
    }),
  );
}

const pay = (body: Record<string, unknown>) =>
  dir.post('/payments', { idempotencyKey: randomUUID(), studentId: ids.student, method: 'MOBILE_MONEY', currency: 'XAF', receivedOn: t, ...body });
const notify = (provider: string, body: object) => request(app.getHttpServer()).post(`/api/v1/payment-callbacks/${slug}/${provider}/notify`).send(body);
const balance = async () => (await dir.get(`/invoices/${ids.invoice}`).expect(200)).body.balance as string;

beforeAll(async () => {
  await startFake();
  clearOperatorTokens();
  app = await createApp();
  const school = await provisionSchool(run, 'momo');
  tenantId = school.tenantId;
  slug = `momo-${run}`;
  dir = await client(app, school.email, tenantId);
  ids.year = (await dir.post('/academic-years', { name: `M-${run}`, startDate: addDays(t, -150), endDate: addDays(t, 200) }).expect(201)).body.id;
  ids.campus = (await dir.get('/campuses').expect(200)).body[0].id;
  ids.level = (await dir.post('/education-levels', { code: '6E', nameFr: '6e', nameEn: 'F1', cycle: 'SECONDARY_FIRST' }).expect(201)).body.id;
  ids.class = (await dir.post('/classes', { academicYearId: ids.year, campusId: ids.campus, levelId: ids.level, code: '6A', name: '6e A' }).expect(201)).body.id;
  ids.student = (await dir.post('/students', { firstName: 'Momo', lastName: `Pay${run}`, dateOfBirth: '2015-01-01' }).expect(201)).body.id;
  await dir.post('/enrollments', { studentId: ids.student, classId: ids.class, enrolledOn: addDays(t, -100) }).expect(201);
  const cat = (await dir.post('/fee-categories', { code: 'SCO', nameFr: 'Scolarité', nameEn: 'Tuition', kind: 'TUITION' }).expect(201)).body.id;
  const schedule = (
    await dir
      .post('/fee-schedules', {
        academicYearId: ids.year,
        categoryId: cat,
        name: 'Scolarité',
        currency: 'XAF',
        levelId: ids.level,
        installments: [{ label: 'Tranche 1', dueDate: addDays(t, 30), amount: '100000' }],
      })
      .expect(201)
  ).body.id;
  await dir.post(`/fee-schedules/${schedule}/apply`, { issueDate: addDays(t, -5) }).expect(200);
  ids.invoice = (await dir.get(`/invoices?studentId=${ids.student}`).expect(200)).body[0].id;
});

afterAll(async () => {
  await app?.close();
  await owner.$disconnect();
  await new Promise((r) => fake.close(r));
});

describe('provider configuration', () => {
  it('stores operator credentials encrypted and never returns them', async () => {
    await dir
      .put('/finance/providers', {
        kind: 'MTN_MOMO',
        code: 'mtn',
        baseUrl: fakeUrl,
        targetEnvironment: 'sandbox',
        subscriptionKey: 'sub-key-123',
        apiUser: randomUUID(),
        apiKey: 'api-key-secret-456',
      })
      .expect(200, { code: 'mtn', kind: 'MTN_MOMO', isActive: true });
    await dir
      .put('/finance/providers', {
        kind: 'ORANGE_MONEY',
        code: 'orange',
        baseUrl: fakeUrl,
        clientId: 'client-id',
        clientSecret: 'client-secret-789',
        merchantKey: 'merchant-key',
        returnUrl: 'https://school.example.test/fees',
      })
      .expect(200);
    const list = await dir.get('/finance/providers').expect(200);
    expect(JSON.stringify(list.body)).not.toMatch(/api-key-secret|client-secret|sub-key/);
    const row = await owner.paymentProvider.findUniqueOrThrow({ where: { tenantId_code: { tenantId, code: 'mtn' } } });
    expect(row.secretEncrypted).not.toContain('api-key-secret-456');
  });

  it('refuses operator API hosts outside the allow-list', async () => {
    const res = await dir
      .put('/finance/providers', { kind: 'MTN_MOMO', code: 'evil', baseUrl: 'https://169.254.169.254/latest', targetEnvironment: 'sandbox', subscriptionKey: 'k', apiUser: 'u', apiKey: 'k' })
      .expect(422);
    expect(res.body.error.code).toBe('PROVIDER_HOST_NOT_ALLOWED');
  });

  it('keeps the original signed-webhook configuration working', async () => {
    await dir.put('/finance/providers', { code: 'aggregator', secret: 'aggregator-secret-0123456789' }).expect(200, { code: 'aggregator', kind: 'SIGNED_WEBHOOK', isActive: true });
  });
});

describe('MTN MoMo', () => {
  it('requires the number to debit', async () => {
    expect((await pay({ provider: 'mtn', amount: '30000' }).expect(422)).body.error.code).toBe('PAYER_MSISDN_REQUIRED');
  });

  it('sends a request to pay and keeps the payment pending', async () => {
    const res = await pay({ provider: 'mtn', amount: '30000', payerMsisdn: '237670000001' }).expect(201);
    expect(res.body.status).toBe('PENDING_VERIFICATION');
    ids.mtn = res.body.id;
    const call = captured.find((c) => c.path === '/collection/v1_0/requesttopay')!;
    expect(call.headers['x-reference-id']).toBe(ids.mtn);
    expect(call.headers['x-target-environment']).toBe('sandbox');
    expect(call.headers['authorization']).toBe('Bearer mtn-token');
    expect(call.headers['x-callback-url']).toBe(`https://school.example.test/api/v1/payment-callbacks/${slug}/mtn/notify`);
    expect(JSON.parse(call.body)).toMatchObject({ amount: '30000', currency: 'XAF', externalId: ids.mtn, payer: { partyIdType: 'MSISDN', partyId: '237670000001' } });
    expect(await balance()).toBe('100000');
  });

  it('ignores a notification claiming success while the operator still says pending', async () => {
    await notify('mtn', { externalId: ids.mtn, status: 'SUCCESSFUL', amount: '30000', currency: 'XAF', financialTransactionId: 'FAKE' }).expect(200, { received: true });
    expect((await dir.get(`/payments/${ids.mtn}`).expect(200)).body.status).toBe('PENDING_VERIFICATION');
  });

  it('never confirms an amount the operator reports differently', async () => {
    mtnStatus.set(ids.mtn!, { status: 'SUCCESSFUL', amount: '3000', currency: 'XAF', financialTransactionId: 'MTN-TX-0' });
    expect((await dir.post(`/payments/${ids.mtn}/verify`).expect(200)).body).toEqual({ status: 'PENDING_VERIFICATION', outcome: 'amount_mismatch' });
  });

  it('confirms once when the operator reports success, however often it is checked', async () => {
    mtnStatus.set(ids.mtn!, { status: 'SUCCESSFUL', amount: '30000', currency: 'XAF', financialTransactionId: 'MTN-TX-1' });
    await notify('mtn', { externalId: ids.mtn }).expect(200);
    expect((await dir.get(`/payments/${ids.mtn}`).expect(200)).body).toMatchObject({ status: 'CONFIRMED', externalReference: 'MTN-TX-1' });
    await notify('mtn', { externalId: ids.mtn }).expect(200);
    expect((await dir.post(`/payments/${ids.mtn}/verify`).expect(200)).body.outcome).toBe('not_pending');
    expect(await owner.receipt.count({ where: { paymentId: ids.mtn } })).toBe(1);
    expect(await balance()).toBe('70000');
  });

  it('marks a refused or failed collection as failed, with the reason', async () => {
    const p = (await pay({ provider: 'mtn', amount: '5000', payerMsisdn: '237670000002' }).expect(201)).body.id;
    mtnStatus.set(p, { status: 'FAILED', amount: '5000', currency: 'XAF', reason: 'APPROVAL_REJECTED' });
    expect((await dir.post(`/payments/${p}/verify`).expect(200)).body).toEqual({ status: 'FAILED', outcome: 'failed' });
    expect((await owner.payment.findUniqueOrThrow({ where: { id: p } })).failureReason).toBe('APPROVAL_REJECTED');

    mtnRequestToPayCode = 400;
    const refused = await pay({ provider: 'mtn', amount: '5000', payerMsisdn: '237670000003' }).expect(201);
    mtnRequestToPayCode = 202;
    expect(refused.body.status).toBe('FAILED');
    expect(await balance()).toBe('70000');
  });

  it('settles pending payments in the periodic reconciliation', async () => {
    const p = (await pay({ provider: 'mtn', amount: '10000', payerMsisdn: '237670000004' }).expect(201)).body.id;
    mtnStatus.set(p, { status: 'SUCCESSFUL', amount: '10000', currency: 'XAF', financialTransactionId: 'MTN-TX-2' });
    await owner.payment.update({ where: { id: p }, data: { createdAt: new Date(Date.now() - 60_000) } }).catch(() => undefined);
    await app.get(MobileMoneyService).reconcile();
    expect((await owner.payment.findUniqueOrThrow({ where: { id: p } })).status).toBe('CONFIRMED');
    expect(await balance()).toBe('60000');
  });
});

describe('Orange Money', () => {
  it('returns the page where the payer confirms', async () => {
    const res = await pay({ provider: 'orange', amount: '20000' }).expect(201);
    ids.orange = res.body.id;
    expect(res.body).toMatchObject({ status: 'PENDING_VERIFICATION', paymentUrl: `https://pay.example/${ids.orange}` });
    const call = captured.find((c) => c.path === '/orange-money-webpay/cm/v1/webpayment')!;
    expect(JSON.parse(call.body)).toMatchObject({ merchant_key: 'merchant-key', order_id: ids.orange, amount: 20000, notif_url: `https://school.example.test/api/v1/payment-callbacks/${slug}/orange/notify` });
  });

  it('ignores notifications with an unknown token, and confirms from the status answer', async () => {
    orangeStatus.set(ids.orange!, { status: 'SUCCESS', txnid: 'OM-TX-1' });
    await notify('orange', { status: 'SUCCESS', notif_token: 'forged', txnid: 'x' }).expect(200, { received: true });
    expect((await dir.get(`/payments/${ids.orange}`).expect(200)).body.status).toBe('PENDING_VERIFICATION');
    await notify('orange', { status: 'SUCCESS', notif_token: `nt-${ids.orange}`, txnid: 'OM-TX-1' }).expect(200);
    expect((await dir.get(`/payments/${ids.orange}`).expect(200)).body).toMatchObject({ status: 'CONFIRMED', externalReference: 'OM-TX-1' });
    expect(await balance()).toBe('40000');
  });

  it('answers notifications for unknown schools without revealing anything', async () => {
    await request(app.getHttpServer()).post('/api/v1/payment-callbacks/no-such-school/orange/notify').send({ notif_token: 'x' }).expect(200, { received: true });
  });
});
