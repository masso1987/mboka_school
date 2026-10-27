/**
 * Permission catalogue. Keys follow `module.resource.action` (spec §3.2).
 * The API seeds this catalogue into the `permissions` table; roles reference it by key.
 * Adding a permission here is the only way to introduce one — never invent keys ad hoc.
 */
export const PERMISSIONS = {
  // Administration
  'tenant.settings.read': 'View school configuration',
  'tenant.settings.update': 'Change school configuration',
  'tenant.campuses.manage': 'Create and edit campuses',
  'tenant.data.export': 'Export all school data (portability, end of contract)',
  'users.read': 'View user accounts',
  'users.invite': 'Invite users to the school',
  'users.permissions.manage': 'Assign roles and permissions',
  'audit.read': 'Read audit logs',

  // Academics
  'academics.years.read': 'View academic years and periods',
  'academics.years.manage': 'Create and edit academic years and periods',
  'academics.years.close': 'Close an academic year',
  'academics.structure.manage': 'Manage levels, programs, classes and subjects',
  'academics.assignments.manage': 'Assign teachers to classes and subjects',

  // Students
  'students.read': 'View student records',
  'students.create': 'Create student records',
  'students.update': 'Edit student records',
  'students.archive': 'Archive student records',
  'admissions.manage': 'Process admission applications',
  'enrollments.manage': 'Enroll, transfer and withdraw students',

  // Attendance
  'attendance.record': 'Record attendance for assigned classes',
  'attendance.correct': 'Correct recorded attendance',
  'attendance.read': 'View attendance',

  // Timetable
  'timetable.read': 'View timetables',
  'timetable.manage': 'Manage rooms and timetables',

  // Grades
  'grades.enter': 'Enter marks for assigned subjects',
  'grades.submit': 'Submit marks for review',
  'grades.approve': 'Approve submitted marks',
  'grades.reopen': 'Reopen approved marks',
  'reportcards.publish': 'Publish report cards',

  // Finance
  'finance.settings.manage': 'Configure currencies, exchange rates and payment providers',
  'finance.periods.close': 'Open and close financial periods',
  'fees.invoice.read': 'View invoices and balances',
  'fees.invoice.create': 'Create invoices and fee schedules',
  'fees.adjust': 'Grant discounts, scholarships and waivers; cancel invoices',
  'payments.record': 'Record payments and run a cash register',
  'payments.reverse': 'Reverse payments',
  'payments.refund.approve': 'Approve refunds requested by others',
  'expenses.create': 'Record expenses',
  'expenses.approve': 'Approve expenses up to the threshold',
  'expenses.approve.unlimited': 'Approve expenses above the threshold',
  'budgets.manage': 'Create and edit budgets',
  'reports.financial.read': 'View financial reports',

  // HR
  'hr.staff.read': 'View staff records',
  'hr.staff.manage': 'Manage staff records and contracts',
  'hr.compensation.read': 'View compensation data',
  'hr.compensation.manage': 'Record compensation changes',
  'hr.leave.request': 'Request leave for oneself',
  'hr.leave.approve': 'Approve or reject leave requests',

  // Communication
  'announcements.publish': 'Publish announcements',

  // Portals
  'portal.parent': 'Parent portal: see linked children only',
  'portal.student': 'Student portal: see own records only',
} as const satisfies Record<string, string>;

export type PermissionKey = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

/** True when every required permission is held. */
export function hasAllPermissions(
  held: ReadonlySet<string> | readonly string[],
  required: readonly PermissionKey[],
): boolean {
  const set = held instanceof Set ? held : new Set(held);
  return required.every((p) => set.has(p));
}
