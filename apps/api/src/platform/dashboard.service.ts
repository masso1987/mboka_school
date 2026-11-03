import { Injectable } from '@nestjs/common';
import { subscriptionAccess } from '@mboka/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** More failed sign-ins than this in 24 hours raises an alert (possible password guessing). */
const FAILED_LOGIN_ALERT = 20;

/** Platform console home (Phase 7): schools, subscriptions, people, activity and alerts across every school. */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard() {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    // Demo schools are samples: they never count in schools, people, activity or revenue.
    const tenants = await this.prisma.tenant.findMany({ where: { isDemo: false }, select: { id: true, slug: true, legalName: true, status: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
    const ids = tenants.map((t) => t.id);
    const real = { tenantId: { in: ids } };
    const name = new Map(tenants.map((t) => [t.id, t.legalName]));

    return this.prisma.platform(async (tx) => {
      const subscriptions = await tx.subscription.findMany({ where: real });
      const students = await tx.student.count({ where: { ...real, status: 'ACTIVE' } });
      const members = await tx.membership.count({ where: { ...real, status: 'ACTIVE' } });
      const users = await tx.user.count({ where: { isActive: true, NOT: { email: { endsWith: '@demo.mboka.local' } } } });
      const sessionsNow = await tx.session.count({ where: { revokedAt: null, expiresAt: { gt: now }, lastSeenAt: { gt: new Date(now.getTime() - 15 * 60_000) } } });
      const logins24h = await tx.auditLog.count({ where: { action: 'auth.login.succeeded', createdAt: { gt: new Date(now.getTime() - DAY) } } });
      const failedLogins24h = await tx.auditLog.count({ where: { action: 'auth.login.failed', createdAt: { gt: new Date(now.getTime() - DAY) } } });
      const paid = await tx.subscriptionInvoice.groupBy({ by: ['currency'], where: { ...real, status: 'PAID', paidAt: { gte: monthStart } }, _sum: { amount: true } });
      const openInvoices = await tx.subscriptionInvoice.findMany({ where: { ...real, status: 'OPEN' }, select: { tenantId: true, number: true } });

      const states = { TRIAL: 0, OK: 0, GRACE: 0, EXPIRED: 0 } as Record<string, number>;
      const alerts: { kind: string; tenantId?: string; school?: string; date?: string | null; count?: number }[] = [];
      for (const s of subscriptions) {
        const access = subscriptionAccess(s, now);
        states[access.state] = (states[access.state] ?? 0) + 1;
        const school = name.get(s.tenantId);
        const ends = access.endsAt;
        if (access.state === 'EXPIRED' || access.state === 'GRACE') alerts.push({ kind: `SUBSCRIPTION_${access.state}`, tenantId: s.tenantId, school, date: ends?.toISOString() ?? null });
        else if (ends && ends.getTime() - now.getTime() < (access.state === 'TRIAL' ? 7 : 30) * DAY) {
          alerts.push({ kind: access.state === 'TRIAL' ? 'TRIAL_ENDING' : 'LICENCE_ENDING', tenantId: s.tenantId, school, date: ends.toISOString() });
        }
      }
      for (const t of tenants) if (t.status === 'SUSPENDED') alerts.push({ kind: 'SCHOOL_SUSPENDED', tenantId: t.id, school: t.legalName });
      for (const i of openInvoices) alerts.push({ kind: 'INVOICE_TO_CONFIRM', tenantId: i.tenantId, school: name.get(i.tenantId) });
      if (failedLogins24h > FAILED_LOGIN_ALERT) alerts.push({ kind: 'FAILED_LOGINS', count: failedLogins24h });

      return {
        schools: {
          total: tenants.length,
          active: tenants.filter((t) => t.status === 'ACTIVE').length,
          suspended: tenants.filter((t) => t.status === 'SUSPENDED').length,
          closed: tenants.filter((t) => t.status === 'CLOSED').length,
        },
        subscriptions: states,
        people: { students, users, members },
        activity: { sessionsNow, logins24h, failedLogins24h },
        revenueThisMonth: paid.map((p) => ({ currency: p.currency, amount: (p._sum.amount ?? new Prisma.Decimal(0)).toFixed(0) })),
        alerts,
        recentSchools: tenants.slice(0, 5).map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
      };
    });
  }
}
