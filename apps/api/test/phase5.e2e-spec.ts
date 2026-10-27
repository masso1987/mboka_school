/**
 * Phase 5 — accounts (MFA, password, sessions), year rollover (§13.2 scenario 7),
 * school data export and observability. Runs against the migrated local database.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { hashPassword } from '../src/auth/password';
import { base32Decode, currentStep, hotp } from '../src/auth/totp';
import { addMember, client, type Client, createApp, owner, PASSWORD, provisionSchool } from './helpers';

const run = randomUUID().slice(0, 8);
const API = '/api/v1';
let app: NestExpressApplication;

/** A code for `offset` steps from now; the API accepts ±1 step and never the same step twice. */
const code = (secret: string, offset = 0) => hotp(base32Decode(secret), currentStep() + offset);

/** Raw agent login, for the MFA flows the tenant-bound helper does not cover. */
async function login(email: string, password = PASSWORD) {
  const agent = request.agent(app.getHttpServer());
  const res = await agent.post(`${API}/auth/login`).send({ email, password }).expect(200);
  const csrf = res.body.csrfToken as string;
  return {
    agent,
    body: res.body as { mfaRequired: boolean; mfaSetupRequired: boolean },
    get: (path: string, tenantId?: string) => {
      const r = agent.get(API + path);
      return tenantId ? r.set('X-Tenant-Id', tenantId) : r;
    },
    post: (path: string, body?: object, tenantId?: string) => {
      const r = agent.post(API + path).set('X-CSRF-Token', csrf);
      return (tenantId ? r.set('X-Tenant-Id', tenantId) : r).send(body);
    },
    put: (path: string, body: object, tenantId: string) => agent.put(API + path).set('X-CSRF-Token', csrf).set('X-Tenant-Id', tenantId).send(body),
    del: (path: string) => agent.delete(API + path).set('X-CSRF-Token', csrf),
  };
}

/** Enrolls MFA on an open session; returns the secret and the recovery codes. */
async function enroll(s: Awaited<ReturnType<typeof login>>) {
  const setup = await s.post('/auth/mfa/setup').expect(200);
  const secret = setup.body.secret as string;
  expect(setup.body.otpauthUrl).toContain('otpauth://totp/');
  const enabled = await s.post('/auth/mfa/enable', { code: code(secret) }).expect(200);
  return { secret, recoveryCodes: enabled.body.recoveryCodes as string[] };
}

beforeAll(async () => {
  app = await createApp();
});

afterAll(async () => {
  await app.close();
  await owner.$disconnect();
});

describe('two-factor authentication', () => {
  const email = `mfa-${run}@e2e.local`;
  let tenantId: string;
  let secret: string;
  let recovery: string[];

  beforeAll(async () => {
    ({ tenantId } = await provisionSchool(run, 'mfa'));
    await addMember(tenantId, email, ['teacher']);
  });

  it('enrols with a first code and returns ten single-use recovery codes', async () => {
    const s = await login(email);
    expect(s.body.mfaRequired).toBe(false);
    await s.post('/auth/mfa/enable', { code: '123456' }).expect(409); // setup not started
    ({ secret, recoveryCodes: recovery } = await enroll(s));
    expect(recovery).toHaveLength(10);
    expect((await s.get('/auth/account').expect(200)).body).toMatchObject({ mfaEnabled: true, recoveryCodesLeft: 10 });
    const row = await owner.user.findUniqueOrThrow({ where: { email } });
    expect(row.mfaSecret).not.toContain(secret); // encrypted at rest
    expect(row.mfaRecoveryCodes).not.toContain(recovery[0]); // only hashes stored
  });

  it('asks for the second factor before anything else, then lets the user in', async () => {
    const s = await login(email);
    expect(s.body.mfaRequired).toBe(true);
    const me = await s.get('/auth/me').expect(200);
    expect(me.body.security.mfaPending).toBe(true);
    expect(me.body.tenants).toEqual([]);
    expect((await s.get('/classes', tenantId).expect(401)).body.error.code).toBe('MFA_REQUIRED');
    // The enrolment consumed the current step, so the next valid code is the following one.
    const next = code(secret, 1);
    await s.post('/auth/mfa/verify', { code: next }).expect(200);
    await s.get('/classes', tenantId).expect(200);

    // Same code on another device: rejected (replay), and audited.
    const other = await login(email);
    expect((await other.post('/auth/mfa/verify', { code: next }).expect(401)).body.error.code).toBe('INVALID_MFA_CODE');
    const user = await owner.user.findUniqueOrThrow({ where: { email } });
    expect(await owner.auditLog.count({ where: { actorId: user.id, action: 'auth.mfa_replay_rejected' } })).toBe(1);
  });

  it('accepts each recovery code once', async () => {
    const a = await login(email);
    await a.post('/auth/mfa/verify', { code: recovery[0] }).expect(200);
    const b = await login(email);
    await b.post('/auth/mfa/verify', { code: recovery[0] }).expect(401);
    await b.post('/auth/mfa/verify', { code: '000000-x' }).expect(401);
    expect((await a.get('/auth/account').expect(200)).body.recoveryCodesLeft).toBe(9);
  });

  it('turns MFA off only with the password and a valid code', async () => {
    const s = await login(email);
    await s.post('/auth/mfa/verify', { code: recovery[1] }).expect(200);
    await s.post('/auth/mfa/disable', { password: 'wrong-password', code: code(secret) }).expect(401);
    await s.post('/auth/mfa/disable', { password: PASSWORD, code: '000000' }).expect(401);
    await s.post('/auth/mfa/disable', { password: PASSWORD, code: code(secret) }).expect(200);
    expect((await login(email)).body.mfaRequired).toBe(false);
  });
});

describe('platform administrators must use MFA', () => {
  const email = `root-${run}@e2e.local`;

  beforeAll(async () => {
    await owner.user.create({ data: { email, fullName: 'Root', passwordHash: await hashPassword(PASSWORD), platformRole: 'SUPER_ADMIN' } });
  });

  it('blocks every other route until MFA is set up, and never lets it be turned off', async () => {
    const s = await login(email);
    expect(s.body.mfaSetupRequired).toBe(true);
    expect((await s.get('/platform/tenants').expect(403)).body.error.code).toBe('MFA_SETUP_REQUIRED');
    expect((await s.get('/auth/me').expect(200)).body.security.mfaSetupRequired).toBe(true);
    const { secret } = await enroll(s);
    await s.get('/platform/tenants').expect(200);
    await s.post('/auth/mfa/disable', { password: PASSWORD, code: code(secret, 1) }).expect(403);
  });
});

describe('school policy: MFA for privileged roles', () => {
  let tenantId: string;
  let directorEmail: string;
  const teacherEmail = `pol-teacher-${run}@e2e.local`;
  const bursarEmail = `pol-bursar-${run}@e2e.local`;

  beforeAll(async () => {
    ({ tenantId, email: directorEmail } = await provisionSchool(run, 'policy'));
    await addMember(tenantId, teacherEmail, ['teacher']);
    await addMember(tenantId, bursarEmail, ['director']);
  });

  it('only lets someone who already uses MFA turn the rule on', async () => {
    const s = await login(directorEmail);
    expect((await s.put('/tenant/security', { requireMfaForPrivileged: true }, tenantId).expect(403)).body.error.code).toBe('MFA_SETUP_REQUIRED');
    await enroll(s);
    await s.put('/tenant/security', { requireMfaForPrivileged: true }, tenantId).expect(200);
    expect((await s.get('/tenant/context', tenantId).expect(200)).body.tenant.security.requireMfaForPrivileged).toBe(true);
    expect(await owner.auditLog.count({ where: { tenantId, action: 'tenant.security_changed' } })).toBe(1);
  });

  it('stops privileged staff without MFA but not the others', async () => {
    const bursar = await login(bursarEmail);
    expect((await bursar.get('/classes', tenantId).expect(403)).body.error.code).toBe('MFA_SETUP_REQUIRED');
    const teacher = await login(teacherEmail);
    await teacher.get('/classes', tenantId).expect(200);
    await enroll(bursar);
    await bursar.get('/classes', tenantId).expect(200);
  });
});

describe('password and sessions', () => {
  const email = `pw-${run}@e2e.local`;
  const newPassword = 'a much longer passphrase 2026';
  let tenantId: string;

  beforeAll(async () => {
    ({ tenantId } = await provisionSchool(run, 'pw'));
    await addMember(tenantId, email, ['teacher']);
  });

  it('lists sessions and signs out a chosen one', async () => {
    const a = await login(email);
    const b = await login(email);
    const list = (await a.get('/auth/sessions').expect(200)).body as { id: string; current: boolean }[];
    expect(list.filter((x) => x.current)).toHaveLength(1);
    const other = list.find((x) => !x.current)!;
    await a.del(`/auth/sessions/${other.id}`).expect(204);
    await b.get('/auth/me').expect(401);
    await a.get('/auth/me').expect(200);
  });

  it('changes the password and signs out every other session', async () => {
    const a = await login(email);
    const b = await login(email);
    await a.post('/auth/password', { currentPassword: 'not-the-password', newPassword }).expect(401);
    await a.post('/auth/password', { currentPassword: PASSWORD, newPassword: 'short' }).expect(400);
    await a.post('/auth/password', { currentPassword: PASSWORD, newPassword: PASSWORD }).expect(400);
    const res = await a.post('/auth/password', { currentPassword: PASSWORD, newPassword }).expect(200);
    expect(res.body.otherSessionsRevoked).toBeGreaterThanOrEqual(1);
    await b.get('/auth/me').expect(401);
    await a.get('/auth/me').expect(200);
    await request(app.getHttpServer()).post(`${API}/auth/login`).send({ email, password: PASSWORD }).expect(401);
    await login(email, newPassword);
  });
});

describe('academic year rollover (Workflow F, scenario 7)', () => {
  let tenantId: string;
  let dir: Client;
  let source: string;
  let target: string;
  let from6e: string;
  let to5e: string;
  let repeat6e: string;
  const enr: Record<'promoted' | 'repeater' | 'leaver' | 'graduate' | 'undecided', string> = {} as never;

  beforeAll(async () => {
    const school = await provisionSchool(run, 'roll');
    tenantId = school.tenantId;
    dir = await client(app, school.email, tenantId);
    const director = await owner.user.findUniqueOrThrow({ where: { email: school.email } });
    const campus = await owner.campus.findFirstOrThrow({ where: { tenantId } });
    const level = await owner.educationLevel.create({ data: { tenantId, code: '6E', nameFr: 'Sixième', nameEn: 'Form 1', cycle: 'SECONDARY_FIRST' } });
    const y1 = await owner.academicYear.create({ data: { tenantId, name: '2040-2041', startDate: new Date('2040-09-01'), endDate: new Date('2041-06-30'), status: 'ACTIVE' } });
    const y2 = await owner.academicYear.create({ data: { tenantId, name: '2041-2042', startDate: new Date('2041-09-01'), endDate: new Date('2042-06-30') } });
    source = y1.id;
    target = y2.id;
    const mk = (academicYearId: string, code: string) =>
      owner.schoolClass.create({ data: { tenantId, academicYearId, campusId: campus.id, levelId: level.id, code, name: code } });
    from6e = (await mk(source, '6A')).id;
    to5e = (await mk(target, '5A')).id;
    repeat6e = (await mk(target, '6A')).id;
    const decisions = { promoted: 'PROMOTED', repeater: 'REPEAT', leaver: 'EXCLUDED', graduate: 'GRADUATED', undecided: null } as const;
    for (const [key, decision] of Object.entries(decisions) as [keyof typeof enr, (typeof decisions)[keyof typeof decisions]][]) {
      const st = await owner.student.create({
        data: { tenantId, matricule: `R-${key}-${run}`, firstName: key, lastName: 'Rollover', dateOfBirth: new Date('2028-01-01') },
      });
      const e = await owner.enrollment.create({
        data: { tenantId, studentId: st.id, academicYearId: source, classId: from6e, enrolledOn: new Date('2040-09-01') },
      });
      enr[key] = e.id;
      if (decision) {
        await owner.promotionDecision.create({ data: { tenantId, enrollmentId: e.id, academicYearId: source, decision, proposed: decision, decidedBy: director.id } });
      }
    }
  });

  const body = (repeat = true) => ({
    targetYearId: target,
    classMap: [{ fromClassId: from6e, promotedTo: to5e, ...(repeat && { repeatIn: repeat6e }) }],
    closeSourceYear: true,
  });

  it('previews the plan and lists the students who still need a decision or a class', async () => {
    const p = await dir.post(`/academic-years/${source}/rollover/preview`, body(false)).expect(200);
    expect(p.body.summary).toMatchObject({ students: 5, promote: 1, graduate: 1, leave: 1, exceptions: 2 });
    expect(p.body.canCommit).toBe(false);
    expect(p.body.exceptions.map((x: { exception: string }) => x.exception).sort()).toEqual(['NO_DECISION', 'NO_TARGET_CLASS']);
  });

  it('refuses to commit while exceptions remain', async () => {
    const res = await dir.post(`/academic-years/${source}/rollover`, body()).expect(409);
    expect(res.body.error.code).toBe('ROLLOVER_HAS_EXCEPTIONS');
    expect(await owner.enrollment.count({ where: { tenantId, academicYearId: target } })).toBe(0);
  });

  it('commits once the exceptions are resolved', async () => {
    const director = await owner.user.findFirstOrThrow({ where: { email: `dir-roll-${run}@e2e.local` } });
    await owner.promotionDecision.create({
      data: { tenantId, enrollmentId: enr.undecided, academicYearId: source, decision: 'PROMOTED', proposed: 'REPEAT', decidedBy: director.id },
    });
    const res = await dir.post(`/academic-years/${source}/rollover`, body()).expect(200);
    expect(res.body).toMatchObject({ promoted: 2, repeating: 1, graduated: 1, left: 1, alreadyEnrolled: 0 });
    const next = await owner.enrollment.findMany({ where: { tenantId, academicYearId: target } });
    expect(next).toHaveLength(3);
    expect(next.filter((e) => e.classId === to5e)).toHaveLength(2);
    expect(next.find((e) => e.classId === repeat6e)?.status).toBe('REPEATING');
    expect(await owner.enrollment.count({ where: { tenantId, academicYearId: source, status: { in: ['ENROLLED', 'REPEATING'] } } })).toBe(0);
    const graduate = await owner.enrollment.findUniqueOrThrow({ where: { id: enr.graduate }, include: { student: true } });
    expect(graduate.student.status).toBe('GRADUATED');
    const years = await owner.academicYear.findMany({ where: { tenantId }, orderBy: { startDate: 'asc' } });
    expect(years.map((y) => y.status)).toEqual(['CLOSED', 'ACTIVE']);
  });

  it('changes nothing when run a second time (scenario 7)', async () => {
    const res = await dir.post(`/academic-years/${source}/rollover`, body()).expect(200);
    expect(res.body).toMatchObject({ promoted: 0, repeating: 0, graduated: 0, left: 0 });
    expect(await owner.enrollment.count({ where: { tenantId, academicYearId: target } })).toBe(3);
    expect(await owner.auditLog.count({ where: { tenantId, action: 'academic_year.rolled_over' } })).toBe(2);
  });
});

describe('school data export', () => {
  let tenantId: string;
  let dir: Client;
  const teacherEmail = `exp-teacher-${run}@e2e.local`;

  beforeAll(async () => {
    const school = await provisionSchool(run, 'export');
    tenantId = school.tenantId;
    dir = await client(app, school.email, tenantId);
    await addMember(tenantId, teacherEmail, ['teacher']);
    await dir.post('/students', { firstName: 'Export', lastName: 'Test', dateOfBirth: '2015-03-02', guardians: [] });
  });

  it('exports every tenant table without credentials, and audits it', async () => {
    const res = await dir.get('/tenant/export').expect(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="mboka-export-\d{4}-\d{2}-\d{2}\.json"/);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('password_hash');
    expect(text).not.toContain('secret_encrypted');
    expect(text).not.toContain('mfa_');
    expect(res.body.meta.format).toBe('mboka-tenant-export');
    expect(res.body.tenant.id).toBe(tenantId);
    expect(res.body.tables.roles.length).toBeGreaterThan(0);
    expect(res.body.tables.roles.every((r: { tenant_id: string }) => r.tenant_id === tenantId)).toBe(true);
    expect(res.body.users.map((u: { email: string }) => u.email)).toContain(teacherEmail);
    expect(await owner.auditLog.count({ where: { tenantId, action: 'tenant.data_exported' } })).toBe(1);
  });

  it('is reserved to the export permission', async () => {
    const teacher = await client(app, teacherEmail, tenantId);
    await teacher.get('/tenant/export').expect(403);
  });
});

describe('observability', () => {
  it('returns a request id, and echoes a well-formed one', async () => {
    const server = app.getHttpServer();
    const res = await request(server).get(`${API}/health/live`).expect(200);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const mine = `support-${run}`;
    expect((await request(server).get(`${API}/health/live`).set('X-Request-Id', mine)).headers['x-request-id']).toBe(mine);
    expect((await request(server).get(`${API}/health/live`).set('X-Request-Id', 'bad id!')).headers['x-request-id']).not.toContain('bad');
  });

  it('separates liveness from readiness', async () => {
    await request(app.getHttpServer()).get(`${API}/health/live`).expect(200, { status: 'ok' });
    expect((await request(app.getHttpServer()).get(`${API}/health/ready`).expect(200)).body.status).toBe('ok');
  });

  it('serves metrics only with the configured token', async () => {
    const server = app.getHttpServer();
    const saved = process.env.METRICS_TOKEN;
    try {
      delete process.env.METRICS_TOKEN;
      await request(server).get(`${API}/health/metrics`).expect(404);
      process.env.METRICS_TOKEN = `metrics-${run}-token`;
      await request(server).get(`${API}/health/metrics`).set('Authorization', 'Bearer wrong').expect(404);
      const res = await request(server).get(`${API}/health/metrics`).set('Authorization', `Bearer metrics-${run}-token`).expect(200);
      expect(res.text).toContain('mboka_http_requests_total{method="GET",route="/api/v1/health/live",status="200"}');
      expect(res.text).not.toMatch(/route="[^"]*[0-9a-f]{8}-[0-9a-f]{4}/); // route templates, never concrete ids
    } finally {
      if (saved === undefined) delete process.env.METRICS_TOKEN;
      else process.env.METRICS_TOKEN = saved;
    }
  });
});
