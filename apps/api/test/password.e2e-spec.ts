/**
 * Phase 6 — "forgot password" and e-mailed invitations: single-use links (only their hash stored), answers that
 * never reveal whether an address has an account, every session signed out once the password is set.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { memoryOutbox } from '../src/common/mailer';
import { acceptInvitation, addMember, type Client, client, createApp, linkTokenFor, owner, PASSWORD, provisionSchool } from './helpers';

const run = randomUUID().slice(0, 8);
const API = '/api/v1';
let app: NestExpressApplication;
let tenantId: string;
let director: Client;

const forgot = (email: string) => request(app.getHttpServer()).post(`${API}/auth/password/forgot`).send({ email });
const reset = (token: string, newPassword: string) => request(app.getHttpServer()).post(`${API}/auth/password/reset`).send({ token, newPassword });
const login = (email: string, password: string) => request(app.getHttpServer()).post(`${API}/auth/login`).send({ email, password });
const mailsTo = (to: string) => memoryOutbox.filter((m) => m.to === to);

beforeAll(async () => {
  app = await createApp();
  const school = await provisionSchool(run, 'pwd');
  tenantId = school.tenantId;
  director = await client(app, school.email, tenantId);
});

afterAll(async () => {
  await app?.close();
  await owner.$disconnect();
});

describe('invitations', () => {
  const email = `secretary-${run}@e2e.local`;

  it('invites a new account by e-mail, without a password anyone has seen', async () => {
    const res = await director.post('/users', { email, fullName: 'Secrétaire', roleKeys: ['registrar'] }).expect(201);
    expect(res.body).toMatchObject({ invitationSent: true });
    expect(res.body.temporaryPassword).toBeUndefined();
    const mail = mailsTo(email).at(-1)!;
    expect(mail.subject).toMatch(/Invitation à rejoindre School pwd/);
    expect(mail.text).toContain('/accept-invitation#token=');
    const user = await owner.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).toBeNull();
    expect(user.passwordResetTokenHash).not.toBe(linkTokenFor(email, '/accept-invitation'));
    expect(user.passwordResetExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
  });

  it('cannot sign in before choosing a password, then can', async () => {
    await login(email, PASSWORD).expect(401);
    const token = linkTokenFor(email, '/accept-invitation');
    await acceptInvitation(app, email);
    await login(email, PASSWORD).expect(200);
    expect((await reset(token, 'another long passphrase').expect(400)).body.error.code).toBe('INVALID_RESET_LINK');
    const user = await owner.user.findUniqueOrThrow({ where: { email } });
    expect(await owner.auditLog.count({ where: { actorId: user.id, action: 'auth.invitation_accepted' } })).toBe(1);
  });

  it('only notifies an existing account that it gained access', async () => {
    const other = await provisionSchool(run, 'pwd2');
    const res = await director.post('/users', { email: other.email, fullName: 'Ignored', roleKeys: ['teacher'] }).expect(201);
    expect(res.body).toMatchObject({ invitationSent: false });
    expect(res.body.temporaryPassword).toBeUndefined();
    const mail = mailsTo(other.email).at(-1)!;
    expect(mail.subject).toMatch(/Nouvel accès/);
    expect(mail.text).not.toContain('token=');
    await login(other.email, PASSWORD).expect(200);
  });
});

describe('forgot password', () => {
  let email: string;

  beforeAll(async () => {
    email = (await addMember(tenantId, `forgetful-${run}@e2e.local`, ['teacher'])).email;
  });

  it('answers the same for an unknown address and sends nothing', async () => {
    const unknown = `nobody-${run}@e2e.local`;
    expect((await forgot(unknown).expect(202)).body).toEqual({ status: 'reset_sent' });
    expect(mailsTo(unknown)).toHaveLength(0);
  });

  it('replaces an earlier link with a new one', async () => {
    expect((await forgot(email).expect(202)).body).toEqual({ status: 'reset_sent' });
    const first = linkTokenFor(email, '/reset-password');
    await forgot(email).expect(202);
    const second = linkTokenFor(email, '/reset-password');
    expect(second).not.toBe(first);
    expect((await reset(first, 'a brand new passphrase').expect(400)).body.error.code).toBe('INVALID_RESET_LINK');
  });

  it('sets the new password once and signs out every session', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post(`${API}/auth/login`).send({ email, password: PASSWORD }).expect(200);
    await agent.get(`${API}/auth/sessions`).expect(200);

    const token = linkTokenFor(email, '/reset-password');
    await reset(token, 'short').expect(400);
    expect((await reset(token, 'a brand new passphrase').expect(200)).body).toEqual({ status: 'password_set' });
    await agent.get(`${API}/auth/sessions`).expect(401);
    await login(email, PASSWORD).expect(401);
    await login(email, 'a brand new passphrase').expect(200);
    await reset(token, 'yet another passphrase').expect(400);
  });

  it('refuses an expired link', async () => {
    const token = randomBytes(32).toString('base64url');
    await owner.user.update({
      where: { email },
      data: { passwordResetTokenHash: createHash('sha256').update(token).digest('hex'), passwordResetExpiresAt: new Date(Date.now() - 1000) },
    });
    expect((await reset(token, 'expired link passphrase').expect(400)).body.error.code).toBe('INVALID_RESET_LINK');
  });

  it('sends nothing to a deactivated account', async () => {
    const inactive = (await addMember(tenantId, `inactive-${run}@e2e.local`, ['teacher'])).email;
    await owner.user.update({ where: { email: inactive }, data: { isActive: false } });
    await forgot(inactive).expect(202);
    expect(mailsTo(inactive)).toHaveLength(0);
  });

  it('confirms the address of an account that had not confirmed it yet', async () => {
    const unverified = (await addMember(tenantId, `unverified-${run}@e2e.local`, ['teacher'])).email;
    await owner.user.update({ where: { email: unverified }, data: { emailVerificationRequired: true } });
    expect((await login(unverified, PASSWORD).expect(403)).body.error.code).toBe('EMAIL_NOT_VERIFIED');
    await forgot(unverified).expect(202);
    await reset(linkTokenFor(unverified, '/reset-password'), 'verified by the link').expect(200);
    await login(unverified, 'verified by the link').expect(200);
  });
});
