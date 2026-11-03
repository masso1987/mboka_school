import type { PermissionKey } from '@mboka/shared';

export interface NavItem {
  key: string;
  path: string;
  /** Any one of these grants visibility; empty means every member sees it. */
  anyOf: PermissionKey[];
  /** Menu section (`nav.groups.<group>`), by what people do rather than by module. */
  group: string;
  /** Delivery phase (spec §14) for modules not built yet. */
  phase?: number;
}

/** Navigation structure from spec §8.2, filtered by permission at render time; items stay in their group's order. */
export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', path: '/', anyOf: [], group: 'home' },
  { key: 'portal', path: '/portal', anyOf: ['portal.parent', 'portal.student'], group: 'home' },
  { key: 'students', path: '/students', anyOf: ['students.read', 'admissions.manage'], group: 'schoolLife' },
  { key: 'attendance', path: '/attendance', anyOf: ['attendance.record', 'attendance.read', 'attendance.correct'], group: 'schoolLife' },
  { key: 'community', path: '/community', anyOf: [], group: 'schoolLife' },
  { key: 'classes', path: '/classes', anyOf: ['academics.structure.manage', 'academics.years.read'], group: 'teaching' },
  { key: 'teaching', path: '/teaching', anyOf: ['timetable.read', 'academics.assignments.manage'], group: 'teaching' },
  { key: 'grades', path: '/grades', anyOf: ['grades.enter', 'grades.approve'], group: 'teaching' },
  { key: 'reportCards', path: '/report-cards', anyOf: ['reportcards.publish', 'grades.approve'], group: 'teaching' },
  { key: 'academicYears', path: '/academic-years', anyOf: ['academics.years.read'], group: 'teaching' },
  { key: 'fees', path: '/fees', anyOf: ['fees.invoice.read', 'payments.record'], group: 'money' },
  { key: 'expenses', path: '/expenses', anyOf: ['expenses.create', 'expenses.approve', 'expenses.approve.unlimited', 'budgets.manage'], group: 'money' },
  { key: 'reports', path: '/reports', anyOf: ['reports.financial.read'], group: 'money' },
  { key: 'hr', path: '/hr', anyOf: ['hr.staff.read', 'hr.leave.request', 'hr.leave.approve', 'hr.payroll.manage', 'hr.payroll.approve'], group: 'staff' },
  { key: 'administration', path: '/administration', anyOf: ['tenant.settings.read', 'users.read'], group: 'admin' },
  { key: 'resources', path: '/resources', anyOf: ['tenant.settings.update'], group: 'admin', phase: 6 },
];

/** Platform console menu (Phase 7), shown to super administrators when no school is selected. */
export const PLATFORM_NAV_ITEMS: NavItem[] = [
  { key: 'platformHome', path: '/platform', anyOf: [], group: 'home' },
  { key: 'platformSchools', path: '/platform/schools', anyOf: [], group: 'platformSchools' },
  { key: 'platformDemos', path: '/platform/demos', anyOf: [], group: 'platformSchools' },
  { key: 'platformBilling', path: '/platform/billing', anyOf: [], group: 'platformSchools' },
  { key: 'platformUsers', path: '/platform/users', anyOf: [], group: 'platformPeople' },
  { key: 'platformLogins', path: '/platform/logins', anyOf: [], group: 'platformPeople' },
  { key: 'platformAudit', path: '/platform/audit', anyOf: [], group: 'platformPeople' },
  { key: 'platformAdmins', path: '/platform/admins', anyOf: [], group: 'platformPeople' },
  { key: 'platformMessages', path: '/platform/messages', anyOf: [], group: 'platformCommunication' },
  { key: 'platformLegal', path: '/platform/legal', anyOf: [], group: 'platformCommunication' },
  { key: 'platformMaintenance', path: '/platform/maintenance', anyOf: [], group: 'platformOperations' },
  { key: 'platformSettings', path: '/platform/settings', anyOf: [], group: 'platformOperations' },
  { key: 'platformSystem', path: '/platform/system', anyOf: [], group: 'platformOperations' },
  { key: 'platformBackups', path: '/platform/backups', anyOf: [], group: 'platformOperations' },
];

export function visibleNavItems(can: (p: string) => boolean, items: NavItem[] = NAV_ITEMS): NavItem[] {
  return items.filter((i) => i.anyOf.length === 0 || i.anyOf.some(can));
}

/** Consecutive items of the same group, for a menu drawn in sections. */
export function groupNavItems(items: NavItem[]): { group: string; items: NavItem[] }[] {
  const out: { group: string; items: NavItem[] }[] = [];
  for (const item of items) {
    const last = out.at(-1);
    if (last?.group === item.group) last.items.push(item);
    else out.push({ group: item.group, items: [item] });
  }
  return out;
}

/** Up to three initials for a school's stamp: "Collège Bilingue de la Réunification" → "CBR". */
export function schoolInitials(name: string): string {
  const small = new Set(['de', 'du', 'des', 'la', 'le', 'les', "l'", 'et', 'of', 'the', 'and', 'd']);
  // Letters only: "Directeur (démo)" gives "DD", never "D(".
  const words = name
    .split(/[\s'’-]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w && !small.has(w.toLowerCase()));
  return (words.length > 1 ? words.map((w) => w[0]) : [...(words[0] ?? 'MS').slice(0, 2)]).slice(0, 3).join('').toUpperCase();
}
