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

export const PASSWORD = 'E2e-Passw0rd!';

/** Owner connection (bypasses RLS) for arranging fixtures and asserting on stored rows. */
export const owner = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

export async function createApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
  configureApp(app);
  await app.init();
  return app;
}

export async function provisionSchool(run: string, label: string) {
  const tenantId = randomUUID();
  const email = `dir-${label}-${run}@e2e.local`;
  await owner.$transaction((tx) =>
    provisionTenant(
      tx,
      tenantId,
      {
        slug: `${label}-${run}`,
        legalName: `School ${label}`,
        ownerEmail: email,
        ownerName: `Director ${label}`,
        defaultLocale: 'fr',
        timezone: 'Africa/Douala',
        defaultCurrency: 'XAF',
      },
      PASSWORD,
    ),
  );
  return { tenantId, email };
}

/** Adds a user with the given role keys to a tenant; returns its email and membership id. */
export async function addMember(tenantId: string, email: string, roleKeys: string[]) {
  const user = await owner.user.create({ data: { email, fullName: email.split('@')[0]!, passwordHash: await hashPassword(PASSWORD) } });
  const m = await owner.membership.create({ data: { tenantId, userId: user.id } });
  for (const key of roleKeys) {
    const role = await owner.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId, key } } });
    await owner.userRoleAssignment.create({ data: { tenantId, membershipId: m.id, roleId: role.id } });
  }
  return { email, membershipId: m.id, userId: user.id };
}

/** A logged-in client bound to one tenant, sending CSRF and tenant headers automatically. */
export async function client(app: NestExpressApplication, email: string, tenantId: string, password = PASSWORD) {
  const agent = request.agent(app.getHttpServer());
  const res = await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);
  const csrf = res.body.csrfToken as string;
  const base = '/api/v1';
  return {
    get: (path: string) => agent.get(base + path).set('X-Tenant-Id', tenantId),
    post: (path: string, body?: object) => agent.post(base + path).set('X-Tenant-Id', tenantId).set('X-CSRF-Token', csrf).send(body),
    put: (path: string, body?: object) => agent.put(base + path).set('X-Tenant-Id', tenantId).set('X-CSRF-Token', csrf).send(body),
    patch: (path: string, body?: object) => agent.patch(base + path).set('X-Tenant-Id', tenantId).set('X-CSRF-Token', csrf).send(body),
    del: (path: string) => agent.delete(base + path).set('X-Tenant-Id', tenantId).set('X-CSRF-Token', csrf),
  };
}

export type Client = Awaited<ReturnType<typeof client>>;

/** Today in Africa/Douala (the fixtures' timezone), as the API computes it. */
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Douala' }).format(new Date());
}

export function addDays(iso: string, days: number): string {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
