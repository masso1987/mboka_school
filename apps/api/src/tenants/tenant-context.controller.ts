import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators';
import { type AuthContext, CurrentAuth, CurrentTenant, type TenantContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('tenant')
@Controller('tenant')
export class TenantContextController {
  constructor(private readonly prisma: PrismaService) {}

  /** The selected school and the caller's roles and permissions in it — drives navigation filtering in the UI. */
  @Get('context')
  @RequirePermissions()
  async context(@CurrentAuth() auth: AuthContext, @CurrentTenant() t: TenantContext) {
    return this.prisma.scoped({ tenantId: t.tenantId, userId: auth.userId }, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: t.tenantId },
        select: {
          id: true,
          slug: true,
          legalName: true,
          tradingName: true,
          defaultLocale: true,
          timezone: true,
          defaultCurrency: true,
          campuses: { where: { tenantId: t.tenantId, isActive: true }, select: { id: true, code: true, name: true } },
        },
      });
      const roles = await tx.role.findMany({
        where: { tenantId: t.tenantId, assignments: { some: { membershipId: t.membershipId } } },
        select: { key: true, nameFr: true, nameEn: true },
      });
      return { tenant, roles, permissions: [...t.permissions].sort() };
    });
  }
}
