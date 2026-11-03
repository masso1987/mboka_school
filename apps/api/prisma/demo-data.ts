/**
 * Development-only demo content for the "demo" school (see src/demo/demo-data.ts for what it contains).
 * Runs once: skipped when the school already has education levels or fee categories.
 */
import type { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/password';
import { buildDemoAcademics, buildDemoFinance } from '../src/demo/demo-data';

export async function seedDemoFinance(prisma: PrismaClient, tenantId: string): Promise<boolean> {
  if ((await prisma.feeCategory.count({ where: { tenantId } })) > 0) return false;
  if (!(await prisma.academicYear.findFirst({ where: { tenantId, name: '2026-2027' } }))) return false;
  const director = await prisma.user.findUniqueOrThrow({ where: { email: 'directeur@demo.mboka.local' } });
  await prisma.$transaction((tx) => buildDemoFinance(tx, tenantId, director.id), { timeout: 60_000 });
  return true;
}

export async function seedDemoAcademics(prisma: PrismaClient, tenantId: string, password: string): Promise<boolean> {
  if ((await prisma.educationLevel.count({ where: { tenantId } })) > 0) return false;
  await prisma.$transaction(
    async (tx) => {
      const teacher = await tx.user.upsert({
        where: { email: 'enseignant@demo.mboka.local' },
        create: { email: 'enseignant@demo.mboka.local', fullName: 'Mme Ngo Bassa', passwordHash: await hashPassword(password) },
        update: {},
      });
      await buildDemoAcademics(tx, tenantId, teacher.id);
    },
    { timeout: 60_000 },
  );
  return true;
}
