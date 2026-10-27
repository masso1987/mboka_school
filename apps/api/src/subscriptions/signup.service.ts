import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { TRIAL_DAYS, type SignupInput } from '@mboka/shared';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { ApiException } from '../common/api-error';
import { Mailer } from '../common/mailer';
import { PrismaService } from '../prisma/prisma.service';
import { provisionTenant } from '../tenants/provision';

const TOKEN_HOURS = 48;
const RESERVED = new Set(['admin', 'api', 'app', 'www', 'demo', 'platform', 'staff', 'support', 'mail', 'signup', 'login']);
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** "Collège Bilingue Saint-Éloi" → "college-bilingue-saint-eloi". */
export function slugify(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return s.length >= 3 ? s : `ecole-${s || 'mboka'}`;
}

const text = {
  fr: {
    verifySubject: 'Confirmez votre adresse — Mboka School',
    verify: (name: string, school: string, link: string) =>
      `Bonjour ${name},\n\nVotre école « ${school} » est créée, avec ${TRIAL_DAYS} jours d'essai gratuit.\nConfirmez votre adresse pour vous connecter (lien valable ${TOKEN_HOURS} heures) :\n\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
    existsSubject: 'Vous avez déjà un compte — Mboka School',
    exists: (link: string) =>
      `Bonjour,\n\nUne inscription a été demandée avec cette adresse, qui a déjà un compte Mboka School. Connectez-vous ici :\n\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
  },
  en: {
    verifySubject: 'Confirm your address — Mboka School',
    verify: (name: string, school: string, link: string) =>
      `Hello ${name},\n\nYour school "${school}" is ready, with a ${TRIAL_DAYS}-day free trial.\nConfirm your address to sign in (link valid for ${TOKEN_HOURS} hours):\n\n${link}\n\nIf you did not ask for this, ignore this message.`,
    existsSubject: 'You already have an account — Mboka School',
    exists: (link: string) =>
      `Hello,\n\nSomeone asked to sign up with this address, which already has a Mboka School account. Sign in here:\n\n${link}\n\nIf you did not ask for this, ignore this message.`,
  },
};

/**
 * Self-service school sign-up (Phase 6). Answers identically whether or not the e-mail already has an
 * account, so addresses cannot be probed; the owner signs in only after confirming the address.
 */
@Injectable()
export class SignupService {
  private readonly logger = new Logger('Signup');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mailer: Mailer,
  ) {}

  private webUrl() {
    return (process.env.WEB_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
  }

  private assertAvailable() {
    if (process.env.SIGNUP_ENABLED === 'false' || !this.mailer.deliversRealMail) {
      throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'SIGNUP_UNAVAILABLE', 'Self-service sign-up is not available; contact us');
    }
  }

  private async uniqueSlug(base: string): Promise<string> {
    for (let i = 1; i < 50; i++) {
      const candidate = i === 1 ? base : `${base.slice(0, 36)}-${i}`;
      if (RESERVED.has(candidate)) continue;
      if (!(await this.prisma.tenant.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate;
    }
    return `${base.slice(0, 30)}-${randomBytes(3).toString('hex')}`;
  }

  async signup(input: SignupInput, ip?: string) {
    this.assertAvailable();
    const plan = await this.prisma.plan.findUnique({ where: { code: input.plan } });
    if (!plan || !plan.isPublic) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'UNKNOWN_PLAN', 'Choose one of the offered plans');
    const t = text[input.locale];

    const existing = await this.prisma.user.findUnique({ where: { email: input.ownerEmail }, select: { id: true } });
    if (existing) {
      await this.mailer.send({ to: input.ownerEmail, subject: t.existsSubject, text: t.exists(this.webUrl()) });
      await this.audit.record({ actorId: existing.id, action: 'signup.existing_email', ip });
      return { status: 'verification_sent' as const };
    }

    const token = randomBytes(32).toString('base64url');
    const tenantId = randomUUID();
    const slug = await this.uniqueSlug(slugify(input.schoolName));
    try {
      await this.prisma.scoped({ tenantId }, async (tx) => {
        const { ownerUserId } = await provisionTenant(
          tx,
          tenantId,
          {
            slug,
            legalName: input.schoolName,
            ownerEmail: input.ownerEmail,
            ownerName: input.ownerName,
            defaultLocale: input.locale,
            timezone: 'Africa/Douala',
            defaultCurrency: 'XAF',
          },
          input.password,
        );
        await tx.tenant.update({ where: { id: tenantId }, data: { settings: { city: input.city, phone: input.phone, signup: true } } });
        await tx.subscription.update({
          where: { tenantId },
          data: {
            plan: plan.code,
            status: 'TRIALING',
            trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
            maxStudents: plan.maxStudents,
            maxCampuses: plan.maxCampuses,
            maxUsers: plan.maxUsers,
          },
        });
        await tx.user.update({
          where: { id: ownerUserId },
          data: {
            emailVerificationRequired: true,
            emailVerifyTokenHash: hash(token),
            emailVerifyExpiresAt: new Date(Date.now() + TOKEN_HOURS * 3_600_000),
            locale: input.locale,
          },
        });
        await this.audit.record({ tenantId, actorId: ownerUserId, action: 'tenant.signup', entityType: 'tenant', entityId: tenantId, metadata: { slug, plan: plan.code }, ip }, tx);
      });
    } catch (e) {
      // Two sign-ups raced for the same e-mail or slug: answer like any other request.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { status: 'verification_sent' as const };
      throw e;
    }
    await this.mailer.send({ to: input.ownerEmail, subject: t.verifySubject, text: t.verify(input.ownerName, input.schoolName, `${this.webUrl()}/verify-email#token=${token}`) });
    return { status: 'verification_sent' as const };
  }

  async verify(token: string, ip?: string) {
    const user = await this.prisma.user.findFirst({ where: { emailVerifyTokenHash: hash(token) } });
    if (!user || !user.emailVerifyExpiresAt || user.emailVerifyExpiresAt < new Date()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, 'INVALID_VERIFICATION_LINK', 'This link is invalid or has expired');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { emailVerificationRequired: false, emailVerifyTokenHash: null, emailVerifyExpiresAt: null } });
    await this.audit.record({ actorId: user.id, action: 'signup.email_verified', ip });
    return { verified: true };
  }

  /** Sends a fresh link to an unconfirmed account; answers the same for any address. */
  async resend(email: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.emailVerificationRequired) {
      const token = randomBytes(32).toString('base64url');
      await this.prisma.user.update({ where: { id: user.id }, data: { emailVerifyTokenHash: hash(token), emailVerifyExpiresAt: new Date(Date.now() + TOKEN_HOURS * 3_600_000) } });
      const t = text[user.locale === 'en' ? 'en' : 'fr'];
      // Memberships are visible to their own user under RLS.
      const membership = await this.prisma.scoped({ userId: user.id }, (tx) =>
        tx.membership.findFirst({ where: { userId: user.id }, select: { tenant: { select: { legalName: true } } } }),
      );
      await this.mailer.send({ to: email, subject: t.verifySubject, text: t.verify(user.fullName, membership?.tenant.legalName ?? 'Mboka', `${this.webUrl()}/verify-email#token=${token}`) });
      await this.audit.record({ actorId: user.id, action: 'signup.verification_resent', ip });
    }
    return { status: 'verification_sent' as const };
  }
}
