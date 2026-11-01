import { Controller, Get, HttpStatus, Put, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { z } from 'zod';
import { subscriptionAccess } from '@mboka/shared';
import { AuditService } from '../audit/audit.service';
import { RequirePermissions } from '../auth/decorators';
import { ApiException } from '../common/api-error';
import { type AppRequest, type AuthContext, clientIp, CurrentAuth, CurrentTenant, type TenantContext } from '../common/request-context';
import { ApiZodBody, ZodBody } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { ExportService } from './export.service';

const securitySchema = z.object({ requireMfaForPrivileged: z.boolean() });

@ApiTags('tenant')
@Controller('tenant')
export class TenantContextController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly exporter: ExportService,
  ) {}

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
          settings: true,
          campuses: { where: { tenantId: t.tenantId, isActive: true }, select: { id: true, code: true, name: true } },
          subscription: { select: { plan: true, status: true, trialEndsAt: true, currentUntil: true } },
        },
      });
      const roles = await tx.role.findMany({
        where: { tenantId: t.tenantId, assignments: { some: { membershipId: t.membershipId } } },
        select: { key: true, nameFr: true, nameEn: true },
      });
      const { settings, subscription: sub, ...rest } = tenant;
      // Drives the trial / renewal banner; details are on GET /subscription.
      const access = sub ? subscriptionAccess(sub, new Date()) : null;
      const subscription = sub && access ? { plan: sub.plan, state: access.state, writable: access.writable, endsAt: access.endsAt?.toISOString() ?? null, daysLeft: access.daysLeft } : null;
      const security = { requireMfaForPrivileged: Boolean((settings as { requireMfaForPrivileged?: boolean }).requireMfaForPrivileged) };
      return { tenant: { ...rest, security, subscription }, roles, permissions: [...t.permissions].sort() };
    });
  }

  /** School security policy: require MFA for privileged staff (§11.1). */
  @Put('security')
  @RequirePermissions('tenant.settings.update')
  @ApiZodBody(securitySchema)
  async security(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() t: TenantContext,
    @ZodBody(securitySchema) body: z.infer<typeof securitySchema>,
    @Req() req: AppRequest,
  ) {
    if (body.requireMfaForPrivileged && !auth.mfaEnabled) {
      // Avoid locking oneself out: whoever turns the rule on must already use MFA.
      throw new ApiException(HttpStatus.FORBIDDEN, 'MFA_SETUP_REQUIRED', 'Turn on two-factor authentication for yourself first');
    }
    return this.prisma.scoped({ tenantId: t.tenantId, userId: auth.userId }, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: t.tenantId }, select: { settings: true } });
      const settings = { ...((tenant.settings ?? {}) as Record<string, unknown>), requireMfaForPrivileged: body.requireMfaForPrivileged };
      await tx.tenant.update({ where: { id: t.tenantId }, data: { settings: settings as Prisma.InputJsonValue } });
      await this.audit.record(
        { tenantId: t.tenantId, actorId: auth.userId, action: 'tenant.security_changed', metadata: { requireMfaForPrivileged: body.requireMfaForPrivileged }, ip: clientIp(req) },
        tx,
      );
      return body;
    });
  }

  /** Complete export of the school's data as one JSON file (portability, end of contract). */
  @Get('export')
  @RequirePermissions('tenant.data.export')
  async export(@CurrentAuth() auth: AuthContext, @CurrentTenant() t: TenantContext, @Req() req: AppRequest, @Res() res: Response) {
    const body = await this.exporter.export(t.tenantId, auth.userId, clientIp(req));
    const date = new Date().toISOString().slice(0, 10);
    res
      .type('application/json; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="mboka-export-${date}.json"`)
      .setHeader('Cache-Control', 'no-store')
      .send(body);
  }
}
