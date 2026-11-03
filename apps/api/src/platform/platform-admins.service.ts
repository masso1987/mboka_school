import { Injectable } from '@nestjs/common';
import type { ActiveInput, PersonInviteInput } from '@mboka/shared';
import { AuditService } from '../audit/audit.service';
import { PasswordLinksService } from '../auth/password-links.service';
import { SessionService } from '../auth/session.service';
import { Errors } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import type { PlatformActor } from './schools.service';

const PLATFORM_NAME = 'Mboka School — plateforme';

/**
 * The platform team (Phase 7): super administrators. Two-factor authentication is forced at their first sign-in.
 * Nobody can deactivate themselves, and the last active super administrator can never be deactivated.
 */
@Injectable()
export class PlatformAdminsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly links: PasswordLinksService,
    private readonly sessions: SessionService,
  ) {}

  async list() {
    const users = await this.prisma.user.findMany({
      where: { platformRole: { not: 'NONE' } },
      select: { id: true, email: true, fullName: true, platformRole: true, isActive: true, mfaEnabledAt: true, lastLoginAt: true, createdAt: true, passwordHash: true },
      orderBy: { createdAt: 'asc' },
    });
    return users.map(({ passwordHash, mfaEnabledAt, ...u }) => ({
      ...u,
      mfaEnabled: mfaEnabledAt !== null,
      invitationPending: passwordHash === null,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  async create(input: PersonInviteInput, a: PlatformActor) {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing?.platformRole === 'SUPER_ADMIN') throw Errors.conflict('ALREADY_PLATFORM_ADMIN', 'This person is already a platform administrator');
    let userId: string;
    let invitationSent = false;
    let temporaryPassword: string | undefined;
    if (existing) {
      await this.prisma.user.update({ where: { id: existing.id }, data: { platformRole: 'SUPER_ADMIN' } });
      // Sessions opened before the promotion did not need two-factor authentication.
      await this.sessions.revokeAllForUser(existing.id);
      await this.links.sendAddedNotice(existing.email, PLATFORM_NAME, existing.locale);
      userId = existing.id;
    } else {
      const credentials = await this.links.newAccount();
      const user = await this.prisma.user.create({ data: { email: input.email, fullName: input.fullName, platformRole: 'SUPER_ADMIN', ...credentials.data } });
      if (credentials.token) await this.links.sendInvitation(input.email, input.fullName, PLATFORM_NAME, 'fr', credentials.token);
      userId = user.id;
      invitationSent = Boolean(credentials.token);
      temporaryPassword = credentials.temporaryPassword;
    }
    await this.audit.record({ actorId: a.userId, action: 'platform.admin_added', entityType: 'user', entityId: userId, metadata: { email: input.email, newAccount: !existing }, ip: a.ip });
    return { userId, invitationSent, temporaryPassword };
  }

  async reset(userId: string, a: PlatformActor) {
    await this.adminOrThrow(userId, a);
    const res = await this.links.resetByAdmin(userId);
    await this.audit.record({ actorId: a.userId, action: 'platform.admin_reset', entityType: 'user', entityId: userId, metadata: { emailSent: res.emailSent }, ip: a.ip });
    return res;
  }

  async setActive(userId: string, input: ActiveInput, a: PlatformActor) {
    await this.adminOrThrow(userId, a);
    if (!input.active) {
      const others = await this.prisma.user.count({ where: { platformRole: 'SUPER_ADMIN', isActive: true, id: { not: userId } } });
      if (others === 0) throw Errors.conflict('LAST_SUPER_ADMIN', 'The last active platform administrator cannot be deactivated');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { isActive: input.active } });
    if (!input.active) await this.sessions.revokeAllForUser(userId);
    await this.audit.record({ actorId: a.userId, action: input.active ? 'platform.admin_reactivated' : 'platform.admin_deactivated', entityType: 'user', entityId: userId, metadata: { reason: input.reason }, ip: a.ip });
    return { userId, active: input.active };
  }

  private async adminOrThrow(userId: string, a: PlatformActor) {
    if (userId === a.userId) throw Errors.forbidden('Use your own Account page; you cannot act on your own administrator account here');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { platformRole: true } });
    if (!user || user.platformRole === 'NONE') throw Errors.notFound('Platform administrator');
  }
}
