import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import { Errors } from '../common/api-error';
import type { AppRequest } from '../common/request-context';
import { IS_PUBLIC } from './metadata';
import { SESSION_COOKIE, SessionService } from './session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard: every route requires a valid session unless marked @Public().
 * State-changing requests must also echo the session's CSRF token in X-CSRF-Token
 * (synchronizer-token pattern; the token is never stored in a cookie).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token.length === 0) throw Errors.unauthenticated();

    const auth = await this.sessions.resolve(token);
    if (!auth) throw Errors.unauthenticated();

    if (!SAFE_METHODS.has(req.method) && !csrfMatches(req.header('x-csrf-token'), auth.csrfToken)) {
      throw Errors.csrf();
    }
    req.auth = auth;
    return true;
  }
}

export function csrfMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
