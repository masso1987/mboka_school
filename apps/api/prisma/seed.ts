/**
 * Idempotent seed. Runs as the schema owner (DIRECT_DATABASE_URL), so it bypasses RLS.
 *  - Synchronises the permission catalogue from @mboka/shared (required after adding a permission).
 *  - Ensures a platform super administrator exists.
 *  - Outside production, provisions a demo school.
 */
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DEFAULT_ROLES, PERMISSIONS } from '@mboka/shared';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/password';
import { provisionTenant } from '../src/tenants/provision';
import { seedDemoAcademics, seedDemoFinance } from './demo-data';

if (existsSync('.env')) process.loadEnvFile('.env');

const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is required to seed');
const prisma = new PrismaClient({ datasourceUrl: url });

async function main() {
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({ where: { key }, create: { key, description }, update: { description } });
  }
  console.log(`permissions: ${Object.keys(PERMISSIONS).length} synchronised`);

  // Grant permissions newly added to a role template to that system role in every school.
  // Only adds: permissions a school removed from a system role are not re-added unless new to the template.
  let added = 0;
  for (const template of DEFAULT_ROLES) {
    const roles = await prisma.role.findMany({ where: { key: template.key, isSystem: true }, select: { id: true, tenantId: true } });
    for (const role of roles) {
      const res = await prisma.rolePermission.createMany({
        data: template.permissions.map((permissionKey) => ({ tenantId: role.tenantId, roleId: role.id, permissionKey })),
        skipDuplicates: true,
      });
      added += res.count;
    }
  }
  if (added > 0) console.log(`system roles: ${added} template permissions granted`);

  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@mboka.local').toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) throw new Error('SEED_ADMIN_PASSWORD is required');
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        email: adminEmail,
        fullName: 'Platform Administrator',
        platformRole: 'SUPER_ADMIN',
        passwordHash: await hashPassword(adminPassword),
      },
    });
    console.log(`platform admin created: ${adminEmail}`);
  }

  if (process.env.NODE_ENV !== 'production' && !(await prisma.tenant.findUnique({ where: { slug: 'demo' } }))) {
    const demoPassword = process.env.SEED_DEMO_PASSWORD ?? 'Demo!2026';
    await prisma.$transaction((tx) =>
      provisionTenant(
        tx,
        randomUUID(),
        {
          slug: 'demo',
          legalName: 'Collège Bilingue Démo de Douala',
          tradingName: 'CBD Douala',
          defaultLocale: 'fr',
          timezone: 'Africa/Douala',
          defaultCurrency: 'XAF',
          ownerEmail: 'directeur@demo.mboka.local',
          ownerName: 'Directeur Démo',
        },
        demoPassword,
      ),
    );
    console.log('demo school created: directeur@demo.mboka.local');
  }

  if (process.env.NODE_ENV !== 'production') {
    const demo = await prisma.tenant.findUnique({ where: { slug: 'demo' } });
    if (demo && (await seedDemoAcademics(prisma, demo.id, process.env.SEED_DEMO_PASSWORD ?? 'Demo!2026'))) {
      console.log('demo academics created: levels, subjects, classes, 24 students, teacher enseignant@demo.mboka.local');
    }
    if (demo && (await seedDemoFinance(prisma, demo.id))) {
      console.log('demo finance created: XAF/EUR, tuition schedule billed to every student, expense budget');
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
