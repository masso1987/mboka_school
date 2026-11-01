import { Injectable } from '@nestjs/common';
import type { CreateTenantInput, TenantStatusInput } from '@mboka/shared';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PasswordLinksService } from '../auth/password-links.service';
import { Errors } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { provisionTenant, type ProvisionResult } from './provision';

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly links: PasswordLinksService,
  ) {}

  list() {
    return this.prisma.tenant.findMany({
      select: { id: true, slug: true, legalName: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Provisions a school from the Platform page. A new owner account is invited by e-mail to choose its
   * password (a one-time password returned once when no mail can be delivered); an existing account
   * becomes the director and is told by e-mail.
   */
  async create(input: CreateTenantInput, actorId: string, ip?: string) {
    const tenantId = randomUUID();
    const credentials = await this.links.newAccount();
    let result: ProvisionResult;
    try {
      result = await this.prisma.scoped({ tenantId, userId: actorId }, async (tx) => {
        const provisioned = await provisionTenant(tx, tenantId, input, undefined, credentials);
        await this.audit.record(
          { tenantId, actorId, action: 'tenant.created', entityType: 'tenant', entityId: tenantId, metadata: { slug: input.slug, ownerCreated: provisioned.ownerCreated }, ip },
          tx,
        );
        return provisioned;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw Errors.conflict('TENANT_SLUG_TAKEN', 'A school with this identifier already exists');
      }
      throw e;
    }
    if (!result.ownerCreated) await this.links.sendAddedNotice(input.ownerEmail, input.legalName, input.defaultLocale);
    else if (credentials.token) await this.links.sendInvitation(input.ownerEmail, input.ownerName, input.legalName, input.defaultLocale, credentials.token);
    return {
      tenantId,
      ownerUserId: result.ownerUserId,
      invitationSent: result.ownerCreated && Boolean(credentials.token),
      temporaryPassword: result.temporaryPassword,
    };
  }

  /** Suspension blocks ordinary access but keeps every record (TEN-007). */
  async setStatus(tenantId: string, input: TenantStatusInput, actorId: string, ip?: string) {
    return this.prisma.scoped({ tenantId, userId: actorId }, async (tx) => {
      const before = await tx.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
      if (!before) throw Errors.notFound('Tenant');
      if (before.status === 'CLOSED') throw Errors.conflict('TENANT_CLOSED', 'A closed tenant cannot change status');
      const tenant = await tx.tenant.update({
        where: { id: tenantId },
        data: { status: input.status },
        select: { id: true, status: true },
      });
      await this.audit.record(
        {
          tenantId,
          actorId,
          action: 'tenant.status_changed',
          entityType: 'tenant',
          entityId: tenantId,
          metadata: { from: before.status, to: input.status, reason: input.reason },
          ip,
        },
        tx,
      );
      return tenant;
    });
  }
}
