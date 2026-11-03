import { Injectable } from '@nestjs/common';
import type { ActiveInput, PersonInviteInput, SchoolUpdateInput } from '@mboka/shared';
import { Prisma, type TenantStatus } from '@prisma/client';
import { AdminService } from '../admin/admin.service';
import { AuditService } from '../audit/audit.service';
import { PasswordLinksService } from '../auth/password-links.service';
import { Errors } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

/** Who acts on the platform console: always a super administrator, never a member of the school. */
export interface PlatformActor {
  userId: string;
  ip?: string;
}

const tenantFields = { id: true, slug: true, legalName: true, tradingName: true, status: true, defaultLocale: true, defaultCurrency: true, timezone: true, settings: true, createdAt: true } as const;

/**
 * Schools seen from the platform console (Phase 7). Reads go through the read-only platform scope; every change
 * runs inside the school's own scope and is audited in its log. A school's "admins" are its members holding the
 * director role: the platform creates them, they create everyone else in Administration.
 */
@Injectable()
export class SchoolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly admin: AdminService,
    private readonly links: PasswordLinksService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async list(q?: string, status?: TenantStatus) {
    const where: Prisma.TenantWhereInput = {
      ...(status && { status }),
      ...(q && { OR: [{ legalName: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }, { tradingName: { contains: q, mode: 'insensitive' } }] }),
    };
    const tenants = await this.prisma.tenant.findMany({ where, select: tenantFields, orderBy: { createdAt: 'desc' } });
    const ids = tenants.map((t) => t.id);
    return this.prisma.platform(async (tx) => {
      const [students, members, directors] = [
        await tx.student.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, status: 'ACTIVE' }, _count: true }),
        await tx.membership.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, status: 'ACTIVE' }, _count: true }),
        await tx.userRoleAssignment.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, role: { key: 'director' } }, _count: true }),
      ];
      const count = (rows: { tenantId: string; _count: number }[]) => new Map(rows.map((r) => [r.tenantId, r._count]));
      const [s, m, d] = [count(students), count(members), count(directors)];
      const rows = [];
      for (const t of tenants) {
        const sub = await this.subscriptions.summary(tx, t.id);
        rows.push({
          tenant: { id: t.id, slug: t.slug, legalName: t.legalName, tradingName: t.tradingName, status: t.status, createdAt: t.createdAt.toISOString() },
          subscription: { plan: sub.plan, state: sub.state, endsAt: sub.endsAt },
          students: s.get(t.id) ?? 0,
          users: m.get(t.id) ?? 0,
          admins: d.get(t.id) ?? 0,
        });
      }
      return rows;
    });
  }

  async detail(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id }, select: tenantFields });
    if (!tenant) throw Errors.notFound('School');
    return this.prisma.platform(async (tx) => {
      const subscription = await this.subscriptions.summary(tx, id);
      const staff = await tx.staff.count({ where: { tenantId: id } });
      const admins = await this.admins(tx, id);
      const activity = await tx.auditLog.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 15 });
      const actors = await tx.user.findMany({ where: { id: { in: activity.flatMap((a) => (a.actorId ? [a.actorId] : [])) } }, select: { id: true, email: true } });
      const email = new Map(actors.map((u) => [u.id, u.email]));
      const settings = (tenant.settings ?? {}) as Record<string, unknown>;
      return {
        tenant: { ...tenant, settings: undefined, city: settings.city ?? null, phone: settings.phone ?? null, createdAt: tenant.createdAt.toISOString() },
        subscription,
        counts: { staff },
        admins,
        activity: activity.map((a) => ({ id: a.id, action: a.action, actor: a.actorId ? (email.get(a.actorId) ?? null) : null, createdAt: a.createdAt.toISOString() })),
      };
    });
  }

  private async admins(tx: Prisma.TransactionClient, tenantId: string) {
    const rows = await tx.membership.findMany({
      where: { tenantId, assignments: { some: { role: { key: 'director' } } } },
      include: { user: { select: { id: true, email: true, fullName: true, isActive: true, lastLoginAt: true, mfaEnabledAt: true, passwordHash: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((m) => ({
      userId: m.user.id,
      membershipId: m.id,
      email: m.user.email,
      fullName: m.user.fullName,
      status: m.status,
      accountActive: m.user.isActive,
      mfaEnabled: m.user.mfaEnabledAt !== null,
      // No password yet: the invitation has not been accepted.
      invitationPending: m.user.passwordHash === null,
      lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
    }));
  }

  async update(id: string, input: SchoolUpdateInput, a: PlatformActor) {
    return this.prisma.scoped({ tenantId: id, userId: a.userId }, async (tx) => {
      const before = await tx.tenant.findUnique({ where: { id }, select: { legalName: true, tradingName: true, defaultLocale: true, defaultCurrency: true, timezone: true } });
      if (!before) throw Errors.notFound('School');
      const after = await tx.tenant.update({ where: { id }, data: input, select: { id: true, legalName: true, tradingName: true, defaultLocale: true, defaultCurrency: true, timezone: true } });
      const changed = Object.keys(input) as (keyof typeof before)[];
      await this.audit.record(
        {
          tenantId: id,
          actorId: a.userId,
          action: 'platform.school_updated',
          entityType: 'tenant',
          entityId: id,
          metadata: { before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, after[k]])) },
          ip: a.ip,
        },
        tx,
      );
      return after;
    });
  }

  /** Adds a director: a new account is invited (or gets a one-time password), an existing one gains the school. */
  async addAdmin(id: string, input: PersonInviteInput, a: PlatformActor) {
    if (!(await this.prisma.tenant.findUnique({ where: { id }, select: { id: true } }))) throw Errors.notFound('School');
    const res = await this.admin.invite({ tenantId: id, userId: a.userId, ip: a.ip }, { ...input, roleKeys: ['director'] });
    await this.recordIn(id, a, { action: 'platform.school_admin_added', entityType: 'membership', entityId: res.membershipId, metadata: { email: input.email } });
    return res;
  }

  async resetAdmin(id: string, userId: string, a: PlatformActor) {
    await this.adminOrThrow(id, userId);
    const res = await this.links.resetByAdmin(userId);
    await this.recordIn(id, a, { action: 'platform.school_admin_reset', entityType: 'user', entityId: userId, metadata: { emailSent: res.emailSent } });
    return res;
  }

  /** Pausing removes the admin's access to this school only; the account and its history stay. */
  async setAdminActive(id: string, userId: string, input: ActiveInput, a: PlatformActor) {
    const membership = await this.adminOrThrow(id, userId);
    return this.prisma.scoped({ tenantId: id, userId: a.userId }, async (tx) => {
      const updated = await tx.membership.update({ where: { id: membership.id }, data: { status: input.active ? 'ACTIVE' : 'REVOKED' } });
      await this.audit.record(
        { tenantId: id, actorId: a.userId, action: input.active ? 'platform.school_admin_resumed' : 'platform.school_admin_paused', entityType: 'membership', entityId: membership.id, metadata: { reason: input.reason }, ip: a.ip },
        tx,
      );
      return { membershipId: updated.id, status: updated.status };
    });
  }

  /** A school's audit entries can only be written inside its own scope (row-level security). */
  private recordIn(tenantId: string, a: PlatformActor, entry: { action: string; entityType: string; entityId: string; metadata: Prisma.InputJsonObject }) {
    return this.prisma.scoped({ tenantId, userId: a.userId }, (tx) => this.audit.record({ tenantId, actorId: a.userId, ip: a.ip, ...entry }, tx));
  }

  private async adminOrThrow(tenantId: string, userId: string) {
    const m = await this.prisma.platform((tx) => tx.membership.findFirst({ where: { tenantId, userId, assignments: { some: { role: { key: 'director' } } } } }));
    if (!m) throw Errors.notFound('School admin');
    return m;
  }
}
