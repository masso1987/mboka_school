/**
 * Spec §13.2 mandatory scenarios covered here:
 *  #1  a user from one tenant attempts to access another tenant's data
 *  #10 a tenant is suspended (access is blocked, data kept)
 * plus RLS behaviour for the runtime role, CSRF, and permission checks.
 *
 * Requires: docker compose up -d postgres, migrations applied, permissions seeded.
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/auth/password';
import { configureApp } from '../src/bootstrap';
import { provisionTenant } from '../src/tenants/provision';

if (existsSync('.env')) process.loadEnvFile('.env');
process.env.LOGIN_RATE_LIMIT = '1000';

const owner = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const run = randomUUID().slice(0, 8);
const PASSWORD = 'E2e-Passw0rd!';

let app: NestExpressApplication;
const tenantA = randomUUID();
const tenantB = randomUUID();
const emailA = `dir-a-${run}@e2e.local`;
const emailB = `dir-b-${run}@e2e.local`;
const teacherEmail = `teacher-a-${run}@e2e.local`;

async function login(email: string) {
  const agent = request.agent(app.getHttpServer());
  const res = await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
  return { agent, csrf: res.body.csrfToken as string };
}

beforeAll(async () => {
  const base = { defaultLocale: 'fr' as const, timezone: 'Africa/Douala', defaultCurrency: 'XAF' };
  await owner.$transaction((tx) =>
    provisionTenant(tx, tenantA, { ...base, slug: `a-${run}`, legalName: 'School A', ownerEmail: emailA, ownerName: 'Dir A' }, PASSWORD),
  );
  await owner.$transaction((tx) =>
    provisionTenant(tx, tenantB, { ...base, slug: `b-${run}`, legalName: 'School B', ownerEmail: emailB, ownerName: 'Dir B' }, PASSWORD),
  );
  // A teacher in tenant A (no academics.years.manage permission).
  const teacher = await owner.user.create({
    data: { email: teacherEmail, fullName: 'Teacher A', passwordHash: await hashPassword(PASSWORD) },
  });
  const m = await owner.membership.create({ data: { tenantId: tenantA, userId: teacher.id } });
  const role = await owner.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenantA, key: 'teacher' } } });
  await owner.userRoleAssignment.create({ data: { tenantId: tenantA, membershipId: m.id, roleId: role.id } });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await owner.$disconnect();
});

describe('authentication', () => {
  it('rejects wrong passwords with a generic error', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: emailA, password: 'wrong' })
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('requires a session for protected routes', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
  });

  it('lists only the schools the user belongs to', async () => {
    const { agent } = await login(emailA);
    const res = await agent.get('/api/v1/auth/me').expect(200);
    expect(res.body.tenants.map((t: { id: string }) => t.id)).toEqual([tenantA]);
  });
});

describe('tenant isolation', () => {
  it('lets a director create and read years in their own tenant', async () => {
    const { agent, csrf } = await login(emailA);
    await agent
      .post('/api/v1/academic-years')
      .set('X-Tenant-Id', tenantA)
      .set('X-CSRF-Token', csrf)
      .send({ name: '2026-2027', startDate: '2026-09-01', endDate: '2027-07-31' })
      .expect(201);
    const res = await agent.get('/api/v1/academic-years').set('X-Tenant-Id', tenantA).expect(200);
    expect(res.body).toHaveLength(1);
  });

  it('forbids selecting a tenant the user is not a member of (scenario 1)', async () => {
    const { agent } = await login(emailB);
    const res = await agent.get('/api/v1/academic-years').set('X-Tenant-Id', tenantA).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('cannot read another tenant\'s record by id even within its own tenant context', async () => {
    const year = await owner.academicYear.findFirstOrThrow({ where: { tenantId: tenantA } });
    const { agent } = await login(emailB);
    await agent.get(`/api/v1/academic-years/${year.id}`).set('X-Tenant-Id', tenantB).expect(404);
  });

  it('answers malformed and unknown tenant ids identically', async () => {
    const { agent } = await login(emailB);
    const a = await agent.get('/api/v1/academic-years').set('X-Tenant-Id', 'not-a-uuid').expect(403);
    const b = await agent.get('/api/v1/academic-years').set('X-Tenant-Id', randomUUID()).expect(403);
    expect(a.body).toEqual(b.body);
  });
});

describe('permissions and CSRF', () => {
  it('forbids a teacher from creating academic years', async () => {
    const { agent, csrf } = await login(teacherEmail);
    await agent
      .post('/api/v1/academic-years')
      .set('X-Tenant-Id', tenantA)
      .set('X-CSRF-Token', csrf)
      .send({ name: '2030-2031', startDate: '2030-09-01', endDate: '2031-07-31' })
      .expect(403);
  });

  it('rejects state-changing requests without the CSRF token', async () => {
    const { agent } = await login(emailA);
    const res = await agent
      .post('/api/v1/academic-years')
      .set('X-Tenant-Id', tenantA)
      .send({ name: '2031-2032', startDate: '2031-09-01', endDate: '2032-07-31' })
      .expect(403);
    expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
  });

  it('rejects overlapping academic years (ACA-003)', async () => {
    const { agent, csrf } = await login(emailA);
    const res = await agent
      .post('/api/v1/academic-years')
      .set('X-Tenant-Id', tenantA)
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Overlap', startDate: '2027-01-01', endDate: '2027-12-31' })
      .expect(409);
    expect(res.body.error.code).toBe('ACADEMIC_YEAR_OVERLAP');
  });

  it('audits the creation in the same tenant', async () => {
    const logs = await owner.auditLog.findMany({ where: { tenantId: tenantA, action: 'academic_year.created' } });
    expect(logs).toHaveLength(1);
  });
});

describe('row-level security for the runtime role', () => {
  const appDb = new PrismaClient(); // DATABASE_URL = mboka_app

  afterAll(() => appDb.$disconnect());

  it('returns nothing without a tenant context', async () => {
    expect(await appDb.academicYear.count()).toBe(0);
  });

  it('returns only the current tenant\'s rows even without a where clause', async () => {
    const counts = await appDb.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantB}, true)`;
      return tx.academicYear.count();
    });
    expect(counts).toBe(0);
  });

  it('refuses to write a row for another tenant', async () => {
    await expect(
      appDb.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantB}, true)`;
        await tx.academicYear.create({
          data: { tenantId: tenantA, name: 'Injected', startDate: new Date('2040-09-01'), endDate: new Date('2041-07-01') },
        });
      }),
    ).rejects.toThrow();
  });

  it('cannot modify audit records', async () => {
    await expect(appDb.$executeRaw`DELETE FROM audit_logs`).rejects.toThrow();
  });
});

describe('suspension (scenario 10)', () => {
  it('blocks access to a suspended tenant without deleting data', async () => {
    await owner.tenant.update({ where: { id: tenantA }, data: { status: 'SUSPENDED' } });
    try {
      const { agent } = await login(emailA);
      const res = await agent.get('/api/v1/academic-years').set('X-Tenant-Id', tenantA).expect(403);
      expect(res.body.error.code).toBe('TENANT_SUSPENDED');
      expect(await owner.academicYear.count({ where: { tenantId: tenantA } })).toBe(1);
    } finally {
      await owner.tenant.update({ where: { id: tenantA }, data: { status: 'ACTIVE' } });
    }
  });
});
