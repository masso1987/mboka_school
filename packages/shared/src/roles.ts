import { PERMISSION_KEYS, type PermissionKey } from './permissions';

/**
 * Default tenant roles (spec §3.1), copied into every new tenant at provisioning.
 * Schools may edit or extend them afterwards; these are templates, not hard-coded rules.
 * Platform-level roles (super administrator, support agent) are not tenant roles —
 * they live on the user record and grant no access to school data by themselves.
 */
export interface RoleTemplate {
  key: string;
  name: { fr: string; en: string };
  permissions: readonly PermissionKey[];
}

const read: PermissionKey[] = ['academics.years.read', 'students.read', 'attendance.read', 'timetable.read'];

export const DEFAULT_ROLES: readonly RoleTemplate[] = [
  {
    key: 'director',
    name: { fr: 'Fondateur / Directeur', en: 'School Owner / Director' },
    // Everything except the portal permissions, which only make sense for families.
    permissions: PERMISSION_KEYS.filter((p) => !p.startsWith('portal.')),
  },
  {
    key: 'principal',
    name: { fr: 'Directeur des études', en: 'Principal / Academic Director' },
    permissions: [
      ...read,
      'academics.years.manage',
      'academics.years.close',
      'academics.structure.manage',
      'academics.assignments.manage',
      'grades.approve',
      'grades.reopen',
      'reportcards.publish',
      'attendance.correct',
      'timetable.manage',
      'hr.staff.read',
      'hr.leave.request',
      'announcements.publish',
    ],
  },
  {
    key: 'registrar',
    name: { fr: 'Secrétaire / Registraire', en: 'Registrar / School Secretary' },
    permissions: [...read, 'students.create', 'students.update', 'students.archive', 'admissions.manage', 'enrollments.manage', 'hr.leave.request'],
  },
  {
    key: 'teacher',
    name: { fr: 'Enseignant', en: 'Teacher' },
    permissions: ['academics.years.read', 'timetable.read', 'attendance.record', 'grades.enter', 'grades.submit', 'hr.leave.request'],
  },
  {
    key: 'chief_accountant',
    name: { fr: 'Chef comptable', en: 'Chief Accountant' },
    permissions: [
      'academics.years.read',
      'students.read',
      'finance.settings.manage',
      'finance.periods.close',
      'fees.invoice.read',
      'fees.invoice.create',
      'fees.adjust',
      'payments.record',
      'payments.reverse',
      'payments.refund.approve',
      'expenses.create',
      'expenses.approve',
      'budgets.manage',
      'reports.financial.read',
      'hr.leave.request',
    ],
  },
  {
    key: 'cashier',
    name: { fr: 'Caissier', en: 'Cashier' },
    permissions: ['students.read', 'fees.invoice.read', 'payments.record', 'hr.leave.request'],
  },
  {
    key: 'hr_manager',
    name: { fr: 'Responsable RH', en: 'HR Manager' },
    permissions: ['hr.staff.read', 'hr.staff.manage', 'hr.compensation.read', 'hr.compensation.manage', 'hr.leave.request', 'hr.leave.approve'],
  },
  {
    key: 'hr_officer',
    name: { fr: 'Agent RH', en: 'HR Officer' },
    permissions: ['hr.staff.read', 'hr.leave.request'],
  },
  {
    key: 'auditor',
    name: { fr: 'Auditeur', en: 'Auditor' },
    permissions: ['audit.read', 'reports.financial.read', 'fees.invoice.read', 'academics.years.read'],
  },
  {
    key: 'parent',
    name: { fr: 'Parent / tuteur', en: 'Parent / guardian' },
    permissions: ['portal.parent'],
  },
  {
    key: 'student',
    name: { fr: 'Élève', en: 'Student' },
    permissions: ['portal.student'],
  },
];
