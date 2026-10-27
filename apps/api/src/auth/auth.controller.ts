import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { loginSchema, type LoginInput } from '@mboka/shared';
import type { Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/api-error';
import { type AppRequest, type AuthContext, clientIp, CurrentAuth } from '../common/request-context';
import { ApiZodBody, ZodBody } from '../common/zod';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from './decorators';
import { getDummyHash, verifyPassword } from './password';
import { SESSION_COOKIE, SessionService } from './session.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Throttle({ default: { limit: () => env().LOGIN_RATE_LIMIT, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ApiZodBody(loginSchema)
  async login(@ZodBody(loginSchema) body: LoginInput, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const user = await this.prisma.user.findUnique({ where: { email: body.email } });
    // Always run one scrypt verification so response time does not reveal whether the email exists.
    const ok = await verifyPassword(body.password, user?.passwordHash ?? (await getDummyHash()));

    if (!user || !user.passwordHash || !user.isActive || !ok) {
      await this.audit.record({
        action: 'auth.login.failed',
        actorId: user?.id,
        metadata: { reason: !user ? 'unknown_email' : !user.isActive ? 'inactive' : 'bad_password' },
        ip: clientIp(req),
      });
      throw Errors.invalidCredentials();
    }

    const session = await this.sessions.create(user.id, { ip: clientIp(req), userAgent: req.header('user-agent') });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({ action: 'auth.login.succeeded', actorId: user.id, ip: clientIp(req) });

    res.cookie(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: env().NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: session.expiresAt,
    });
    return { csrfToken: session.csrfToken, expiresAt: session.expiresAt.toISOString() };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.sessions.revoke(auth.sessionId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  /** The signed-in user, the schools they belong to, and the CSRF token for this session. */
  @Get('me')
  async me(@CurrentAuth() auth: AuthContext) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { id: true, email: true, fullName: true, locale: true, platformRole: true },
    });
    const memberships = await this.prisma.scoped({ userId: auth.userId }, (tx) =>
      tx.membership.findMany({
        where: { userId: auth.userId, status: 'ACTIVE' },
        select: {
          tenant: { select: { id: true, slug: true, legalName: true, tradingName: true, status: true, defaultLocale: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return { user, tenants: memberships.map((m) => m.tenant), csrfToken: auth.csrfToken };
  }
}
