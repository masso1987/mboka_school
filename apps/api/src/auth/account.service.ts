import { HttpStatus, Injectable } from '@nestjs/common';
import type { MfaDisableInput, PasswordChangeInput } from '@mboka/shared';
import { AuditService } from '../audit/audit.service';
import { ApiException, Errors } from '../common/api-error';
import type { AuthContext } from '../common/request-context';
import { decryptSecret, encryptSecret } from '../common/secrets';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, verifyPassword } from './password';
import { SessionService } from './session.service';
import { generateRecoveryCodes, generateSecret, hashRecoveryCode, otpauthUrl, verifyTotp } from './totp';

const invalidCode = () => new ApiException(HttpStatus.UNAUTHORIZED, 'INVALID_MFA_CODE', 'Invalid or already used code');

/** Two-factor authentication, password change and session management (spec §11.1). */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /** Starts enrollment: a new secret is kept pending until a valid code confirms it. */
  async setup(auth: AuthContext) {
    if (auth.mfaEnabled) throw Errors.conflict('MFA_ALREADY_ENABLED', 'Two-factor authentication is already on');
    const secret = generateSecret();
    await this.prisma.user.update({ where: { id: auth.userId }, data: { mfaPendingSecret: encryptSecret(secret) } });
    return { secret, otpauthUrl: otpauthUrl(secret, auth.email) };
  }

  /** Confirms enrollment with a first code; returns single-use recovery codes, shown once. */
  async enable(auth: AuthContext, code: string, ip?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (user.mfaEnabledAt) throw Errors.conflict('MFA_ALREADY_ENABLED', 'Two-factor authentication is already on');
    if (!user.mfaPendingSecret) throw Errors.conflict('MFA_NOT_STARTED', 'Start the setup first');
    const secret = decryptSecret(user.mfaPendingSecret);
    const step = verifyTotp(secret, code);
    if (step === null) throw invalidCode();
    const recovery = generateRecoveryCodes();
    await this.prisma.user.update({
      where: { id: auth.userId },
      data: { mfaSecret: user.mfaPendingSecret, mfaPendingSecret: null, mfaEnabledAt: new Date(), mfaRecoveryCodes: recovery.hashed, mfaLastStep: step },
    });
    // Other sessions were opened without the second factor: close them.
    await this.sessions.revokeAllForUser(auth.userId, auth.sessionId);
    await this.audit.record({ action: 'auth.mfa_enabled', actorId: auth.userId, ip });
    return { recoveryCodes: recovery.plain };
  }

  /** Second login step: an authenticator code (never the same step twice) or a recovery code (single use). */
  async verify(auth: AuthContext, code: string, ip?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!user.mfaSecret) throw Errors.conflict('MFA_NOT_ENABLED', 'Two-factor authentication is off');
    const step = verifyTotp(decryptSecret(user.mfaSecret), code);
    if (step !== null) {
      if (user.mfaLastStep !== null && step <= user.mfaLastStep) {
        await this.audit.record({ action: 'auth.mfa_replay_rejected', actorId: user.id, ip });
        throw invalidCode();
      }
      await this.prisma.user.update({ where: { id: user.id }, data: { mfaLastStep: step } });
    } else {
      const hashed = hashRecoveryCode(code);
      if (!user.mfaRecoveryCodes.includes(hashed)) {
        await this.audit.record({ action: 'auth.mfa_failed', actorId: user.id, ip });
        throw invalidCode();
      }
      await this.prisma.user.update({ where: { id: user.id }, data: { mfaRecoveryCodes: user.mfaRecoveryCodes.filter((h) => h !== hashed) } });
      await this.audit.record({ action: 'auth.mfa_recovery_code_used', actorId: user.id, ip, metadata: { remaining: user.mfaRecoveryCodes.length - 1 } });
    }
    await this.sessions.markMfaVerified(auth.sessionId);
    await this.audit.record({ action: 'auth.login.succeeded', actorId: user.id, ip, metadata: { mfa: true } });
    return { verified: true };
  }

  /** Platform administrators can never turn MFA off; others need their password and a current code. */
  async disable(auth: AuthContext, input: MfaDisableInput, ip?: string) {
    if (auth.platformRole === 'SUPER_ADMIN') throw Errors.forbidden('Platform administrators must keep two-factor authentication');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!user.mfaSecret) throw Errors.conflict('MFA_NOT_ENABLED', 'Two-factor authentication is off');
    if (!user.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) throw Errors.invalidCredentials();
    if (verifyTotp(decryptSecret(user.mfaSecret), input.code) === null) throw invalidCode();
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaSecret: null, mfaEnabledAt: null, mfaRecoveryCodes: [], mfaLastStep: null } });
    await this.audit.record({ action: 'auth.mfa_disabled', actorId: user.id, ip });
    return { enabled: false };
  }

  /** Changing the password signs out every other session (§11.1 session revocation). */
  async changePassword(auth: AuthContext, input: PasswordChangeInput, ip?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!user.passwordHash || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
      await this.audit.record({ action: 'auth.password_change_failed', actorId: user.id, ip });
      throw Errors.invalidCredentials();
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.newPassword), passwordChangedAt: new Date() } });
    const revoked = await this.sessions.revokeAllForUser(user.id, auth.sessionId);
    await this.audit.record({ action: 'auth.password_changed', actorId: user.id, ip, metadata: { otherSessionsRevoked: revoked } });
    return { otherSessionsRevoked: revoked };
  }

  async revokeSession(auth: AuthContext, sessionId: string, ip?: string) {
    const s = await this.prisma.session.findFirst({ where: { id: sessionId, userId: auth.userId } });
    if (!s) throw Errors.notFound('Session');
    await this.sessions.revoke(sessionId);
    await this.audit.record({ action: 'auth.session_revoked', actorId: auth.userId, ip, metadata: { sessionId } });
  }

  async status(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { mfaEnabledAt: true, mfaRecoveryCodes: true, passwordChangedAt: true } });
    return { mfaEnabled: u.mfaEnabledAt !== null, recoveryCodesLeft: u.mfaRecoveryCodes.length, passwordChangedAt: u.passwordChangedAt?.toISOString() ?? null };
  }
}
