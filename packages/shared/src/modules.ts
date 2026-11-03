import { z } from 'zod';

/**
 * Licensed modules (Phase 7). Each module owns the permissions starting with one of its prefixes; a school whose
 * licence leaves a module off loses those permissions, so its API routes answer 403 and its screens leave the menu.
 * Permissions no module owns (academic structure, school settings, users, audit) are the core: always on.
 */
export const MODULES = [
  { key: 'students', prefixes: ['students.', 'admissions.', 'enrollments.'] },
  { key: 'timetable', prefixes: ['timetable.', 'academics.assignments.'] },
  { key: 'attendance', prefixes: ['attendance.'] },
  { key: 'grades', prefixes: ['grades.', 'reportcards.'] },
  { key: 'finance', prefixes: ['fees.', 'payments.', 'finance.', 'reports.financial.'] },
  { key: 'expenses', prefixes: ['expenses.', 'budgets.'] },
  { key: 'hr', prefixes: ['hr.staff.', 'hr.leave.', 'hr.compensation.'] },
  { key: 'payroll', prefixes: ['hr.payroll.'] },
  { key: 'communication', prefixes: ['announcements.'] },
  { key: 'portals', prefixes: ['portal.'] },
] as const;

export type ModuleKey = (typeof MODULES)[number]['key'];
export const MODULE_KEYS = MODULES.map((m) => m.key) as [ModuleKey, ...ModuleKey[]];

/** The module that owns a permission, or null for a core permission. The longest matching prefix wins. */
export function moduleOfPermission(permission: string): ModuleKey | null {
  let best: { key: ModuleKey; length: number } | null = null;
  for (const m of MODULES) {
    for (const p of m.prefixes) {
      if (permission.startsWith(p) && (!best || p.length > best.length)) best = { key: m.key, length: p.length };
    }
  }
  return best?.key ?? null;
}

/** A licence's module list: empty means every module (schools created before licences keep everything). */
export function isModuleEnabled(enabled: readonly string[], key: ModuleKey): boolean {
  return enabled.length === 0 || enabled.includes(key);
}

/** The permissions a person keeps once the school's licence is applied. */
export function licensedPermissions(permissions: Iterable<string>, enabled: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const p of permissions) {
    const m = moduleOfPermission(p);
    if (!m || isModuleEnabled(enabled, m)) out.add(p);
  }
  return out;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** A school's licence as set by the platform: plan, limits, modules and validity. */
export const licenceSchema = z.object({
  plan: z.string().trim().regex(/^[a-z0-9_-]{2,30}$/),
  status: z.enum(['TRIALING', 'ACTIVE', 'CANCELED']),
  maxStudents: z.number().int().min(1).max(1_000_000),
  maxCampuses: z.number().int().min(1).max(1000),
  maxUsers: z.number().int().min(1).max(100_000),
  /** null: every module. */
  modules: z.array(z.enum(MODULE_KEYS)).min(1).nullable(),
  trialEndsAt: isoDate.nullable(),
  /** Paid up to this day included; null on an ACTIVE licence means no expiry (contract outside self-service). */
  currentUntil: isoDate.nullable(),
  notes: z.string().trim().max(2000).nullable(),
});
export type LicenceInput = z.infer<typeof licenceSchema>;

/** Optional price of a module, added to the plan price (indicative until invoices itemise modules). */
export const modulePriceSchema = z.object({
  monthlyPrice: z.string().regex(/^\d{1,12}$/),
  annualPrice: z.string().regex(/^\d{1,12}$/),
});
export type ModulePriceInput = z.infer<typeof modulePriceSchema>;
