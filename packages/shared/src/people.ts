import { z } from 'zod';
import { isoDate, optionalEmail, optionalPhone, optionalText, personName } from './primitives';

export const GENDERS = ['F', 'M'] as const;
export const GUARDIAN_RELATIONSHIPS = ['FATHER', 'MOTHER', 'GUARDIAN', 'SIBLING', 'OTHER'] as const;
export const EMPLOYMENT_TYPES = ['PERMANENT', 'CONTRACT', 'PART_TIME', 'TEMPORARY'] as const;
export const ASSIGNMENT_ROLES = ['MAIN', 'CO_TEACHER', 'REPLACEMENT'] as const;
export const ADMISSION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'ACCEPTED',
  'REJECTED',
  'WAITLISTED',
  'WITHDRAWN',
] as const;
export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number];

/** Allowed admission transitions (STD-002). Terminal states have no outgoing edge. */
export const ADMISSION_TRANSITIONS: Record<AdmissionStatus, readonly AdmissionStatus[]> = {
  DRAFT: ['SUBMITTED', 'WITHDRAWN'],
  SUBMITTED: ['UNDER_REVIEW', 'WITHDRAWN'],
  UNDER_REVIEW: ['ACCEPTED', 'REJECTED', 'WAITLISTED', 'WITHDRAWN'],
  WAITLISTED: ['ACCEPTED', 'REJECTED', 'WITHDRAWN'],
  ACCEPTED: [],
  REJECTED: [],
  WITHDRAWN: [],
};

const matricule = z.string().trim().min(3).max(30).regex(/^[A-Za-z0-9/_-]+$/, 'invalid_matricule');

export const newGuardianSchema = z.object({
  firstName: personName,
  lastName: personName,
  phone: optionalPhone,
  email: optionalEmail,
  address: optionalText(300),
});
export type NewGuardianInput = z.infer<typeof newGuardianSchema>;

/** Link an existing guardian (siblings share one record, STD-006) or create one inline. */
export const guardianLinkSchema = z
  .object({
    guardianId: z.uuid().optional(),
    guardian: newGuardianSchema.optional(),
    relationship: z.enum(GUARDIAN_RELATIONSHIPS),
    isPrimary: z.boolean().default(false),
    isEmergencyContact: z.boolean().default(false),
    canPickUp: z.boolean().default(false),
  })
  .refine((v) => Boolean(v.guardianId) !== Boolean(v.guardian), { message: 'guardian_id_xor_new' });
export type GuardianLinkInput = z.infer<typeof guardianLinkSchema>;

export const studentSchema = z.object({
  /** Omit to have the school's next matricule generated. */
  matricule: matricule.optional(),
  firstName: personName,
  lastName: personName,
  gender: z.enum(GENDERS).optional(),
  dateOfBirth: isoDate,
  placeOfBirth: optionalText(120),
  nationality: optionalText(60),
  address: optionalText(300),
  /** Set after the API reported a possible duplicate and the user confirmed it is a different child. */
  confirmDuplicate: z.boolean().default(false),
  guardians: z.array(guardianLinkSchema).max(6).default([]),
});
export type StudentInput = z.infer<typeof studentSchema>;

export const studentUpdateSchema = studentSchema
  .omit({ matricule: true, confirmDuplicate: true, guardians: true })
  .partial();
export type StudentUpdateInput = z.infer<typeof studentUpdateSchema>;

export const admissionSchema = z.object({
  studentId: z.uuid(),
  academicYearId: z.uuid(),
  requestedLevelId: z.uuid(),
  notes: optionalText(1000),
});
export type AdmissionInput = z.infer<typeof admissionSchema>;

export const admissionDecisionSchema = z.object({
  status: z.enum(ADMISSION_STATUSES),
  notes: optionalText(1000),
});
export type AdmissionDecisionInput = z.infer<typeof admissionDecisionSchema>;

export const enrollmentSchema = z.object({
  studentId: z.uuid(),
  classId: z.uuid(),
  enrolledOn: isoDate,
  status: z.enum(['ENROLLED', 'REPEATING']).default('ENROLLED'),
});
export type EnrollmentInput = z.infer<typeof enrollmentSchema>;

/** Ends an enrollment without erasing history (transfer, withdrawal, completion). */
export const enrollmentExitSchema = z.object({
  status: z.enum(['TRANSFERRED', 'WITHDRAWN', 'COMPLETED']),
  leftOn: isoDate,
  reason: z.string().trim().min(3).max(500),
});
export type EnrollmentExitInput = z.infer<typeof enrollmentExitSchema>;

/** Move to another class of the same year: closes the current enrollment and opens a new one. */
export const classChangeSchema = z.object({
  classId: z.uuid(),
  effectiveOn: isoDate,
  reason: z.string().trim().min(3).max(500),
});
export type ClassChangeInput = z.infer<typeof classChangeSchema>;

export const staffSchema = z.object({
  staffNumber: z.string().trim().min(2).max(30).optional(),
  firstName: personName,
  lastName: personName,
  gender: z.enum(GENDERS).optional(),
  email: optionalEmail,
  phone: optionalPhone,
  position: z.string().trim().min(2).max(100),
  isTeacher: z.boolean().default(false),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  hireDate: isoDate.optional(),
  /** Link to an existing user account in this school (needed for a teacher to sign in). */
  membershipId: z.uuid().optional(),
});
export type StaffInput = z.infer<typeof staffSchema>;

export const teachingAssignmentSchema = z.object({
  classSubjectId: z.uuid(),
  staffId: z.uuid(),
  role: z.enum(ASSIGNMENT_ROLES).default('MAIN'),
  startDate: isoDate,
});
export type TeachingAssignmentInput = z.infer<typeof teachingAssignmentSchema>;

export const endAssignmentSchema = z.object({ endDate: isoDate });
export type EndAssignmentInput = z.infer<typeof endAssignmentSchema>;
