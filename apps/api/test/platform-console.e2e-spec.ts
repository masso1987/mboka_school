/**
 * Phase 7 — platform console, slice 1: dashboard, schools and their admins, platform administrators,
 * and the read-only platform scope of row-level security.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { base32Decode, currentStep, hotp } from '../src/auth/totp';
import { hashPassword } from '../src/auth/password';
import { acceptInvitation, type Client, client, createApp, linkTokenFor, owner, PASSWORD, provisionSchool } from './helpers';

const run = randomUUID().slice(0, 8);
const API = '/api/v1';
let app: NestExpressApplication;
let platform: request.Agent;
let csrf: string;
let adminId: string;
let tenantId: string;
let director: Client;

const get = (path: string) => platform.get(API + path);
const post = (path: string, body?: object) => platform.post(API + path).set('X-CSRF-Token', csrf).send(body);
const patch = (path: string, body: object) => platform.patch(API + path).set('X-CSRF-Token', csrf).send(body);

beforeAll(async () => {
  app = await createApp();
  const email = `root-console-${run}@e2e.local`;
  adminId = (await owner.user.create({ data: { email, fullName: 'Root', passwordHash: await hashPassword(PASSWORD), platformRole: 'SUPER_ADMIN' } })).id;
  platform = request.agent(app.getHttpServer());
  csrf = (await platform.post(`${API}/auth/login`).send({ email, password: PASSWORD }).expect(200)).body.csrfToken;
  const setup = await platform.post(`${API}/auth/mfa/setup`).set('X-CSRF-Token', csrf).expect(200);
  await platform.post(`${API}/auth/mfa/enable`).set('X-CSRF-Token', csrf).send({ code: hotp(base32Decode(setup.body.secret), currentStep()) }).expect(200);
  const school = await provisionSchool(run, 'console');
  tenantId = school.tenantId;
  director = await client(app, school.email, tenantId);
});

afterAll(async () => {
  await app?.close();
  await owner.$disconnect();
});

describe('dashboard', () => {
  it('summarises every school for platform administrators only', async () => {
    const d = (await get('/platform/dashboard').expect(200)).body;
    expect(d.schools.total).toBeGreaterThanOrEqual(1);
    expect(d.people.users).toBeGreaterThanOrEqual(1);
    expect(d.recentSchools.map((s: { id: string }) => s.id)).toContain(tenantId);
    await director.get('/platform/dashboard').expect(403);
  });
});

describe('schools', () => {
  it('lists and searches schools with their size and admins', async () => {
    const rows = (await get(`/platform/schools?q=console-${run}`).expect(200)).body;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant: { id: tenantId }, admins: 1, users: 1 });
    expect((await get('/platform/schools?status=SUSPENDED').expect(200)).body.map((r: { tenant: { id: string } }) => r.tenant.id)).not.toContain(tenantId);
  });

  it('edits a school and records it in the school log', async () => {
    await patch(`/platform/schools/${tenantId}`, { legalName: 'Console School Renamed', defaultLocale: 'en' }).expect(200);
    const detail = (await get(`/platform/schools/${tenantId}`).expect(200)).body;
    expect(detail.tenant).toMatchObject({ legalName: 'Console School Renamed', defaultLocale: 'en' });
    const log = await owner.auditLog.findFirstOrThrow({ where: { tenantId, action: 'platform.school_updated' } });
    expect(log.metadata).toMatchObject({ before: { legalName: 'School console' }, after: { legalName: 'Console School Renamed' } });
    await patch(`/platform/schools/${tenantId}`, {}).expect(400);
    await patch(`/platform/schools/${randomUUID()}`, { legalName: 'Nowhere' }).expect(404);
  });

  it('adds a director by invitation, resets and pauses them', async () => {
    const email = `second-director-${run}@e2e.local`;
    const res = await post(`/platform/schools/${tenantId}/admins`, { fullName: 'Second Director', email }).expect(201);
    expect(res.body).toMatchObject({ invitationSent: true });
    let admins = (await get(`/platform/schools/${tenantId}`).expect(200)).body.admins;
    const added = admins.find((a: { email: string }) => a.email === email);
    expect(added).toMatchObject({ invitationPending: true, status: 'ACTIVE' });

    await acceptInvitation(app, email);
    const second = await client(app, email, tenantId);
    await second.get('/users').expect(200);

    const reset = await post(`/platform/schools/${tenantId}/admins/${added.userId}/reset`).expect(200);
    expect(reset.body).toEqual({ emailSent: true });
    expect(linkTokenFor(email, '/reset-password')).toBeTruthy();
    await second.get('/users').expect(401); // every session was signed out

    await patch(`/platform/schools/${tenantId}/admins/${added.userId}/status`, { active: false, reason: 'test' }).expect(200);
    admins = (await get(`/platform/schools/${tenantId}`).expect(200)).body.admins;
    expect(admins.find((a: { email: string }) => a.email === email).status).toBe('REVOKED');
    expect(await owner.auditLog.count({ where: { tenantId, action: 'platform.school_admin_paused' } })).toBe(1);

    // Only directors of this school can be acted on here.
    await post(`/platform/schools/${tenantId}/admins/${adminId}/reset`).expect(404);
  });
});

describe('platform administrators', () => {
  it('invites a new platform administrator and never lets one act on themself', async () => {
    const email = `second-root-${run}@e2e.local`;
    const res = await post('/platform/admins', { fullName: 'Second Root', email }).expect(201);
    expect(res.body).toMatchObject({ invitationSent: true });
    const list = (await get('/platform/admins').expect(200)).body;
    const added = list.find((a: { email: string }) => a.email === email);
    expect(added).toMatchObject({ platformRole: 'SUPER_ADMIN', invitationPending: true, mfaEnabled: false });
    expect((await post('/platform/admins', { fullName: 'Again', email }).expect(409)).body.error.code).toBe('ALREADY_PLATFORM_ADMIN');

    await patch(`/platform/admins/${adminId}/status`, { active: false }).expect(403);
    await post(`/platform/admins/${adminId}/reset`).expect(403);

    await patch(`/platform/admins/${added.id}/status`, { active: false }).expect(200);
    expect((await owner.user.findUniqueOrThrow({ where: { email } })).isActive).toBe(false);
    await patch(`/platform/admins/${added.id}/status`, { active: true }).expect(200);
  });

  it('promotes an existing account and closes its older sessions', async () => {
    const res = await post('/platform/admins', { fullName: 'Ignored', email: `dir-console-${run}@e2e.local` }).expect(201);
    expect(res.body).toMatchObject({ invitationSent: false });
    await director.get('/users').expect(401);
    await patch(`/platform/admins/${res.body.userId}/status`, { active: false }).expect(200);
  });
});

describe('platform scope of row-level security', () => {
  const appDb = new PrismaClient();
  afterAll(() => appDb.$disconnect());

  it('reads across schools but never writes', async () => {
    const seen = await appDb.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.platform', 'on', true)`;
      return tx.campus.count({ where: { tenantId } });
    });
    expect(seen).toBe(1);
    await expect(
      appDb.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.platform', 'on', true)`;
        await tx.campus.create({ data: { tenantId, code: 'HACK', name: 'Hack' } });
      }),
    ).rejects.toThrow();
    expect(await appDb.campus.count({ where: { tenantId } })).toBe(0);
  });
});
