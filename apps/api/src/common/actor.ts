import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Errors } from './api-error';
import type { AppRequest } from './request-context';

/** Who is acting, in which tenant, with which permissions — everything a tenant service needs. */
export interface Actor {
  tenantId: string;
  userId: string;
  membershipId: string;
  permissions: ReadonlySet<string>;
  timezone: string;
  ip?: string;
}

/** Only valid on routes guarded by @RequirePermissions(...). */
export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.auth) throw Errors.unauthenticated();
  if (!req.tenant) throw Errors.tenantRequired();
  return {
    tenantId: req.tenant.tenantId,
    userId: req.auth.userId,
    membershipId: req.tenant.membershipId,
    permissions: req.tenant.permissions,
    timezone: req.tenant.timezone,
    ip: req.ip ?? undefined,
  };
});
