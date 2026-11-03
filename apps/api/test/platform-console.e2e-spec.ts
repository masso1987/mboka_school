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
import { acceptInvitation, addMember, type Client, client, createApp, linkTokenFor, owner, PASSWORD, provisionSchool } from './helpers';

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

describe('licences and modules', () => {
  const put = (path: string, body: object) => platform.put(API + path).set('X-CSRF-Token', csrf).send(body);
  const licence = { plan: 'standard', status: 'ACTIVE', maxStudents: 400, maxCampuses: 2, maxUsers: 30, trialEndsAt: null, currentUntil: '2099-06-30', notes: 'Remise 10 % accordée' };
  const finance = '/finance/reports/summary?from=2026-01-01&to=2026-12-31';

  it('starts with every module', async () => {
    expect((await get(`/platform/schools/${tenantId}/licence`).expect(200)).body.modules).toBeNull();
    await director.get(finance).expect(200);
  });

  it('turns a module off: its routes refuse, its permissions leave the school context, the core stays', async () => {
    const saved = (await put(`/platform/schools/${tenantId}/licence`, { ...licence, modules: ['students', 'attendance'] }).expect(200)).body;
    expect(saved).toMatchObject({ plan: 'standard', maxStudents: 400, modules: ['students', 'attendance'], currentUntil: '2099-06-30', notes: 'Remise 10 % accordée' });
    expect((await director.get(finance).expect(403)).body.error.code).toBe('MODULE_DISABLED');
    await director.get('/students').expect(200);
    const permissions: string[] = (await director.get('/tenant/context').expect(200)).body.permissions;
    expect(permissions).toContain('users.invite');
    expect(permissions).not.toContain('fees.invoice.read');
    expect(permissions).not.toContain('hr.payroll.manage');

    const log = await owner.auditLog.findFirstOrThrow({ where: { tenantId, action: 'platform.licence_changed' }, orderBy: { createdAt: 'desc' } });
    expect(log.metadata).toMatchObject({ before: { modules: null }, after: { modules: ['students', 'attendance'] } });

    await put(`/platform/schools/${tenantId}/licence`, { ...licence, modules: null }).expect(200);
    await director.get(finance).expect(200);
  });

  it('applies the new limits and refuses an incomplete licence', async () => {
    const sub = await owner.subscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub).toMatchObject({ maxStudents: 400, maxUsers: 30, licenceNotes: 'Remise 10 % accordée' });
    expect((await put(`/platform/schools/${tenantId}/licence`, { ...licence, status: 'TRIALING', modules: null }).expect(422)).body.error.code).toBe('TRIAL_END_REQUIRED');
    expect((await put(`/platform/schools/${tenantId}/licence`, { ...licence, plan: 'nope', modules: null }).expect(422)).body.error.code).toBe('UNKNOWN_PLAN');
    await put(`/platform/schools/${tenantId}/licence`, { ...licence, modules: [] }).expect(400);
  });

  it('keeps optional module prices', async () => {
    await put('/platform/modules/payroll/price', { monthlyPrice: '5000', annualPrice: '50000' }).expect(200);
    const prices = (await get('/platform/modules').expect(200)).body;
    expect(prices).toContainEqual({ module: 'payroll', monthlyPrice: '5000', annualPrice: '50000' });
    expect(prices).toHaveLength(10);
    await put('/platform/modules/wizardry/price', { monthlyPrice: '1', annualPrice: '1' }).expect(404);
    await director.put('/platform/modules/payroll/price', { monthlyPrice: '0', annualPrice: '0' }).expect(403);
  });
});

describe('maintenance, sessions, branding, legal documents and messages', () => {
  const put = (path: string, body: object) => platform.put(API + path).set('X-CSRF-Token', csrf).send(body);
  const off = { enabled: false, message: '', startsAt: null, endsAt: null, notify: false };
  const pub = () => request(app.getHttpServer()).get(`${API}/public/status`);
  const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  let staffEmail: string;
  let staff: Client;

  beforeAll(async () => {
    staffEmail = (await addMember(tenantId, `secretary-maint-${run}@e2e.local`, ['registrar'])).email;
    staff = await client(app, staffEmail, tenantId);
  });

  it('maintenance answers 503 to everyone but super administrators, and shows on the public status', async () => {
    try {
      await put('/platform/settings/maintenance', { ...off, enabled: true, message: 'Mise à jour en cours' }).expect(200);
      const refused = await staff.get('/students').expect(503);
      expect(refused.body.error).toMatchObject({ code: 'MAINTENANCE', details: { message: 'Mise à jour en cours' } });
      await staff.get('/tenant/context').expect(503);
      await request(app.getHttpServer()).post(`${API}/auth/login`).send({ email: staffEmail, password: PASSWORD }).expect(200);
      await get('/platform/dashboard').expect(200);
      expect((await pub().expect(200)).body.maintenance).toMatchObject({ active: true, upcoming: false, message: 'Mise à jour en cours' });

      // A scheduled window works the same while it runs…
      await put('/platform/settings/maintenance', { ...off, startsAt: hours(-1), endsAt: hours(1) }).expect(200);
      await staff.get('/students').expect(503);
      // …and is only announced before it starts.
      await put('/platform/settings/maintenance', { ...off, message: 'Coupure samedi', startsAt: hours(2), endsAt: hours(4), notify: true }).expect(200);
      await staff.get('/students').expect(200);
      expect((await pub().expect(200)).body.maintenance).toMatchObject({ active: false, upcoming: true, message: 'Coupure samedi' });
      await put('/platform/settings/maintenance', { ...off, startsAt: hours(4), endsAt: hours(2) }).expect(400);
      await staff.put('/platform/settings/maintenance', off).expect(403);
    } finally {
      await put('/platform/settings/maintenance', off).expect(200);
    }
    await staff.get('/students').expect(200);
  });

  it('applies the session lifetime and signs out idle sessions', async () => {
    const before = (await get('/platform/settings').expect(200)).body.security;
    try {
      await put('/platform/settings/security', { sessionHours: 2, idleMinutes: 15 }).expect(200);
      const fresh = await client(app, staffEmail, tenantId);
      const s = await owner.session.findFirstOrThrow({ where: { user: { email: staffEmail }, revokedAt: null }, orderBy: { createdAt: 'desc' } });
      expect(s.expiresAt.getTime() - s.createdAt.getTime()).toBeLessThanOrEqual(2 * 3_600_000 + 5_000);
      await owner.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date(Date.now() - 20 * 60_000) } });
      await fresh.get('/students').expect(401);
      expect((await owner.session.findUniqueOrThrow({ where: { id: s.id } })).revokedAt).not.toBeNull();
      await put('/platform/settings/security', { sessionHours: 2, idleMinutes: 5 }).expect(400);
    } finally {
      await put('/platform/settings/security', before).expect(200);
    }
  });

  it('publishes branding for the public pages', async () => {
    const before = (await get('/platform/settings').expect(200)).body.branding;
    try {
      const branding = { name: 'Mboka Test', logoUrl: 'https://example.com/logo.png', primaryColor: '#00aa55', footerText: '© Test', supportEmail: 'help@example.com', supportPhone: '+237 600 000 000' };
      await put('/platform/settings/branding', branding).expect(200);
      expect((await pub().expect(200)).body.branding).toEqual(branding);
      await put('/platform/settings/branding', { ...branding, primaryColor: 'green' }).expect(400);
      await put('/platform/settings/branding', { ...branding, logoUrl: 'http://example.com/logo.png' }).expect(400);
      expect(await owner.auditLog.count({ where: { actorId: adminId, action: 'platform.settings_branding_changed' } })).toBeGreaterThanOrEqual(1);
    } finally {
      await put('/platform/settings/branding', before).expect(200);
    }
  });

  it('versions legal documents and serves the latest one publicly', async () => {
    const terms = { kind: 'terms', locale: 'fr', title: `Conditions ${run}`, body: 'Article 1 — Objet. Le présent document définit les conditions.' };
    const first = (await post('/platform/legal', terms).expect(201)).body;
    const second = (await post('/platform/legal', { ...terms, title: `Conditions v2 ${run}` }).expect(201)).body;
    expect(second.version).toBe(first.version + 1);
    const shown = (await request(app.getHttpServer()).get(`${API}/public/legal/terms?locale=fr`).expect(200)).body;
    expect(shown).toMatchObject({ version: second.version, title: `Conditions v2 ${run}` });
    expect((await pub().expect(200)).body.legal).toContainEqual({ kind: 'terms', locale: 'fr', version: second.version });
    await request(app.getHttpServer()).get(`${API}/public/legal/cookies`).expect(404);
    await post('/platform/legal', { ...terms, kind: 'cookies' }).expect(400);
    await staff.post('/platform/legal', terms).expect(403);
  });

  it('sends a message to a school and keeps it in the history', async () => {
    const res = await post('/platform/messages', { audience: 'SCHOOL', tenantId, subject: `Bienvenue ${run}`, body: 'Votre école est prête.' }).expect(201);
    expect(res.body.recipients).toBeGreaterThanOrEqual(2);
    expect(await owner.notification.count({ where: { tenantId, kind: 'platform.message', title: `Bienvenue ${run}` } })).toBe(res.body.recipients);
    const adminsOnly = await post('/platform/messages', { audience: 'SCHOOL_ADMINS', tenantId, subject: `Admins ${run}`, body: 'Réservé aux directeurs.' }).expect(201);
    expect(adminsOnly.body.recipients).toBeLessThan(res.body.recipients);
    await post('/platform/messages', { audience: 'SCHOOL', tenantId: null, subject: 'Sans école', body: 'Refusé.' }).expect(400);
    const history = (await get('/platform/messages').expect(200)).body;
    expect(history[0]).toMatchObject({ subject: `Admins ${run}`, audience: 'SCHOOL_ADMINS', recipients: adminsOnly.body.recipients });
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

describe('users, sessions, sign-ins and audit log', () => {
  const email = `teacher-console-${run}@e2e.local`;
  let userId: string;
  const login = (password = PASSWORD) => request(app.getHttpServer()).post(`${API}/auth/login`).send({ email, password });

  beforeAll(async () => {
    userId = (await addMember(tenantId, email, ['teacher'])).userId;
  });

  it('lists every account with its schools and open sessions, for platform administrators only', async () => {
    const teacher = await client(app, email, tenantId);
    await teacher.get('/platform/users').expect(403);
    const page = (await get(`/platform/users?q=${encodeURIComponent(email)}`).expect(200)).body;
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({ id: userId, isActive: true, schools: [{ id: tenantId, roles: ['teacher'] }] });
    expect(page.items[0].activeSessions).toBeGreaterThanOrEqual(1);
    expect((await get(`/platform/users?tenantId=${tenantId}&status=paused`).expect(200)).body.items.map((u: { id: string }) => u.id)).not.toContain(userId);
  });

  it('ends one session, then every session', async () => {
    const teacher = await client(app, email, tenantId);
    const sessions = (await get(`/platform/users/${userId}/sessions`).expect(200)).body;
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    for (const s of sessions) await platform.delete(`${API}/platform/sessions/${s.id}`).set('X-CSRF-Token', csrf).expect(204);
    await teacher.get('/students').expect(401);

    const again = await client(app, email, tenantId);
    expect((await post(`/platform/users/${userId}/disconnect`).expect(200)).body.sessionsRevoked).toBeGreaterThanOrEqual(1);
    await again.get('/students').expect(401);
    await post(`/platform/users/${adminId}/disconnect`).expect(403);
  });

  it('pauses an account (sign-in refused) and resumes it', async () => {
    await patch(`/platform/users/${userId}/status`, { active: false, reason: 'investigation' }).expect(200);
    await login().expect(401);
    await patch(`/platform/users/${userId}/status`, { active: true }).expect(200);
    await login().expect(200);
    await patch(`/platform/users/${adminId}/status`, { active: false }).expect(403);
  });

  it('shows the sign-in history with failures and reasons, and exports it', async () => {
    await login('wrong password').expect(401);
    const all = (await get(`/platform/logins?q=${encodeURIComponent(email)}`).expect(200)).body;
    const actions = all.items.map((i: { action: string }) => i.action);
    expect(actions).toEqual(expect.arrayContaining(['auth.login.succeeded', 'auth.login.failed']));
    const failures = (await get(`/platform/logins?q=${encodeURIComponent(email)}&failuresOnly=true`).expect(200)).body.items;
    expect(failures.every((i: { success: boolean }) => !i.success)).toBe(true);
    expect(failures.map((i: { reason: string }) => i.reason)).toEqual(expect.arrayContaining(['inactive', 'bad_password']));
    expect((await get(`/platform/logins?tenantId=${tenantId}`).expect(200)).body.items.some((i: { user: { email: string } | null }) => i.user?.email === email)).toBe(true);

    const csv = await get(`/platform/logins?q=${encodeURIComponent(email)}&format=csv`).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\r\n')[0]).toBe('﻿date;action;result;reason;email;name;ip');
    expect(csv.text).toContain(email);
  });

  it('shows the audit log of a school and of the platform, and records exports', async () => {
    const school = (await get(`/platform/audit?tenantId=${tenantId}&action=platform.`).expect(200)).body;
    expect(school.items.map((i: { action: string }) => i.action)).toEqual(expect.arrayContaining(['platform.school_updated', 'platform.school_admin_paused']));
    expect(school.items.every((i: { school: { id: string } }) => i.school.id === tenantId)).toBe(true);
    const platformOnly = (await get(`/platform/audit?action=platform.user_paused`).expect(200)).body.items;
    expect(platformOnly[0]).toMatchObject({ school: null, entityId: userId, metadata: { reason: 'investigation' } });

    const csv = await get(`/platform/audit?tenantId=${tenantId}&format=csv`).expect(200);
    expect(csv.text).toContain('platform.school_updated');
    expect(await owner.auditLog.count({ where: { actorId: adminId, action: 'platform.audit_exported' } })).toBeGreaterThanOrEqual(1);
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
