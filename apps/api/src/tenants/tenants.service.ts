import { Injectable } from '@nestjs/common';
import type { CreateTenantInput, TenantStatusInput } from '@mboka/shared';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { provisionTenant } from './provision';

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.tenant.findMany({
      select: { id: true, slug: true, legalName: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(input: CreateTenantInput, actorId: string, ip?: string) {
    const tenantId = randomUUID();
    try {
      return await this.prisma.scoped({ tenantId, userId: actorId }, async (tx) => {
        const result = await provisionTenant(tx, tenantId, input);
        await this.audit.record(
          { tenantId, actorId, action: 'tenant.created', entityType: 'tenant', entityId: tenantId, metadata: { slug: input.slug }, ip },
          tx,
        );
        return result;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw Errors.conflict('TENANT_SLUG_TAKEN', 'A school with this identifier already exists');
      }
      throw e;
    }
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
