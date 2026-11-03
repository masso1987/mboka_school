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

export const activeSchema = z.object({ active: z.boolean(), reason: z.string().trim().max(500).optional() });
export type ActiveInput = z.infer<typeof activeSchema>;
