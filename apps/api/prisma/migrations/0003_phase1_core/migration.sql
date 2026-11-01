-- CreateEnum
CREATE TYPE "PeriodKind" AS ENUM ('TERM', 'SEMESTER', 'SEQUENCE', 'EXAM_SESSION', 'OTHER');

-- CreateEnum
CREATE TYPE "EducationCycle" AS ENUM ('PRIMARY', 'SECONDARY_FIRST', 'SECONDARY_SECOND', 'TECHNICAL', 'VOCATIONAL');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('PERMANENT', 'CONTRACT', 'PART_TIME', 'TEMPORARY');

-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AssignmentRole" AS ENUM ('MAIN', 'CO_TEACHER', 'REPLACEMENT');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('APPLICANT', 'ACTIVE', 'GRADUATED', 'WITHDRAWN', 'TRANSFERRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "GuardianRelationship" AS ENUM ('FATHER', 'MOTHER', 'GUARDIAN', 'SIBLING', 'OTHER');

-- CreateEnum
CREATE TYPE "AdmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'WAITLISTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('PENDING', 'ENROLLED', 'REPEATING', 'TRANSFERRED', 'WITHDRAWN', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateTable
CREATE TABLE "tenant_counters" (
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tenant_counters_pkey" PRIMARY KEY ("tenant_id","key")
);

-- CreateTable
CREATE TABLE "sync_operations" (
    "tenant_id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_operations_pkey" PRIMARY KEY ("tenant_id","operation_id")
);

-- CreateTable
CREATE TABLE "academic_periods" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "kind" "PeriodKind" NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "academic_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "education_levels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_fr" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "cycle" "EducationCycle" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "education_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_fr" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_fr" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "category" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "program_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_subjects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "coefficient" DECIMAL(5,2) NOT NULL,
    "weekly_hours" DECIMAL(4,1) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "class_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID,
    "staff_number" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "gender" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "position" TEXT NOT NULL,
    "is_teacher" BOOLEAN NOT NULL DEFAULT false,
    "employment_type" "EmploymentType" NOT NULL,
    "status" "StaffStatus" NOT NULL DEFAULT 'ACTIVE',
    "hire_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teaching_assignments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "class_subject_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "role" "AssignmentRole" NOT NULL DEFAULT 'MAIN',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "teaching_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "matricule" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "gender" TEXT,
    "date_of_birth" DATE NOT NULL,
    "place_of_birth" TEXT,
    "nationality" TEXT,
    "address" TEXT,
    "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_guardians" (
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "guardian_id" UUID NOT NULL,
    "relationship" "GuardianRelationship" NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_emergency_contact" BOOLEAN NOT NULL DEFAULT false,
    "can_pick_up" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_guardians_pkey" PRIMARY KEY ("student_id","guardian_id")
);

-- CreateTable
CREATE TABLE "admissions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "requested_level_id" UUID NOT NULL,
    "status" "AdmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "notes" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ENROLLED',
    "enrolled_on" DATE NOT NULL,
    "left_on" DATE,
    "left_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "slot" TEXT NOT NULL DEFAULT 'DAY',
    "version" INTEGER NOT NULL DEFAULT 1,
    "taken_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "arrival_time" TEXT,
    "reason" TEXT,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timetable_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "subject_label" TEXT NOT NULL,
    "staff_id" UUID,
    "room_id" UUID,
    "weekday" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "timetable_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "academic_periods_tenant_id_academic_year_id_kind_position_key" ON "academic_periods"("tenant_id", "academic_year_id", "kind", "position");

-- CreateIndex
CREATE UNIQUE INDEX "academic_periods_tenant_id_id_key" ON "academic_periods"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "education_levels_tenant_id_code_key" ON "education_levels"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "education_levels_tenant_id_id_key" ON "education_levels"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "programs_tenant_id_code_key" ON "programs"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "programs_tenant_id_id_key" ON "programs"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_tenant_id_code_key" ON "subjects"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_tenant_id_id_key" ON "subjects"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "classes_tenant_id_academic_year_id_code_key" ON "classes"("tenant_id", "academic_year_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "classes_tenant_id_id_key" ON "classes"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "class_subjects_tenant_id_class_id_subject_id_key" ON "class_subjects"("tenant_id", "class_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_subjects_tenant_id_id_key" ON "class_subjects"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_membership_id_key" ON "staff"("membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_tenant_id_staff_number_key" ON "staff"("tenant_id", "staff_number");

-- CreateIndex
CREATE UNIQUE INDEX "staff_tenant_id_id_key" ON "staff"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "teaching_assignments_tenant_id_staff_id_idx" ON "teaching_assignments"("tenant_id", "staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "teaching_assignments_tenant_id_id_key" ON "teaching_assignments"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "students_tenant_id_last_name_first_name_idx" ON "students"("tenant_id", "last_name", "first_name");

-- CreateIndex
CREATE UNIQUE INDEX "students_tenant_id_matricule_key" ON "students"("tenant_id", "matricule");

-- CreateIndex
CREATE UNIQUE INDEX "students_tenant_id_id_key" ON "students"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "guardians_tenant_id_phone_idx" ON "guardians"("tenant_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "guardians_tenant_id_id_key" ON "guardians"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "student_guardians_tenant_id_guardian_id_idx" ON "student_guardians"("tenant_id", "guardian_id");

-- CreateIndex
CREATE UNIQUE INDEX "admissions_tenant_id_id_key" ON "admissions"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "enrollments_tenant_id_class_id_idx" ON "enrollments"("tenant_id", "class_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_tenant_id_id_key" ON "enrollments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_tenant_id_class_id_date_slot_key" ON "attendance_sessions"("tenant_id", "class_id", "date", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_tenant_id_id_key" ON "attendance_sessions"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "attendance_records_tenant_id_student_id_idx" ON "attendance_records"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_tenant_id_session_id_student_id_key" ON "attendance_records"("tenant_id", "session_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_tenant_id_campus_id_code_key" ON "rooms"("tenant_id", "campus_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_tenant_id_id_key" ON "rooms"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "timetable_entries_tenant_id_id_key" ON "timetable_entries"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "academic_periods" ADD CONSTRAINT "academic_periods_tenant_id_academic_year_id_fkey" FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_tenant_id_academic_year_id_fkey" FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_tenant_id_campus_id_fkey" FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_tenant_id_level_id_fkey" FOREIGN KEY ("tenant_id", "level_id") REFERENCES "education_levels"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_tenant_id_class_id_fkey" FOREIGN KEY ("tenant_id", "class_id") REFERENCES "classes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_tenant_id_subject_id_fkey" FOREIGN KEY ("tenant_id", "subject_id") REFERENCES "subjects"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "user_tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_assignments" ADD CONSTRAINT "teaching_assignments_tenant_id_academic_year_id_fkey" FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_assignments" ADD CONSTRAINT "teaching_assignments_tenant_id_class_subject_id_fkey" FOREIGN KEY ("tenant_id", "class_subject_id") REFERENCES "class_subjects"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_assignments" ADD CONSTRAINT "teaching_assignments_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_tenant_id_guardian_id_fkey" FOREIGN KEY ("tenant_id", "guardian_id") REFERENCES "guardians"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_tenant_id_academic_year_id_fkey" FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_tenant_id_requested_level_id_fkey" FOREIGN KEY ("tenant_id", "requested_level_id") REFERENCES "education_levels"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_tenant_id_academic_year_id_fkey" FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_tenant_id_class_id_fkey" FOREIGN KEY ("tenant_id", "class_id") REFERENCES "classes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_tenant_id_class_id_fkey" FOREIGN KEY ("tenant_id", "class_id") REFERENCES "classes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_tenant_id_session_id_fkey" FOREIGN KEY ("tenant_id", "session_id") REFERENCES "attendance_sessions"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_tenant_id_enrollment_id_fkey" FOREIGN KEY ("tenant_id", "enrollment_id") REFERENCES "enrollments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_tenant_id_campus_id_fkey" FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_tenant_id_academic_year_id_fkey" FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_tenant_id_class_id_fkey" FOREIGN KEY ("tenant_id", "class_id") REFERENCES "classes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ======================================================================
-- Hand-written part of 0003: tenant FKs, cross-tenant-safe optional FKs,
-- business constraints and Row-Level Security for every Phase 1 table.
-- ======================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenant_counters', 'sync_operations', 'academic_periods', 'education_levels', 'programs',
    'subjects', 'classes', 'class_subjects', 'staff', 'teaching_assignments', 'students',
    'guardians', 'student_guardians', 'admissions', 'enrollments', 'attendance_sessions',
    'attendance_records', 'rooms', 'timetable_entries'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT',
      t, t || '_tenant_fkey'
    );
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t
    );
  END LOOP;
END $$;

-- Optional references: composite FKs (MATCH SIMPLE skips them when the id is NULL)
-- so a row can never point at another tenant's record.
ALTER TABLE classes ADD CONSTRAINT classes_program_tenant_fkey
  FOREIGN KEY (tenant_id, program_id) REFERENCES programs (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE staff ADD CONSTRAINT staff_membership_tenant_fkey
  FOREIGN KEY (tenant_id, membership_id) REFERENCES user_tenant_memberships (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE timetable_entries ADD CONSTRAINT timetable_entries_staff_tenant_fkey
  FOREIGN KEY (tenant_id, staff_id) REFERENCES staff (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE timetable_entries ADD CONSTRAINT timetable_entries_room_tenant_fkey
  FOREIGN KEY (tenant_id, room_id) REFERENCES rooms (tenant_id, id) ON DELETE RESTRICT;

-- Academic periods: ordered dates, no overlap between periods of the same kind in a year (ACA-003).
ALTER TABLE academic_periods ADD CONSTRAINT academic_periods_dates_ordered CHECK (end_date > start_date);
ALTER TABLE academic_periods ADD CONSTRAINT academic_periods_no_overlap
  EXCLUDE USING gist (tenant_id WITH =, academic_year_id WITH =, kind WITH =, daterange(start_date, end_date, '[]') WITH &&);

ALTER TABLE classes ADD CONSTRAINT classes_capacity_positive CHECK (capacity IS NULL OR capacity > 0);
ALTER TABLE rooms ADD CONSTRAINT rooms_capacity_positive CHECK (capacity IS NULL OR capacity > 0);
ALTER TABLE class_subjects ADD CONSTRAINT class_subjects_coefficient_positive CHECK (coefficient > 0);
ALTER TABLE class_subjects ADD CONSTRAINT class_subjects_hours_non_negative CHECK (weekly_hours >= 0);
ALTER TABLE teaching_assignments ADD CONSTRAINT teaching_assignments_dates_ordered
  CHECK (end_date IS NULL OR end_date >= start_date);

-- A student holds at most one active enrollment per academic year (Module 3 AC).
CREATE UNIQUE INDEX enrollments_one_active_per_year ON enrollments (tenant_id, student_id, academic_year_id)
  WHERE status IN ('PENDING', 'ENROLLED', 'REPEATING');

-- Timetable: valid slots, and no double-booking of a teacher, room or class (TIM-003).
ALTER TABLE timetable_entries ADD CONSTRAINT timetable_entries_weekday CHECK (weekday BETWEEN 1 AND 7);
ALTER TABLE timetable_entries ADD CONSTRAINT timetable_entries_minutes
  CHECK (start_minute >= 0 AND end_minute <= 1440 AND end_minute > start_minute);
ALTER TABLE timetable_entries ADD CONSTRAINT timetable_no_teacher_overlap
  EXCLUDE USING gist (tenant_id WITH =, academic_year_id WITH =, weekday WITH =, staff_id WITH =,
                      int4range(start_minute, end_minute) WITH &&) WHERE (staff_id IS NOT NULL);
ALTER TABLE timetable_entries ADD CONSTRAINT timetable_no_room_overlap
  EXCLUDE USING gist (tenant_id WITH =, academic_year_id WITH =, weekday WITH =, room_id WITH =,
                      int4range(start_minute, end_minute) WITH &&) WHERE (room_id IS NOT NULL);
ALTER TABLE timetable_entries ADD CONSTRAINT timetable_no_class_overlap
  EXCLUDE USING gist (tenant_id WITH =, academic_year_id WITH =, weekday WITH =, class_id WITH =,
                      int4range(start_minute, end_minute) WITH &&);

-- Grants for the runtime role on the new tables.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mboka_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      tenant_counters, academic_periods, education_levels, programs, subjects, classes, class_subjects,
      staff, teaching_assignments, students, guardians, student_guardians, admissions, enrollments,
      attendance_sessions, attendance_records, rooms, timetable_entries
      TO mboka_app;
    -- Replay records are immutable evidence of what was applied.
    GRANT SELECT, INSERT ON sync_operations TO mboka_app;
  END IF;
END $$;
