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
    permissions: PERMISSION_KEYS,
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
      'announcements.publish',
    ],
  },
  {
    key: 'registrar',
    name: { fr: 'Secrétaire / Registraire', en: 'Registrar / School Secretary' },
    permissions: [...read, 'students.create', 'students.update', 'students.archive', 'admissions.manage', 'enrollments.manage'],
  },
  {
    key: 'teacher',
    name: { fr: 'Enseignant', en: 'Teacher' },
    permissions: ['academics.years.read', 'timetable.read', 'attendance.record', 'grades.enter', 'grades.submit'],
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
    ],
  },
  {
    key: 'cashier',
    name: { fr: 'Caissier', en: 'Cashier' },
    permissions: ['students.read', 'fees.invoice.read', 'payments.record'],
  },
  {
    key: 'hr_manager',
    name: { fr: 'Responsable RH', en: 'HR Manager' },
    permissions: ['hr.staff.read', 'hr.staff.manage', 'hr.compensation.read'],
  },
  {
    key: 'hr_officer',
    name: { fr: 'Agent RH', en: 'HR Officer' },
    permissions: ['hr.staff.read'],
  },
  {
    key: 'auditor',
    name: { fr: 'Auditeur', en: 'Auditor' },
    permissions: ['audit.read', 'reports.financial.read', 'fees.invoice.read', 'academics.years.read'],
  },
];
