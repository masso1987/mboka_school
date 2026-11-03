import { z } from 'zod';
import { LOCALES } from './schemas';

/** Platform console (Phase 7): what a super administrator can change about a school, its admins and the platform team. */

export const schoolUpdateSchema = z
  .object({
    legalName: z.string().trim().min(2).max(200),
    tradingName: z.string().trim().max(200).nullable(),
    defaultLocale: z.enum(LOCALES),
    defaultCurrency: z.string().regex(/^[A-Z]{3}$/, 'invalid_currency'),
    timezone: z.string().trim().min(3).max(60),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing_to_change' });
export type SchoolUpdateInput = z.infer<typeof schoolUpdateSchema>;

/** A school administrator (director) or a platform administrator to add. */
export const personInviteSchema = z.object({
  fullName: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().pipe(z.email()),
});
export type PersonInviteInput = z.infer<typeof personInviteSchema>;

const page = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
};
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Platform → Users & sessions: every account, searchable by name or e-mail, optionally one school's. */
export const platformUsersQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  tenantId: z.uuid().optional(),
  status: z.enum(['active', 'paused']).optional(),
  ...page,
});
export type PlatformUsersQuery = z.infer<typeof platformUsersQuerySchema>;

/** Platform → sign-in history. Dates are inclusive calendar days (UTC). */
export const loginHistoryQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  tenantId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  failuresOnly: z.enum(['true', 'false']).optional(),
  format: z.enum(['json', 'csv']).default('json'),
  ...page,
});
export type LoginHistoryQuery = z.infer<typeof loginHistoryQuerySchema>;

/** Platform → audit log: every recorded action, of every school and of the platform itself. */
export const auditQuerySchema = z.object({
  tenantId: z.uuid().optional(),
  /** Actor's e-mail, or part of it. */
  actor: z.string().trim().max(100).optional(),
  /** Action prefix, e.g. "platform." or "payment.". */
  action: z.string().trim().max(60).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  format: z.enum(['json', 'csv']).default('json'),
  ...page,
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const activeSchema =z.object({ active: z.boolean(), reason: z.string().trim().max(500).optional() });
export type ActiveInput = z.infer<typeof activeSchema>;
