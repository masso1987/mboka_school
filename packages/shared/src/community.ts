import { z } from 'zod';
import { EMPLOYMENT_TYPES } from './people';
import { isoDate, optionalText } from './primitives';
import { currencyCode, money } from './finance';

// ---------------------------------------------------------------- HR (Module 11)

export const LEAVE_TYPES = ['ANNUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'UNPAID', 'OTHER'] as const;

export const contractSchema = z
  .object({
    staffId: z.uuid(),
    type: z.enum(EMPLOYMENT_TYPES),
    position: z.string().trim().min(2).max(100),
    startDate: isoDate,
    endDate: isoDate.optional(),
    notes: optionalText(500),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { message: 'end_before_start', path: ['endDate'] });
export type ContractInput = z.infer<typeof contractSchema>;

export const compensationSchema = z.object({
  staffId: z.uuid(),
  effectiveFrom: isoDate,
  currency: currencyCode,
  baseSalary: money,
  allowances: z.array(z.object({ label: z.string().trim().min(1).max(60), amount: money })).max(10).default([]),
});
export type CompensationInput = z.infer<typeof compensationSchema>;

export const leaveRequestSchema = z
  .object({
    /** Omitted: the request is for the signed-in staff member. HR may file for others. */
    staffId: z.uuid().optional(),
    type: z.enum(LEAVE_TYPES),
    startDate: isoDate,
    endDate: isoDate,
    reason: optionalText(500),
  })
  .refine((v) => v.endDate >= v.startDate, { message: 'end_before_start', path: ['endDate'] });
export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>;

export const leaveDecisionSchema = z.object({ approve: z.boolean(), note: optionalText(500) });
export type LeaveDecisionInput = z.infer<typeof leaveDecisionSchema>;

export const entitlementSchema = z.object({ staffId: z.uuid(), year: z.number().int().min(2000).max(2100), days: z.number().int().min(0).max(366) });
export type EntitlementInput = z.infer<typeof entitlementSchema>;

/** Monday–Friday days between two dates, inclusive. */
export function workingDays(start: string, end: string): number {
  let n = 0;
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (d <= last) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) n++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return n;
}

// ---------------------------------------------------------------- communication (Module 12)

export const AUDIENCES = ['ALL', 'STAFF', 'GUARDIANS', 'STUDENTS', 'CLASS'] as const;

export const announcementSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    body: z.string().trim().min(3).max(4000),
    audience: z.enum(AUDIENCES),
    classId: z.uuid().optional(),
    expiresAt: isoDate.optional(),
  })
  .refine((v) => (v.audience === 'CLASS') === Boolean(v.classId), { message: 'class_required_for_class_audience', path: ['classId'] });
export type AnnouncementInput = z.infer<typeof announcementSchema>;

/** Grants a guardian or a student their own portal account. */
export const portalAccessSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  fullName: z.string().trim().min(2).max(200).optional(),
});
export type PortalAccessInput = z.infer<typeof portalAccessSchema>;
