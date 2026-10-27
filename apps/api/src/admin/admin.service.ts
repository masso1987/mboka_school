import { HttpStatus, Injectable } from '@nestjs/common';
import type { CampusInput, InviteUserInput, MembershipStatusInput, UserRolesInput } from '@mboka/shared';
import { AuditService } from '../audit/audit.service';
import { generateTemporaryPassword, hashPassword } from '../auth/password';
import type { Actor } from '../common/actor';
import { ApiException, Errors } from '../common/api-error';
import { guardDb } from '../common/db-errors';
import { PrismaService, type Tx } from '../prisma/prisma.service';

const planLimit = (what: string) =>
  new ApiException(HttpStatus.PAYMENT_REQUIRED, 'PLAN_LIMIT_REACHED', `Your subscription does not allow more ${what}`);

/** School administration: campuses, user accounts and role assignment (TEN-003/006, §3.3). */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private run<T>(a: Actor, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  // ------------------------------------------------------------ campuses

  listCampuses(a: Actor) {
    return this.run(a, (tx) => tx.campus.findMany({ where: { tenantId: a.tenantId }, orderBy: { code: 'asc' } }));
  }

  createCampus(a: Actor, input: CampusInput) {
    return guardDb(
      this.run(a, async (tx) => {
        const [sub, count] = await Promise.all([
          tx.subscription.findUnique({ where: { tenantId: a.tenantId } }),
          tx.campus.count({ where: { tenantId: a.tenantId, isActive: true } }),
        ]);
        if (sub && count >= sub.maxCampuses) throw planLimit('campuses');
        const campus = await tx.campus.create({ data: { tenantId: a.tenantId, ...input } });
        await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'campus.created', entityType: 'campus', entityId: campus.id, ip: a.ip }, tx);
        return campus;
      }),
      { Campus: () => Errors.conflict('CODE_TAKEN', 'Campus code already in use') },
    );
  }

  // ------------------------------------------------------------ users and roles

  listRoles(a: Actor) {
    return this.run(a, (tx) =>
      tx.role.findMany({
        where: { tenantId: a.tenantId },
        select: { id: true, key: true, nameFr: true, nameEn: true, isSystem: true, permissions: { select: { permissionKey: true } } },
        orderBy: { key: 'asc' },
      }),
    ).then((roles) => roles.map(({ permissions, ...r }) => ({ ...r, permissions: permissions.map((p) => p.permissionKey) })));
  }

  listUsers(a: Actor) {
    return this.run(a, async (tx) => {
      const rows = await tx.membership.findMany({
        where: { tenantId: a.tenantId },
        include: {
          user: { select: { id: true, email: true, fullName: true, lastLoginAt: true, isActive: true } },
          assignments: { select: { role: { select: { key: true, nameFr: true, nameEn: true } } } },
          staff: { select: { id: true, staffNumber: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((m) => ({
        membershipId: m.id,
        status: m.status,
        user: { ...m.user, lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null },
        roles: m.assignments.map((x) => x.role),
        staff: m.staff,
        isSelf: m.userId === a.userId,
      }));
    });
  }

  /**
   * Adds a person to the school. A new account receives a one-time temporary password
   * (returned once) until email invitations exist; an existing account just gains the membership.
   */
  invite(a: Actor, input: InviteUserInput) {
    return this.run(a, async (tx) => {
      const roles = await this.rolesOrThrow(tx, a, input.roleKeys);
      const [sub, activeMembers] = await Promise.all([
        tx.subscription.findUnique({ where: { tenantId: a.tenantId } }),
        tx.membership.count({ where: { tenantId: a.tenantId, status: 'ACTIVE' } }),
      ]);
      if (sub && activeMembers >= sub.maxUsers) throw planLimit('users');

      let user = await tx.user.findUnique({ where: { email: input.email } });
      let temporaryPassword: string | undefined;
      if (!user) {
        temporaryPassword = generateTemporaryPassword();
        user = await tx.user.create({ data: { email: input.email, fullName: input.fullName, passwordHash: await hashPassword(temporaryPassword) } });
      }
      const existing = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: a.tenantId, userId: user.id } } });
      if (existing?.status === 'ACTIVE') throw Errors.conflict('ALREADY_MEMBER', 'This person already has access to the school');
      const membership = existing
        ? await tx.membership.update({ where: { id: existing.id }, data: { status: 'ACTIVE' } })
        : await tx.membership.create({ data: { tenantId: a.tenantId, userId: user.id } });
      await tx.userRoleAssignment.deleteMany({ where: { tenantId: a.tenantId, membershipId: membership.id } });
      await tx.userRoleAssignment.createMany({
        data: roles.map((r) => ({ tenantId: a.tenantId, membershipId: membership.id, roleId: r.id })),
      });
      await this.audit.record(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'user.invited',
          entityType: 'membership',
          entityId: membership.id,
          metadata: { email: input.email, roles: input.roleKeys, newAccount: Boolean(temporaryPassword) },
          ip: a.ip,
        },
        tx,
      );
      return { membershipId: membership.id, userId: user.id, temporaryPassword };
    });
  }

  /** A user can never change their own roles (separation of duties, §3.3). */
  setRoles(a: Actor, membershipId: string, input: UserRolesInput) {
    return this.run(a, async (tx) => {
      const m = await this.memberOrThrow(tx, a, membershipId);
      if (m.userId === a.userId) throw Errors.forbidden('You cannot change your own roles');
      const roles = await this.rolesOrThrow(tx, a, input.roleKeys);
      const before = await tx.userRoleAssignment.findMany({
        where: { tenantId: a.tenantId, membershipId },
        select: { role: { select: { key: true } } },
      });
      await tx.userRoleAssignment.deleteMany({ where: { tenantId: a.tenantId, membershipId } });
      await tx.userRoleAssignment.createMany({ data: roles.map((r) => ({ tenantId: a.tenantId, membershipId, roleId: r.id })) });
      await this.audit.record(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'user.roles_changed',
          entityType: 'membership',
          entityId: membershipId,
          metadata: { before: before.map((b) => b.role.key), after: input.roleKeys },
          ip: a.ip,
        },
        tx,
      );
      return { membershipId, roles: input.roleKeys };
    });
  }

  /** Revoking access keeps the account and all history; it only removes the membership's effect. */
  setMembershipStatus(a: Actor, membershipId: string, input: MembershipStatusInput) {
    return this.run(a, async (tx) => {
      const m = await this.memberOrThrow(tx, a, membershipId);
      if (m.userId === a.userId) throw Errors.forbidden('You cannot change your own access');
      const updated = await tx.membership.update({ where: { id: membershipId }, data: { status: input.status } });
      await this.audit.record(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: input.status === 'REVOKED' ? 'user.access_revoked' : 'user.access_restored',
          entityType: 'membership',
          entityId: membershipId,
          metadata: { reason: input.reason },
          ip: a.ip,
        },
        tx,
      );
      return { membershipId, status: updated.status };
    });
  }

  private async memberOrThrow(tx: Tx, a: Actor, membershipId: string) {
    const m = await tx.membership.findFirst({ where: { id: membershipId, tenantId: a.tenantId } });
    if (!m) throw Errors.notFound('User');
    return m;
  }

  private async rolesOrThrow(tx: Tx, a: Actor, keys: string[]) {
    const unique = [...new Set(keys)];
    const roles = await tx.role.findMany({ where: { tenantId: a.tenantId, key: { in: unique } } });
    if (roles.length !== unique.length) {
      const found = new Set(roles.map((r) => r.key));
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'UNKNOWN_ROLE', 'Unknown role', { roles: unique.filter((k) => !found.has(k)) });
    }
    return roles;
  }
}
