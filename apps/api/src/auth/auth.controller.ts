import { Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  loginSchema,
  mfaCodeSchema,
  mfaDisableSchema,
  passwordChangeSchema,
  type LoginInput,
  type MfaCodeInput,
  type MfaDisableInput,
  type PasswordChangeInput,
} from '@mboka/shared';
import type { Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { ApiException, Errors } from '../common/api-error';
import { type AppRequest, type AuthContext, clientIp, CurrentAuth } from '../common/request-context';
import { ApiZodBody, ZodBody } from '../common/zod';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { AccountService } from './account.service';
import { AllowDuringMfa, Public } from './decorators';
import { getDummyHash, verifyPassword } from './password';
import { mfaSetupRequired } from './session.guard';
import { SESSION_COOKIE, SessionService } from './session.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly account: AccountService,
  ) {}

  /**
   * Password step. With MFA on, the session opened here is limited to the second step
   * (`mfaRequired: true`) until POST /auth/mfa/verify succeeds.
   */
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

    if (user.emailVerificationRequired) {
      await this.audit.record({ action: 'auth.login.failed', actorId: user.id, metadata: { reason: 'email_not_verified' }, ip: clientIp(req) });
      throw new ApiException(HttpStatus.FORBIDDEN, 'EMAIL_NOT_VERIFIED', 'Confirm your e-mail address first: open the link we sent you');
    }

    const mfaRequired = user.mfaEnabledAt !== null;
    const session = await this.sessions.create(user.id, { ip: clientIp(req), userAgent: req.header('user-agent'), mfaVerified: !mfaRequired });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({ action: mfaRequired ? 'auth.login.password_ok' : 'auth.login.succeeded', actorId: user.id, ip: clientIp(req) });

    res.cookie(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: env().NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: session.expiresAt,
    });
    return {
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt.toISOString(),
      mfaRequired,
      mfaSetupRequired: !mfaRequired && user.platformRole === 'SUPER_ADMIN',
    };
  }

  @Post('logout')
  @HttpCode(204)
  @AllowDuringMfa('verify', 'setup')
  async logout(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.sessions.revoke(auth.sessionId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  /** The signed-in user, the schools they belong to, the CSRF token, and where they are in the MFA flow. */
  @Get('me')
  @AllowDuringMfa('verify', 'setup')
  async me(@CurrentAuth() auth: AuthContext) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { id: true, email: true, fullName: true, locale: true, platformRole: true },
    });
    const security = { mfaPending: !auth.mfaVerified, mfaSetupRequired: auth.mfaVerified && mfaSetupRequired(auth), mfaEnabled: auth.mfaEnabled };
    if (!auth.mfaVerified) return { user, tenants: [], csrfToken: auth.csrfToken, security };
    const memberships = await this.prisma.scoped({ userId: auth.userId }, (tx) =>
      tx.membership.findMany({
        where: { userId: auth.userId, status: 'ACTIVE' },
        select: {
          tenant: { select: { id: true, slug: true, legalName: true, tradingName: true, status: true, defaultLocale: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return { user, tenants: memberships.map((m) => m.tenant), csrfToken: auth.csrfToken, security };
  }

  // ------------------------------------------------------------ MFA

  @Post('mfa/verify')
  @HttpCode(200)
  @AllowDuringMfa('verify')
  @Throttle({ default: { limit: () => env().LOGIN_RATE_LIMIT, ttl: 60_000 } })
  @ApiZodBody(mfaCodeSchema)
  verify(@CurrentAuth() auth: AuthContext, @ZodBody(mfaCodeSchema) body: MfaCodeInput, @Req() req: AppRequest) {
    return this.account.verify(auth, body.code, clientIp(req));
  }

  @Post('mfa/setup')
  @HttpCode(200)
  @AllowDuringMfa('setup')
  setup(@CurrentAuth() auth: AuthContext) {
    return this.account.setup(auth);
  }

  @Post('mfa/enable')
  @HttpCode(200)
  @AllowDuringMfa('setup')
  @Throttle({ default: { limit: () => env().LOGIN_RATE_LIMIT, ttl: 60_000 } })
  @ApiZodBody(mfaCodeSchema)
  enable(@CurrentAuth() auth: AuthContext, @ZodBody(mfaCodeSchema) body: MfaCodeInput, @Req() req: AppRequest) {
    return this.account.enable(auth, body.code, clientIp(req));
  }

  @Post('mfa/disable')
  @HttpCode(200)
  @ApiZodBody(mfaDisableSchema)
  disable(@CurrentAuth() auth: AuthContext, @ZodBody(mfaDisableSchema) body: MfaDisableInput, @Req() req: AppRequest) {
    return this.account.disable(auth, body, clientIp(req));
  }

  // ------------------------------------------------------------ password and sessions

  @Get('account')
  @AllowDuringMfa('setup')
  status(@CurrentAuth() auth: AuthContext) {
    return this.account.status(auth.userId);
  }

  @Post('password')
  @HttpCode(200)
  @AllowDuringMfa('setup')
  @ApiZodBody(passwordChangeSchema)
  changePassword(@CurrentAuth() auth: AuthContext, @ZodBody(passwordChangeSchema) body: PasswordChangeInput, @Req() req: AppRequest) {
    return this.account.changePassword(auth, body, clientIp(req));
  }

  @Get('sessions')
  sessionsList(@CurrentAuth() auth: AuthContext) {
    return this.sessions.list(auth.userId, auth.sessionId);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest): Promise<void> {
    await this.account.revokeSession(auth, id, clientIp(req));
  }

  @Post('sessions/revoke-others')
  @HttpCode(200)
  async revokeOthers(@CurrentAuth() auth: AuthContext) {
    return { revoked: await this.sessions.revokeAllForUser(auth.userId, auth.sessionId) };
  }
}
