import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DEMO_GRACE_DAYS, type DemoCreateInput } from '@mboka/shared';
import { randomBytes, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { generateTemporaryPassword, hashPassword } from '../auth/password';
import { SessionService } from '../auth/session.service';
import { Errors } from '../common/api-error';
import { buildDemoAcademics, buildDemoFinance } from '../demo/demo-data';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { provisionTenant } from '../tenants/provision';
import type { PlatformActor } from './schools.service';

const DAY = 86_400_000;
/** Demo accounts live under this domain, so they never receive real e-mail and are easy to recognise. */
const DEMO_DOMAIN = 'demo.mboka.local';
/** Building a demo writes a few hundred rows: allow more than the usual transaction time. */
const BUILD_TIMEOUT_MS = 120_000;

const ACCOUNTS = [
  { key: 'directeur', role: 'director', name: { fr: 'Directeur (démo)', en: 'Director (demo)' } },
  { key: 'enseignant', role: 'teacher', name: { fr: 'Mme Ngo Bassa (démo)', en: 'Mrs Ngo Bassa (demo)' } },
  { key: 'comptable', role: 'chief_accountant', name: { fr: 'Comptable (démo)', en: 'Accountant (demo)' } },
  { key: 'parent', role: 'parent', name: { fr: 'Parent (démo)', en: 'Parent (demo)' } },
] as const;

/**
 * Demo schools (Phase 7): one click builds a school with sample classes, students, timetable, fees and a budget,
 * plus director, teacher, accountant and parent logins sharing one password shown once. Each demo has an expiry:
 * a sweep suspends it then, and closes it DEMO_GRACE_DAYS later (accounts disabled, sessions ended). Data stays in
 * the database; demos never count in the dashboard's schools, people or revenue.
 */
@Injectable()
export class DemoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Demo');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  onModuleInit() {
    const minutes = Number(process.env.DEMO_SWEEP_MINUTES ?? 60);
    if (minutes > 0) {
      this.timer = setInterval(() => void this.sweep().catch((e) => this.logger.error(e)), minutes * 60_000);
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private email(key: string, slug: string) {
    return `${key}.${slug}@${DEMO_DOMAIN}`;
  }

  async create(input: DemoCreateInput, a: PlatformActor) {
    const slug = `demo-${randomBytes(3).toString('hex')}`;
    const tenantId = randomUUID();
    const password = generateTemporaryPassword(12);
    const passwordHash = await hashPassword(password);
    const expiresAt = new Date(Date.now() + input.days * DAY);

    await this.prisma.scoped(
      { tenantId, userId: a.userId },
      async (tx) => {
        const director = ACCOUNTS[0];
        const { ownerUserId } = await provisionTenant(
          tx,
          tenantId,
          { slug, legalName: input.name, ownerEmail: this.email(director.key, slug), ownerName: director.name[input.locale], defaultLocale: input.locale, timezone: 'Africa/Douala', defaultCurrency: 'XAF' },
          password,
        );
        await tx.tenant.update({ where: { id: tenantId }, data: { isDemo: true, demoExpiresAt: expiresAt } });
        // A trial ending with the demo shows the countdown banner; generous limits so prospects can try freely.
        await tx.subscription.update({ where: { tenantId }, data: { status: 'TRIALING', trialEndsAt: expiresAt, maxStudents: 1000, maxCampuses: 3, maxUsers: 50, modules: [] } });

        const users: Record<string, string> = { [director.key]: ownerUserId };
        for (const acc of ACCOUNTS.slice(1)) {
          users[acc.key] = (await tx.user.create({ data: { email: this.email(acc.key, slug), fullName: acc.name[input.locale], passwordHash, locale: input.locale } })).id;
        }
        await buildDemoAcademics(tx, tenantId, users.enseignant!);
        await buildDemoFinance(tx, tenantId, ownerUserId);
        await this.grant(tx, tenantId, users.comptable!, 'chief_accountant');
        const parentMembership = await this.grant(tx, tenantId, users.parent!, 'parent');
        // The parent account follows the first family (two siblings).
        const guardian = await tx.guardian.findFirstOrThrow({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
        await tx.guardian.update({ where: { id: guardian.id }, data: { membershipId: parentMembership } });

        await this.audit.record(
          { tenantId, actorId: a.userId, action: 'platform.demo_created', entityType: 'tenant', entityId: tenantId, metadata: { name: input.name, days: input.days, expiresAt: expiresAt.toISOString() }, ip: a.ip },
          tx,
        );
      },
      BUILD_TIMEOUT_MS,
    );
    return {
      tenantId,
      slug,
      name: input.name,
      expiresAt: expiresAt.toISOString(),
      password,
      logins: ACCOUNTS.map((acc) => ({ role: acc.role, email: this.email(acc.key, slug) })),
    };
  }

  private async grant(tx: Tx, tenantId: string, userId: string, roleKey: string) {
    const m = await tx.membership.create({ data: { tenantId, userId } });
    const role = await tx.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId, key: roleKey } } });
    await tx.userRoleAssignment.create({ data: { tenantId, membershipId: m.id, roleId: role.id } });
    return m.id;
  }

  async list() {
    await this.sweep();
    const demos = await this.prisma.tenant.findMany({ where: { isDemo: true }, orderBy: { createdAt: 'desc' }, select: { id: true, slug: true, legalName: true, status: true, demoExpiresAt: true, createdAt: true } });
    const now = Date.now();
    return demos.map((d) => ({
      id: d.id,
      slug: d.slug,
      name: d.legalName,
      status: d.status,
      createdAt: d.createdAt.toISOString(),
      expiresAt: d.demoExpiresAt!.toISOString(),
      daysLeft: Math.max(0, Math.ceil((d.demoExpiresAt!.getTime() - now) / DAY)),
      logins: ACCOUNTS.map((acc) => ({ role: acc.role, email: this.email(acc.key, d.slug) })),
    }));
  }

  /** Adds days from today (or from the current end if later); a suspended demo comes back. */
  async extend(id: string, days: number, a: PlatformActor) {
    const demo = await this.demoOrThrow(id);
    if (demo.status === 'CLOSED') throw Errors.conflict('DEMO_CLOSED', 'This demo is closed; create a new one');
    const from = Math.max(Date.now(), demo.demoExpiresAt!.getTime());
    const expiresAt = new Date(from + days * DAY);
    await this.prisma.scoped({ tenantId: id, userId: a.userId }, async (tx) => {
      await tx.tenant.update({ where: { id }, data: { demoExpiresAt: expiresAt, status: 'ACTIVE' } });
      await tx.subscription.update({ where: { tenantId: id }, data: { trialEndsAt: expiresAt } });
      await this.audit.record({ tenantId: id, actorId: a.userId, action: 'platform.demo_extended', entityType: 'tenant', entityId: id, metadata: { days, expiresAt: expiresAt.toISOString() }, ip: a.ip }, tx);
    });
    return { id, expiresAt: expiresAt.toISOString() };
  }

  /** Closes a demo now: its accounts are disabled and signed out; the data stays. */
  async close(id: string, a: PlatformActor, reason = 'closed_by_admin') {
    const demo = await this.demoOrThrow(id);
    if (demo.status === 'CLOSED') return { id, status: 'CLOSED' as const };
    await this.closeDemo(demo.id, demo.slug, a.userId, reason, a.ip);
    return { id, status: 'CLOSED' as const };
  }

  /** Starts over: closes this demo and builds a fresh one with the same name and the days it had left (at least 1). */
  async recreate(id: string, a: PlatformActor) {
    const demo = await this.demoOrThrow(id);
    const days = Math.min(90, Math.max(1, Math.ceil((demo.demoExpiresAt!.getTime() - Date.now()) / DAY)));
    if (demo.status !== 'CLOSED') await this.closeDemo(demo.id, demo.slug, a.userId, 'recreated', a.ip);
    return this.create({ name: demo.legalName, days, locale: demo.defaultLocale === 'en' ? 'en' : 'fr' }, a);
  }

  /** Suspends demos that reached their end, and closes those suspended for DEMO_GRACE_DAYS. Safe to run any time. */
  async sweep(now = new Date()) {
    const expired = await this.prisma.tenant.findMany({ where: { isDemo: true, status: 'ACTIVE', demoExpiresAt: { lte: now } }, select: { id: true } });
    for (const d of expired) {
      await this.prisma.scoped({ tenantId: d.id }, async (tx) => {
        await tx.tenant.update({ where: { id: d.id }, data: { status: 'SUSPENDED' } });
        await this.audit.record({ tenantId: d.id, action: 'platform.demo_expired', entityType: 'tenant', entityId: d.id }, tx);
      });
    }
    const stale = await this.prisma.tenant.findMany({
      where: { isDemo: true, status: 'SUSPENDED', demoExpiresAt: { lte: new Date(now.getTime() - DEMO_GRACE_DAYS * DAY) } },
      select: { id: true, slug: true },
    });
    for (const d of stale) await this.closeDemo(d.id, d.slug, null, 'expired');
    return { suspended: expired.length, closed: stale.length };
  }

  private async closeDemo(id: string, slug: string, actorId: string | null, reason: string, ip?: string) {
    const accounts = await this.prisma.user.findMany({ where: { email: { in: ACCOUNTS.map((acc) => this.email(acc.key, slug)) } }, select: { id: true } });
    await this.prisma.scoped({ tenantId: id, userId: actorId }, async (tx) => {
      await tx.tenant.update({ where: { id }, data: { status: 'CLOSED' } });
      await tx.user.updateMany({ where: { id: { in: accounts.map((u) => u.id) } }, data: { isActive: false } });
      await this.audit.record({ tenantId: id, actorId: actorId ?? undefined, action: 'platform.demo_closed', entityType: 'tenant', entityId: id, metadata: { reason }, ip }, tx);
    });
    for (const u of accounts) await this.sessions.revokeAllForUser(u.id);
  }

  private async demoOrThrow(id: string) {
    const demo = await this.prisma.tenant.findFirst({ where: { id, isDemo: true }, select: { id: true, slug: true, legalName: true, status: true, demoExpiresAt: true, defaultLocale: true } });
    if (!demo) throw Errors.notFound('Demo school');
    return demo;
  }
}
