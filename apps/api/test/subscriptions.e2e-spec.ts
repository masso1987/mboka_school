/**
 * Phase 6 — self-service sign-up, trial, plan limits, subscription invoices and the read-only rule
 * for lapsed subscriptions. E-mails go to the in-memory outbox.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { base32Decode, currentStep, hotp } from '../src/auth/totp';
import { memoryOutbox } from '../src/common/mailer';
import { hashPassword } from '../src/auth/password';
import { client, type Client, createApp, owner, PASSWORD } from './helpers';

process.env.EMAIL_PROVIDER = 'memory';
process.env.WEB_URL = 'https://school.example.test';

const run = randomUUID().slice(0, 8);
const API = '/api/v1';
let app: NestExpressApplication;
const ownerEmail = `owner-${run}@e2e.local`;
const ownerPassword = 'a strong school passphrase';
const body = {
  schoolName: `Collège Éloi ${run}`,
  city: 'Douala',
  ownerName: 'Awa Bello',
  ownerEmail,
  phone: '+237670000000',
  password: ownerPassword,
  plan: 'essentiel',
  locale: 'fr',
  acceptTerms: true,
};
const ids: Record<string, string> = {};
let school: Client;
let platform: request.Agent;
let platformCsrf: string;

const signup = (b: object) => request(app.getHttpServer()).post(`${API}/signup`).send(b);
const lastMailTo = (to: string) => [...memoryOutbox].reverse().find((m) => m.to === to)!;
const tokenIn = (text: string) => text.match(/token=([A-Za-z0-9_-]+)/)![1]!;

beforeAll(async () => {
  app = await createApp();
  // Platform admin with MFA (mandatory for this role).
  const adminEmail = `root-sub-${run}@e2e.local`;
  await owner.user.create({ data: { email: adminEmail, fullName: 'Root', passwordHash: await hashPassword(PASSWORD), platformRole: 'SUPER_ADMIN' } });
  platform = request.agent(app.getHttpServer());
  platformCsrf = (await platform.post(`${API}/auth/login`).send({ email: adminEmail, password: PASSWORD }).expect(200)).body.csrfToken;
  const setup = await platform.post(`${API}/auth/mfa/setup`).set('X-CSRF-Token', platformCsrf).expect(200);
  await platform
    .post(`${API}/auth/mfa/enable`)
    .set('X-CSRF-Token', platformCsrf)
    .send({ code: hotp(base32Decode(setup.body.secret), currentStep()) })
    .expect(200);
});

afterAll(async () => {
  await app?.close();
  await owner.$disconnect();
});

describe('self-service sign-up', () => {
  it('lists the public plans', async () => {
    const plans = await request(app.getHttpServer()).get(`${API}/public/plans`).expect(200);
    expect(plans.body.map((p: { code: string }) => p.code)).toEqual(expect.arrayContaining(['essentiel', 'standard', 'premium']));
  });

  it('creates the school on trial and sends a verification link', async () => {
    expect((await signup(body).expect(202)).body).toEqual({ status: 'verification_sent' });
    const tenant = await owner.tenant.findFirstOrThrow({ where: { legalName: body.schoolName }, include: { subscription: true } });
    ids.tenant = tenant.id;
    expect(tenant.slug).toBe(`college-eloi-${run}`);
    expect(tenant.subscription).toMatchObject({ plan: 'essentiel', status: 'TRIALING', maxStudents: 300 });
    const mail = lastMailTo(ownerEmail);
    expect(mail.subject).toMatch(/Confirmez/);
    expect(mail.text).toContain('https://school.example.test/verify-email#token=');
    ids.token = tokenIn(mail.text);
    const user = await owner.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    expect(user.emailVerifyTokenHash).not.toBe(ids.token); // only the hash is stored
  });

  it('refuses bots and missing terms', async () => {
    await signup({ ...body, ownerEmail: `bot-${run}@e2e.local`, website: 'http://spam.example' }).expect(400);
    await signup({ ...body, ownerEmail: `noterms-${run}@e2e.local`, acceptTerms: false }).expect(400);
  });

  it('answers the same for an address that already has an account, without creating anything', async () => {
    const before = await owner.tenant.count();
    expect((await signup({ ...body, schoolName: `Autre école ${run}` }).expect(202)).body).toEqual({ status: 'verification_sent' });
    expect(await owner.tenant.count()).toBe(before);
    expect(lastMailTo(ownerEmail).subject).toMatch(/déjà un compte/);
  });

  it('blocks sign-in until the address is confirmed, once', async () => {
    const res = await request(app.getHttpServer()).post(`${API}/auth/login`).send({ email: ownerEmail, password: ownerPassword }).expect(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    // A wrong password still gets the generic error: the verification state is not revealed.
    await request(app.getHttpServer()).post(`${API}/auth/login`).send({ email: ownerEmail, password: 'wrong password 123' }).expect(401);
    await request(app.getHttpServer()).post(`${API}/signup/verify`).send({ token: ids.token }).expect(200, { verified: true });
    expect((await request(app.getHttpServer()).post(`${API}/signup/verify`).send({ token: ids.token }).expect(400)).body.error.code).toBe('INVALID_VERIFICATION_LINK');
    school = await client(app, ownerEmail, ids.tenant!, ownerPassword);
  });
});

describe('the school\'s subscription', () => {
  it('shows the trial, usage and limits', async () => {
    const ctx = await school.get('/tenant/context').expect(200);
    expect(ctx.body.tenant.subscription).toMatchObject({ plan: 'essentiel', state: 'TRIAL', writable: true, daysLeft: 30 });
    const o = await school.get('/subscription').expect(200);
    expect(o.body.subscription).toMatchObject({ limits: { students: 300, campuses: 1, users: 30 }, usage: { students: 0, campuses: 1, users: 1 } });
  });

  it('enforces the plan\'s limits', async () => {
    expect((await school.post('/campuses', { code: 'C2', name: 'Annexe' }).expect(402)).body.error.code).toBe('PLAN_LIMIT_REACHED');
    await owner.subscription.update({ where: { tenantId: ids.tenant }, data: { maxStudents: 1 } });
    await school.post('/students', { firstName: 'Un', lastName: 'Élève', dateOfBirth: '2015-01-01' }).expect(201);
    expect((await school.post('/students', { firstName: 'Deux', lastName: 'Élève', dateOfBirth: '2015-01-02' }).expect(402)).body.error.code).toBe('PLAN_LIMIT_REACHED');
    await owner.subscription.update({ where: { tenantId: ids.tenant }, data: { maxStudents: 300 } });
  });

  it('issues one open invoice per choice, starting when the trial ends', async () => {
    const first = await school.post('/subscription/checkout', { plan: 'standard', cycle: 'MONTHLY' }).expect(201);
    expect(first.body).toMatchObject({ plan: 'standard', amount: '60000', status: 'OPEN' });
    expect(first.body.number).toMatch(/^SUB-\d{4}-\d{6}$/);
    const second = await school.post('/subscription/checkout', { plan: 'essentiel', cycle: 'ANNUAL' }).expect(201);
    expect(second.body).toMatchObject({ amount: '250000', billingCycle: 'ANNUAL' });
    const sub = await owner.subscription.findUniqueOrThrow({ where: { tenantId: ids.tenant } });
    expect(second.body.periodStart).toBe(sub.trialEndsAt!.toISOString().slice(0, 10));
    const invoices = (await school.get('/subscription').expect(200)).body.invoices;
    expect(invoices.filter((i: { status: string }) => i.status === 'OPEN')).toHaveLength(1);
    expect(invoices.find((i: { id: string }) => i.id === first.body.id).status).toBe('VOID');
    ids.invoice = second.body.id;
  });

  it('becomes read-only when the trial is over, but can still pay', async () => {
    await owner.subscription.update({ where: { tenantId: ids.tenant }, data: { trialEndsAt: new Date(Date.now() - 86_400_000) } });
    await school.get('/students').expect(200);
    expect((await school.post('/students', { firstName: 'Trois', lastName: 'Élève', dateOfBirth: '2015-01-03' }).expect(402)).body.error.code).toBe('SUBSCRIPTION_EXPIRED');
    expect((await school.get('/tenant/context').expect(200)).body.tenant.subscription).toMatchObject({ state: 'EXPIRED', writable: false });
    await school.post('/subscription/checkout', { plan: 'essentiel', cycle: 'ANNUAL' }).expect(201);
    ids.invoice = (await school.get('/subscription').expect(200)).body.invoices.find((i: { status: string }) => i.status === 'OPEN').id;
  });
});

describe('platform administration', () => {
  const p = (path: string) => platform.post(API + path).set('X-CSRF-Token', platformCsrf);

  it('lists schools with their subscription and open invoice', async () => {
    const res = await platform.get(`${API}/platform/subscriptions`).expect(200);
    const row = res.body.find((r: { tenant: { id: string } }) => r.tenant.id === ids.tenant);
    expect(row.subscription.state).toBe('EXPIRED');
    expect(row.openInvoice.id).toBe(ids.invoice);
  });

  it('confirms a payment, which reopens the school for a year on the paid plan', async () => {
    const res = await p(`/platform/tenants/${ids.tenant}/subscription-invoices/${ids.invoice}/pay`).send({ reference: 'MOMO-123456' }).expect(200);
    expect(res.body).toMatchObject({ plan: 'essentiel', status: 'ACTIVE', billingCycle: 'ANNUAL', state: 'OK', writable: true });
    await p(`/platform/tenants/${ids.tenant}/subscription-invoices/${ids.invoice}/pay`).send({ reference: 'again' }).expect(409);
    await school.post('/students', { firstName: 'Trois', lastName: 'Élève', dateOfBirth: '2015-01-03' }).expect(201);
    await expect(owner.$executeRawUnsafe(`UPDATE subscription_invoices SET amount = 1 WHERE id = '${ids.invoice}'`)).rejects.toThrow(/immutable/);
  });

  it('edits plans; schools never reach these routes', async () => {
    const plans = (await platform.get(`${API}/platform/plans`).expect(200)).body;
    const std = plans.find((x: { code: string }) => x.code === 'standard');
    await platform
      .put(`${API}/platform/plans/standard`)
      .set('X-CSRF-Token', platformCsrf)
      .send({ ...std, monthlyPrice: std.monthlyPrice, isPublic: true })
      .expect(200);
    await school.get('/platform/subscriptions').expect(403);
  });
});
