import { z } from 'zod';
import { isoDate } from './primitives';

export const PERIOD_KINDS = ['TERM', 'SEMESTER', 'SEQUENCE', 'EXAM_SESSION', 'OTHER'] as const;
export const EDUCATION_CYCLES = ['PRIMARY', 'SECONDARY_FIRST', 'SECONDARY_SECOND', 'TECHNICAL', 'VOCATIONAL'] as const;

const code = z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9._-]+$/, 'invalid_code');
const label = z.string().trim().min(1).max(120);

export const academicPeriodSchema = z
  .object({
    kind: z.enum(PERIOD_KINDS),
    name: label,
    position: z.number().int().min(1).max(20),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((v) => v.endDate > v.startDate, { message: 'end_before_start', path: ['endDate'] });
export type AcademicPeriodInput = z.infer<typeof academicPeriodSchema>;

export const educationLevelSchema = z.object({
  code,
  nameFr: label,
  nameEn: label,
  cycle: z.enum(EDUCATION_CYCLES),
  position: z.number().int().min(0).max(100).default(0),
});
export type EducationLevelInput = z.infer<typeof educationLevelSchema>;

export const programSchema = z.object({ code, nameFr: label, nameEn: label });
export type ProgramInput = z.infer<typeof programSchema>;

export const subjectSchema = z.object({
  code,
  nameFr: label,
  nameEn: label,
  category: z.string().trim().max(60).optional(),
});
export type SubjectInput = z.infer<typeof subjectSchema>;

export const schoolClassSchema = z.object({
  academicYearId: z.uuid(),
  campusId: z.uuid(),
  levelId: z.uuid(),
  programId: z.uuid().optional(),
  code,
  name: label,
  capacity: z.number().int().min(1).max(500).optional(),
});
export type SchoolClassInput = z.infer<typeof schoolClassSchema>;

export const classSubjectSchema = z.object({
  subjectId: z.uuid(),
  /** Decimal values travel as numbers with ≤ 2 decimals; the API stores them as NUMERIC. */
  coefficient: z.number().positive().max(100).multipleOf(0.01),
  weeklyHours: z.number().min(0).max(60).multipleOf(0.5),
});
export type ClassSubjectInput = z.infer<typeof classSubjectSchema>;
