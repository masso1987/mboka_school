import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { ApiException } from '../common/api-error';
import { Mailer } from '../common/mailer';
import { PrismaService } from '../prisma/prisma.service';
import { generateTemporaryPassword, hashPassword } from './password';
import { SessionService } from './session.service';

const RESET_HOURS = 1;
/** A reset decided by a platform administrator gives the person a day to act on it. */
const ADMIN_RESET_HOURS = 24;
const INVITE_DAYS = 7;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
type Locale = 'fr' | 'en';
const localeOf = (value: string | null | undefined): Locale => (value === 'en' ? 'en' : 'fr');

const text = {
  fr: {
    resetSubject: 'Réinitialisation de votre mot de passe — Mboka School',
    reset: (name: string, link: string, hours = RESET_HOURS) =>
      `Bonjour ${name},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable ${hours} heure${hours > 1 ? 's' : ''}, utilisable une seule fois) :\n\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.`,
    inviteSubject: (school: string) => `Invitation à rejoindre ${school} — Mboka School`,
    invite: (name: string, school: string, link: string) =>
      `Bonjour ${name},\n\nUn compte Mboka School a été créé pour vous par « ${school} ».\nChoisissez votre mot de passe pour l'activer (lien valable ${INVITE_DAYS} jours, utilisable une seule fois) :\n\n${link}\n\nSi le lien a expiré, utilisez « Mot de passe oublié » sur la page de connexion.`,
    addedSubject: (school: string) => `Nouvel accès : ${school} — Mboka School`,
    added: (school: string, link: string) =>
      `Bonjour,\n\nVotre compte Mboka School a maintenant accès à « ${school} ». Connectez-vous avec votre mot de passe habituel :\n\n${link}`,
  },
  en: {
    resetSubject: 'Reset your password — Mboka School',
    reset: (name: string, link: string, hours = RESET_HOURS) =>
      `Hello ${name},\n\nTo choose a new password, open this link (valid for ${hours} hour${hours > 1 ? 's' : ''}, single use):\n\n${link}\n\nIf you did not ask for this, ignore this message: your current password still works.`,
    inviteSubject: (school: string) => `Invitation to join ${school} — Mboka School`,
    invite: (name: string, school: string, link: string) =>
      `Hello ${name},\n\n"${school}" created a Mboka School account for you.\nChoose your password to activate it (link valid for ${INVITE_DAYS} days, single use):\n\n${link}\n\nIf the link has expired, use "Forgot password" on the sign-in page.`,
    addedSubject: (school: string) => `New access: ${school} — Mboka School`,
    added: (school: string, link: string) =>
      `Hello,\n\nYour Mboka School account now has access to "${school}". Sign in with your usual password:\n\n${link}`,
  },
};

/** What a new account is created with: an invitation link, or a one-time password when no mail can reach people. */
export interface NewAccountCredentials {
  data: { passwordHash?: string; passwordResetTokenHash?: string; passwordResetExpiresAt?: Date };
  token?: string;
  temporaryPassword?: string;
}

/**
 * Single-use e-mailed links that set a password (Phase 6): "forgot password" (1 hour) and invitations of
 * new accounts by a school (7 days). Only the link's SHA-256 is stored; issuing a new link replaces the old one.
 * Setting the password signs out every session; two-factor authentication still applies at the next sign-in.
 */
@Injectable()
export class PasswordLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly mailer: Mailer,
  ) {}

  private webUrl() {
    return (process.env.WEB_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
  }

  /**
   * Credentials for an account created by a school. Without real e-mail delivery (production without SMTP)
   * the school keeps handing over a one-time password, as before invitations existed.
   */
  async newAccount(): Promise<NewAccountCredentials> {
    if (!this.mailer.deliversRealMail) {
      const temporaryPassword = generateTemporaryPassword();
      return { data: { passwordHash: await hashPassword(temporaryPassword) }, temporaryPassword };
    }
    const token = randomBytes(32).toString('base64url');
    return { data: { passwordResetTokenHash: hash(token), passwordResetExpiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) }, token };
  }

  /** Sends the invitation of an account created with `newAccount()`, once its transaction has committed. */
  sendInvitation(to: string, name: string, school: string, locale: string | null | undefined, token: string) {
    const t = text[localeOf(locale)];
    return this.mailer.send({ to, subject: t.inviteSubject(school), text: t.invite(name, school, `${this.webUrl()}/accept-invitation#token=${token}`) });
  }

  /** Tells an existing account that it was given access to another school. */
  sendAddedNotice(to: string, school: string, locale: string | null | undefined) {
    const t = text[localeOf(locale)];
    return this.mailer.send({ to, subject: t.addedSubject(school), text: t.added(school, this.webUrl()) });
  }

  /**
   * A reset decided by a platform administrator: every session is signed out, then the person receives a
   * link to choose a new password (7 days), or — without mail delivery — a one-time password returned once.
   */
  async resetByAdmin(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const credentials = await this.newAccount();
    await this.prisma.user.update({
      where: { id: userId },
      data: credentials.token
        ? { ...credentials.data, passwordResetExpiresAt: new Date(Date.now() + ADMIN_RESET_HOURS * 3_600_000) }
        : { ...credentials.data, passwordChangedAt: new Date(), passwordResetTokenHash: null, passwordResetExpiresAt: null },
    });
    await this.sessions.revokeAllForUser(userId);
    if (credentials.token) {
      const t = text[localeOf(user.locale)];
      await this.mailer.send({ to: user.email, subject: t.resetSubject, text: t.reset(user.fullName, `${this.webUrl()}/reset-password#token=${credentials.token}`, ADMIN_RESET_HOURS) });
    }
    return { emailSent: Boolean(credentials.token), temporaryPassword: credentials.temporaryPassword };
  }

  /** Answers the same for any address, so accounts cannot be probed; inactive accounts get nothing. */
  async forgot(email: string, locale: Locale | undefined, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.isActive) {
      const token = randomBytes(32).toString('base64url');
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordResetTokenHash: hash(token), passwordResetExpiresAt: new Date(Date.now() + RESET_HOURS * 3_600_000) },
      });
      const t = text[localeOf(user.locale ?? locale)];
      await this.mailer.send({ to: email, subject: t.resetSubject, text: t.reset(user.fullName, `${this.webUrl()}/reset-password#token=${token}`) });
      await this.audit.record({ actorId: user.id, action: 'auth.password_reset_requested', ip });
    }
    return { status: 'reset_sent' as const };
  }

  /** Sets the password from a link, once. Opening the link also proves the e-mail address. */
  async reset(token: string, newPassword: string, ip?: string) {
    const invalid = () => new ApiException(HttpStatus.BAD_REQUEST, 'INVALID_RESET_LINK', 'This link is invalid, already used or expired');
    const tokenHash = hash(token);
    const user = await this.prisma.user.findFirst({ where: { passwordResetTokenHash: tokenHash } });
    if (!user || !user.isActive || !user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) throw invalid();
    // Conditional on the same token, so two concurrent uses of one link cannot both succeed.
    const { count } = await this.prisma.user.updateMany({
      where: { id: user.id, passwordResetTokenHash: tokenHash },
      data: {
        passwordHash: await hashPassword(newPassword),
        passwordChangedAt: new Date(),
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        emailVerificationRequired: false,
        emailVerifyTokenHash: null,
        emailVerifyExpiresAt: null,
      },
    });
    if (count === 0) throw invalid();
    const revoked = await this.sessions.revokeAllForUser(user.id);
    const accepted = user.passwordHash === null;
    await this.audit.record({ actorId: user.id, action: accepted ? 'auth.invitation_accepted' : 'auth.password_reset', ip, metadata: { sessionsRevoked: revoked } });
    return { status: 'password_set' as const };
  }
}
