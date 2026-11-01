import { z } from 'zod';

/**
 * SaaS subscriptions (Phase 6): plans, trial, billing cycles and the access rule.
 * A school whose subscription has lapsed keeps reading its data; it only loses the ability to change it
 * until it pays — records are never held hostage.
 */

export const TRIAL_DAYS = 30;
export const GRACE_DAYS = 7;
export const BILLING_CYCLES = ['MONTHLY', 'ANNUAL'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export interface PlanDefinition {
  code: string;
  nameFr: string;
  nameEn: string;
  descriptionFr: string;
  descriptionEn: string;
  monthlyPrice: string;
  annualPrice: string;
  maxStudents: number;
  maxCampuses: number;
  maxUsers: number;
  sortOrder: number;
}

/**
 * Starting catalogue, inserted once by the seed; the platform admin edits prices and limits afterwards.
 * PRICES ARE PLACEHOLDERS to be set by the business before go-live.
 */
export const DEFAULT_PLANS: readonly PlanDefinition[] = [
  {
    code: 'essentiel',
    nameFr: 'Essentiel',
    nameEn: 'Essential',
    descriptionFr: 'Petites écoles : élèves, présences, notes, bulletins et frais.',
    descriptionEn: 'Small schools: students, attendance, grades, report cards and fees.',
    monthlyPrice: '25000',
    annualPrice: '250000',
    maxStudents: 300,
    maxCampuses: 1,
    maxUsers: 30,
    sortOrder: 1,
  },
  {
    code: 'standard',
    nameFr: 'Standard',
    nameEn: 'Standard',
    descriptionFr: 'Écoles moyennes : tout Essentiel, plus RH, paie, Mobile Money et portails familles.',
    descriptionEn: 'Mid-size schools: everything in Essential, plus HR, payroll, Mobile Money and family portals.',
    monthlyPrice: '60000',
    annualPrice: '600000',
    maxStudents: 1000,
    maxCampuses: 2,
    maxUsers: 100,
    sortOrder: 2,
  },
  {
    code: 'premium',
    nameFr: 'Premium',
    nameEn: 'Premium',
    descriptionFr: 'Grands établissements et groupes scolaires multi-campus.',
    descriptionEn: 'Large schools and multi-campus groups.',
    monthlyPrice: '120000',
    annualPrice: '1200000',
    maxStudents: 3000,
    maxCampuses: 5,
    maxUsers: 300,
    sortOrder: 3,
  },
];

const amount = z.string().regex(/^\d{1,13}$/, 'invalid_amount');

export const planUpdateSchema = z.object({
  nameFr: z.string().trim().min(2).max(40),
  nameEn: z.string().trim().min(2).max(40),
  descriptionFr: z.string().trim().max(300).optional(),
  descriptionEn: z.string().trim().max(300).optional(),
  monthlyPrice: amount,
  annualPrice: amount,
  maxStudents: z.number().int().positive().max(100_000),
  maxCampuses: z.number().int().positive().max(100),
  maxUsers: z.number().int().positive().max(10_000),
  isPublic: z.boolean(),
  sortOrder: z.number().int().min(0).max(100),
});
export type PlanUpdateInput = z.infer<typeof planUpdateSchema>;

export const checkoutSchema = z.object({
  plan: z.string().trim().regex(/^[a-z0-9_-]{2,30}$/),
  cycle: z.enum(BILLING_CYCLES),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const invoicePaymentSchema = z.object({
  /** Bank or Mobile Money reference of the transfer received by the platform. */
  reference: z.string().trim().min(3).max(80),
});

export const signupSchema = z.object({
  schoolName: z.string().trim().min(3).max(120),
  city: z.string().trim().min(2).max(60),
  ownerName: z.string().trim().min(3).max(100),
  ownerEmail: z.email().trim().toLowerCase().max(160),
  phone: z.string().trim().regex(/^\+?\d{8,15}$/, 'invalid_phone'),
  password: z.string().min(10).max(256),
  plan: z.string().trim().regex(/^[a-z0-9_-]{2,30}$/),
  locale: z.enum(['fr', 'en']).default('fr'),
  acceptTerms: z.literal(true),
  /** Honeypot: humans never see this field; anything in it marks a bot. */
  website: z.string().max(0).optional().default(''),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const verifyEmailSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/) });
export const resendVerificationSchema = z.object({ email: z.email().trim().toLowerCase() });

export type SubscriptionState = 'OK' | 'TRIAL' | 'GRACE' | 'EXPIRED';

/**
 * Whether a school may change data now. No end date means no expiry (contracts managed outside
 * self-service and schools created before subscriptions existed).
 */
export function subscriptionAccess(
  sub: { status: 'TRIALING' | 'ACTIVE' | 'CANCELED'; trialEndsAt: Date | null; currentUntil: Date | null },
  now: Date,
): { state: SubscriptionState; writable: boolean; endsAt: Date | null; daysLeft: number | null } {
  const days = (d: Date) => Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
  if (sub.status === 'CANCELED') return { state: 'EXPIRED', writable: false, endsAt: sub.currentUntil, daysLeft: 0 };
  if (sub.status === 'TRIALING') {
    const end = sub.trialEndsAt!;
    return end > now ? { state: 'TRIAL', writable: true, endsAt: end, daysLeft: days(end) } : { state: 'EXPIRED', writable: false, endsAt: end, daysLeft: 0 };
  }
  if (!sub.currentUntil) return { state: 'OK', writable: true, endsAt: null, daysLeft: null };
  if (sub.currentUntil > now) return { state: 'OK', writable: true, endsAt: sub.currentUntil, daysLeft: days(sub.currentUntil) };
  const graceEnd = new Date(sub.currentUntil.getTime() + GRACE_DAYS * 86_400_000);
  return graceEnd > now
    ? { state: 'GRACE', writable: true, endsAt: graceEnd, daysLeft: days(graceEnd) }
    : { state: 'EXPIRED', writable: false, endsAt: graceEnd, daysLeft: 0 };
}

/** End of a billing period: same day next month or next year (clamped to the month's last day). */
export function addCycle(start: Date, cycle: BillingCycle): Date {
  const y = start.getUTCFullYear() + (cycle === 'ANNUAL' ? 1 : 0);
  const m = start.getUTCMonth() + (cycle === 'MONTHLY' ? 1 : 0);
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(start.getUTCDate(), lastDay)));
}
