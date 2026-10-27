import type { PermissionKey } from '@mboka/shared';

export interface NavItem {
  key: string;
  path: string;
  /** Any one of these grants visibility; empty means every member sees it. */
  anyOf: PermissionKey[];
  /** Delivery phase (spec §14) for modules not built yet. */
  phase?: number;
}

/** Navigation structure from spec §8.2, filtered by permission at render time. */
export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', path: '/', anyOf: [] },
  { key: 'academicYears', path: '/academic-years', anyOf: ['academics.years.read'] },
  { key: 'students', path: '/students', anyOf: ['students.read', 'admissions.manage'] },
  { key: 'classes', path: '/classes', anyOf: ['academics.structure.manage', 'academics.years.read'] },
  { key: 'teaching', path: '/teaching', anyOf: ['timetable.read', 'academics.assignments.manage'] },
  { key: 'attendance', path: '/attendance', anyOf: ['attendance.record', 'attendance.read', 'attendance.correct'] },
  { key: 'grades', path: '/grades', anyOf: ['grades.enter', 'grades.approve'], phase: 2 },
  { key: 'reportCards', path: '/report-cards', anyOf: ['reportcards.publish', 'grades.approve'], phase: 2 },
  { key: 'fees', path: '/fees', anyOf: ['fees.invoice.read', 'payments.record'], phase: 3 },
  { key: 'expenses', path: '/expenses', anyOf: ['expenses.create', 'expenses.approve'], phase: 3 },
  { key: 'hr', path: '/hr', anyOf: ['hr.staff.read'] },
  { key: 'community', path: '/community', anyOf: ['announcements.publish'], phase: 4 },
  { key: 'reports', path: '/reports', anyOf: ['reports.financial.read', 'audit.read'], phase: 4 },
  { key: 'resources', path: '/resources', anyOf: ['tenant.settings.update'], phase: 6 },
  { key: 'administration', path: '/administration', anyOf: ['tenant.settings.read', 'users.read'] },
];

export function visibleNavItems(can: (p: string) => boolean, items: NavItem[] = NAV_ITEMS): NavItem[] {
  return items.filter((i) => i.anyOf.length === 0 || i.anyOf.some(can));
}
