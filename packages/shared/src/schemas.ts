import { z } from 'zod';
import { isoDate } from './primitives';

/** Request/response contracts shared by the API (validation) and the web app (forms). */

export const LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'invalid_currency');

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createTenantSchema = z.object({
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/, 'invalid_slug'),
  legalName: z.string().trim().min(2).max(200),
  tradingName: z.string().trim().max(200).optional(),
  defaultLocale: z.enum(LOCALES).default('fr'),
  timezone: z.string().default('Africa/Douala'),
  defaultCurrency: currencyCode.default('XAF'),
  ownerEmail: z.string().trim().toLowerCase().pipe(z.email()),
  ownerName: z.string().trim().min(2).max(200),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const tenantStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  reason: z.string().trim().min(3).max(500),
});
export type TenantStatusInput = z.infer<typeof tenantStatusSchema>;

export const academicYearSchema = z
  .object({
    name: z.string().trim().min(4).max(50),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((v) => v.endDate > v.startDate, { message: 'end_before_start', path: ['endDate'] });
export type AcademicYearInput = z.infer<typeof academicYearSchema>;

/** Consistent API error envelope (spec §7.3). */
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
