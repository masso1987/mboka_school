import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { PlatformRole } from '@prisma/client';
import type { Request } from 'express';
import { Errors } from './api-error';

export interface AuthContext {
  userId: string;
  sessionId: string;
  email: string;
  platformRole: PlatformRole;
  csrfToken: string;
}

export interface TenantContext {
  tenantId: string;
  membershipId: string;
  permissions: ReadonlySet<string>;
  /** IANA timezone of the school, for "today" and local schedules. */
  timezone: string;
}

export type AppRequest = Request & { auth?: AuthContext; tenant?: TenantContext };

export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<AppRequest>().auth;
  if (!auth) throw Errors.unauthenticated();
  return auth;
});

/** Only available on routes guarded by TenantGuard (via @RequirePermissions). */
export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantContext => {
  const tenant = ctx.switchToHttp().getRequest<AppRequest>().tenant;
  if (!tenant) throw Errors.tenantRequired();
  return tenant;
});

export function clientIp(req: Request): string | undefined {
  return req.ip ?? undefined;
}
