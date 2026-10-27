import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Errors } from '../common/api-error';
import type { AppRequest } from '../common/request-context';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const auth = ctx.switchToHttp().getRequest<AppRequest>().auth;
    if (!auth) throw Errors.unauthenticated();
    if (auth.platformRole !== 'SUPER_ADMIN') throw Errors.forbidden();
    return true;
  }
}
