/**
 * Idempotent seed. Runs as the schema owner (DIRECT_DATABASE_URL), so it bypasses RLS.
 *  - Synchronises the permission catalogue from @mboka/shared (required after adding a permission).
 *  - Ensures a platform super administrator exists.
 *  - Outside production, provisions a demo school.
 */
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PERMISSIONS } from '@mboka/shared';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/password';
import { provisionTenant } from '../src/tenants/provision';

if (existsSync('.env')) process.loadEnvFile('.env');

const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is required to seed');
const prisma = new PrismaClient({ datasourceUrl: url });

async function main() {
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({ where: { key }, create: { key, description }, update: { description } });
  }
  console.log(`permissions: ${Object.keys(PERMISSIONS).length} synchronised`);

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
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
