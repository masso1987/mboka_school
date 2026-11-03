import { Injectable } from '@nestjs/common';
import type { ActiveInput, AuditQuery, LoginHistoryQuery, PlatformUsersQuery } from '@mboka/shared';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { Errors } from '../common/api-error';
import { toCsv } from '../common/csv';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type { PlatformActor } from './schools.service';

/** Audit actions that make up the sign-in history. */
export const SIGN_IN_ACTIONS = ['auth.login.succeeded', 'auth.login.failed', 'auth.login.password_ok', 'auth.mfa_failed', 'auth.mfa_replay_rejected', 'auth.mfa_recovery_code_used'];
const FAILURES = ['auth.login.failed', 'auth.mfa_failed', 'auth.mfa_replay_rejected'];
/** CSV exports stop here; narrow the filters for more. */
const CSV_LIMIT = 10_000;

/** Paging for the screen, or the first CSV_LIMIT rows for an export. */
const window = (csv: boolean, q: { page: number; pageSize: number }): { skip?: number; take: number } =>
  csv ? { take: CSV_LIMIT } : { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
const dayStart = (d: string) => new Date(`${d}T00:00:00.000Z`);
const dayEnd = (d: string) => new Date(dayStart(d).getTime() + 86_400_000);
const between = (from?: string, to?: string): Prisma.DateTimeFilter | undefined =>
  from || to ? { ...(from && { gte: dayStart(from) }), ...(to && { lt: dayEnd(to) }) } : undefined;

/**
 * Platform console (Phase 7), people and traces: every account with its schools and open sessions, pausing and
 * disconnecting them, the sign-in history and the whole audit log. Reads use the read-only platform scope.
 */
@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  // ------------------------------------------------------------ users and sessions

  users(q: PlatformUsersQuery) {
    return this.prisma.platform(async (tx) => {
      const where: Prisma.UserWhereInput = {
        ...(q.q && { OR: [{ email: { contains: q.q, mode: 'insensitive' } }, { fullName: { contains: q.q, mode: 'insensitive' } }] }),
        ...(q.status && { isActive: q.status === 'active' }),
        ...(q.tenantId && { memberships: { some: { tenantId: q.tenantId } } }),
      };
      const now = new Date();
      const [total, users] = await Promise.all([
        tx.user.count({ where }),
        tx.user.findMany({
          where,
          orderBy: [{ lastLoginAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          select: {
            id: true,
            email: true,
            fullName: true,
            platformRole: true,
            isActive: true,
            lastLoginAt: true,
            mfaEnabledAt: true,
            memberships: {
              select: { status: true, tenant: { select: { id: true, legalName: true } }, assignments: { select: { role: { select: { key: true } } } } },
            },
            sessions: { where: { revokedAt: null, expiresAt: { gt: now } }, select: { id: true } },
          },
        }),
      ]);
      return {
        total,
        page: q.page,
        pageSize: q.pageSize,
        items: users.map((u) => ({
          id: u.id,
          email: u.email,
          fullName: u.fullName,
          platformRole: u.platformRole,
          isActive: u.isActive,
          mfaEnabled: u.mfaEnabledAt !== null,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          activeSessions: u.sessions.length,
          schools: u.memberships.map((m) => ({ id: m.tenant.id, name: m.tenant.legalName, status: m.status, roles: m.assignments.map((x) => x.role.key) })),
        })),
      };
    });
  }

  async userSessions(userId: string) {
    await this.userOrThrow(userId);
    const rows = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
    });
    return rows.map((s) => ({ ...s, createdAt: s.createdAt.toISOString(), lastSeenAt: s.lastSeenAt?.toISOString() ?? null, expiresAt: s.expiresAt.toISOString() }));
  }

  /** Pausing refuses every sign-in and ends every session; the account and its history stay. */
  async setActive(userId: string, input: ActiveInput, a: PlatformActor) {
    const user = await this.userOrThrow(userId, a);
    if (!input.active && user.platformRole === 'SUPER_ADMIN') {
      const others = await this.prisma.user.count({ where: { platformRole: 'SUPER_ADMIN', isActive: true, id: { not: userId } } });
      if (others === 0) throw Errors.conflict('LAST_SUPER_ADMIN', 'The last active platform administrator cannot be deactivated');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { isActive: input.active } });
    const revoked = input.active ? 0 : await this.sessions.revokeAllForUser(userId);
    await this.audit.record({ actorId: a.userId, action: input.active ? 'platform.user_resumed' : 'platform.user_paused', entityType: 'user', entityId: userId, metadata: { reason: input.reason, sessionsRevoked: revoked }, ip: a.ip });
    return { userId, active: input.active, sessionsRevoked: revoked };
  }

  /** Signs the person out of every device; they can sign in again. */
  async disconnect(userId: string, a: PlatformActor) {
    await this.userOrThrow(userId, a);
    const revoked = await this.sessions.revokeAllForUser(userId);
    await this.audit.record({ actorId: a.userId, action: 'platform.user_disconnected', entityType: 'user', entityId: userId, metadata: { sessionsRevoked: revoked }, ip: a.ip });
    return { sessionsRevoked: revoked };
  }

  async revokeSession(sessionId: string, a: PlatformActor) {
    const s = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { userId: true } });
    if (!s) throw Errors.notFound('Session');
    if (s.userId === a.userId) throw Errors.forbidden('Use your own Account page to end your sessions');
    await this.sessions.revoke(sessionId);
    await this.audit.record({ actorId: a.userId, action: 'platform.session_revoked', entityType: 'user', entityId: s.userId, metadata: { sessionId }, ip: a.ip });
  }

  private async userOrThrow(userId: string, a?: PlatformActor) {
    if (a && userId === a.userId) throw Errors.forbidden('You cannot pause or disconnect your own account here');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, platformRole: true } });
    if (!user) throw Errors.notFound('User');
    return user;
  }

  // ------------------------------------------------------------ sign-in history

  async logins(q: LoginHistoryQuery, a: PlatformActor) {
    return this.prisma.platform(async (tx) => {
      const userIds = await this.matchingUsers(tx, q.q, q.tenantId);
      const where: Prisma.AuditLogWhereInput = {
        action: { in: q.failuresOnly === 'true' ? FAILURES : SIGN_IN_ACTIONS },
        ...(userIds && { actorId: { in: userIds } }),
        ...(between(q.from, q.to) && { createdAt: between(q.from, q.to) }),
      };
      const csv = q.format === 'csv';
      const [total, rows] = await Promise.all([
        tx.auditLog.count({ where }),
        tx.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...window(csv, q) }),
      ]);
      const people = await this.people(tx, rows.map((r) => r.actorId));
      const items = rows.map((r) => {
        const meta = (r.metadata ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          at: r.createdAt.toISOString(),
          action: r.action,
          success: !FAILURES.includes(r.action),
          reason: typeof meta.reason === 'string' ? meta.reason : null,
          ip: r.ip,
          user: r.actorId ? (people.get(r.actorId) ?? null) : null,
        };
      });
      if (!csv) return { total, page: q.page, pageSize: q.pageSize, items };
      await this.audit.record({ actorId: a.userId, action: 'platform.logins_exported', metadata: { rows: items.length }, ip: a.ip });
      return toCsv(
        ['date', 'action', 'result', 'reason', 'email', 'name', 'ip'],
        items.map((i) => [i.at, i.action, i.success ? 'ok' : 'failed', i.reason ?? '', i.user?.email ?? '', i.user?.fullName ?? '', i.ip ?? '']),
      );
    });
  }

  // ------------------------------------------------------------ audit log

  async auditLog(q: AuditQuery, a: PlatformActor) {
    return this.prisma.platform(async (tx) => {
      const actorIds = await this.matchingUsers(tx, q.actor);
      const where: Prisma.AuditLogWhereInput = {
        ...(q.tenantId && { tenantId: q.tenantId }),
        ...(q.action && { action: { startsWith: q.action } }),
        ...(actorIds && { actorId: { in: actorIds } }),
        ...(between(q.from, q.to) && { createdAt: between(q.from, q.to) }),
      };
      const csv = q.format === 'csv';
      const [total, rows] = await Promise.all([
        tx.auditLog.count({ where }),
        tx.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...window(csv, q) }),
      ]);
      const people = await this.people(tx, rows.map((r) => r.actorId));
      const tenantIds = [...new Set(rows.flatMap((r) => (r.tenantId ? [r.tenantId] : [])))];
      const schools = new Map((await tx.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, legalName: true } })).map((t) => [t.id, t.legalName]));
      const items = rows.map((r) => ({
        id: r.id,
        at: r.createdAt.toISOString(),
        action: r.action,
        school: r.tenantId ? { id: r.tenantId, name: schools.get(r.tenantId) ?? null } : null,
        actor: r.actorId ? (people.get(r.actorId) ?? null) : null,
        entityType: r.entityType,
        entityId: r.entityId,
        metadata: r.metadata,
        ip: r.ip,
      }));
      if (!csv) return { total, page: q.page, pageSize: q.pageSize, items };
      await this.audit.record({ actorId: a.userId, action: 'platform.audit_exported', metadata: { rows: items.length, tenantId: q.tenantId ?? null }, ip: a.ip });
      return toCsv(
        ['date', 'action', 'school', 'actor', 'entity', 'entity_id', 'details', 'ip'],
        items.map((i) => [i.at, i.action, i.school?.name ?? '', i.actor?.email ?? '', i.entityType ?? '', i.entityId ?? '', JSON.stringify(i.metadata), i.ip ?? '']),
      );
    });
  }

  /** Ids of the people matching a name/e-mail search and/or belonging to a school; undefined means "no filter". */
  private async matchingUsers(tx: Tx, search?: string, tenantId?: string): Promise<string[] | undefined> {
    if (!search && !tenantId) return undefined;
    const users = await tx.user.findMany({
      where: {
        ...(search && { OR: [{ email: { contains: search, mode: 'insensitive' } }, { fullName: { contains: search, mode: 'insensitive' } }] }),
        ...(tenantId && { memberships: { some: { tenantId } } }),
      },
      select: { id: true },
      take: 5000,
    });
    return users.map((u) => u.id);
  }

  private async people(tx: Tx, ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    const users = await tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, email: true, fullName: true } });
    return new Map(users.map((u) => [u.id, u]));
  }
}
