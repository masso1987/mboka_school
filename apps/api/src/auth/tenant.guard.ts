import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasAllPermissions, type PermissionKey } from '@mboka/shared';
import { Errors } from '../common/api-error';
import type { AppRequest } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { REQUIRED_PERMISSIONS } from './metadata';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the tenant from the authenticated user's *verified* membership (spec §6.4.1):
 * the X-Tenant-Id header only selects among the caller's own memberships.
 * Loads the caller's effective permissions in that tenant and enforces the route's requirements.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (!req.auth) throw Errors.unauthenticated();

    const tenantId = req.header('x-tenant-id');
    if (!tenantId) throw Errors.tenantRequired();
    // A malformed id is answered exactly like a foreign one, so ids cannot be probed.
    if (!UUID.test(tenantId)) throw Errors.forbidden();

    const userId = req.auth.userId;
    const resolved = await this.prisma.scoped({ tenantId, userId }, async (tx) => {
      const membership = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
        select: { id: true, status: true, tenant: { select: { status: true, timezone: true } } },
      });
      if (!membership || membership.status !== 'ACTIVE') return null;
      const grants = await tx.rolePermission.findMany({
        where: { tenantId, role: { assignments: { some: { membershipId: membership.id } } } },
        select: { permissionKey: true },
      });
      return { membership, permissions: new Set(grants.map((g) => g.permissionKey)) };
    });

    if (!resolved) throw Errors.forbidden();
    if (resolved.membership.tenant.status !== 'ACTIVE') throw Errors.tenantSuspended();

    const required =
      this.reflector.getAllAndOverride<PermissionKey[]>(REQUIRED_PERMISSIONS, [ctx.getHandler(), ctx.getClass()]) ?? [];
    if (!hasAllPermissions(resolved.permissions, required)) throw Errors.forbidden();

    req.tenant = {
      tenantId,
      membershipId: resolved.membership.id,
      permissions: resolved.permissions,
      timezone: resolved.membership.tenant.timezone,
    };
    return true;
  }
}
