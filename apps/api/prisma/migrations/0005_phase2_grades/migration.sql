-- CreateEnum
CREATE TYPE "AssessmentKind" AS ENUM ('TEST', 'EXAM', 'ASSIGNMENT', 'PRACTICAL', 'ORAL');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('OPEN', 'SUBMITTED', 'APPROVED', 'REOPENED');

-- CreateEnum
CREATE TYPE "MarkStatus" AS ENUM ('PRESENT', 'ABSENT', 'EXCUSED', 'EXEMPT', 'NOT_ASSESSED');

-- CreateEnum
CREATE TYPE "ReportCardStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "PromotionOutcome" AS ENUM ('PROMOTED', 'REPEAT', 'GRADUATED', 'EXCLUDED');






























































-- CreateTable
CREATE TABLE "grading_schemes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grading_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grading_scheme_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "rules" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grading_scheme_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "class_subject_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AssessmentKind" NOT NULL,
    "max_score" DECIMAL(6,2) NOT NULL,
    "weight" DECIMAL(6,2) NOT NULL,
    "held_on" DATE,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_submissions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "class_subject_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'OPEN',
    "submitted_by" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "reopened_by" UUID,
    "reopened_at" TIMESTAMPTZ(6),
    "reopen_reason" TEXT,
    "ever_approved" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "grade_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_marks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "score" DECIMAL(6,2),
    "status" "MarkStatus" NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "student_marks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_change_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "from_score" DECIMAL(6,2),
    "from_status" "MarkStatus",
    "to_score" DECIMAL(6,2),
    "to_status" "MarkStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "changed_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_change_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subject_comments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "class_subject_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "comment" TEXT NOT NULL,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subject_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_cards" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ReportCardStatus" NOT NULL DEFAULT 'DRAFT',
    "scheme_version_id" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "input_hash" TEXT NOT NULL,
    "verification_code" TEXT NOT NULL,
    "generated_by" UUID NOT NULL,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by" UUID,
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "report_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_decisions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "decision" "PromotionOutcome" NOT NULL,
    "proposed" "PromotionOutcome" NOT NULL,
    "annual_average" TEXT,
    "note" TEXT,
    "decided_by" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "grading_schemes_tenant_id_name_key" ON "grading_schemes"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "grading_schemes_tenant_id_id_key" ON "grading_schemes"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "grading_scheme_versions_tenant_id_scheme_id_version_key" ON "grading_scheme_versions"("tenant_id", "scheme_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "grading_scheme_versions_tenant_id_id_key" ON "grading_scheme_versions"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "assessments_tenant_id_class_subject_id_period_id_idx" ON "assessments"("tenant_id", "class_subject_id", "period_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessments_tenant_id_id_key" ON "assessments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_submissions_tenant_id_class_subject_id_period_id_key" ON "grade_submissions"("tenant_id", "class_subject_id", "period_id");

-- CreateIndex
CREATE INDEX "student_marks_tenant_id_student_id_idx" ON "student_marks"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_marks_tenant_id_assessment_id_enrollment_id_key" ON "student_marks"("tenant_id", "assessment_id", "enrollment_id");

-- CreateIndex
CREATE INDEX "grade_change_history_tenant_id_assessment_id_idx" ON "grade_change_history"("tenant_id", "assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "subject_comments_tenant_id_class_subject_id_period_id_enrol_key" ON "subject_comments"("tenant_id", "class_subject_id", "period_id", "enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_cards_verification_code_key" ON "report_cards"("verification_code");

-- CreateIndex
CREATE INDEX "report_cards_tenant_id_class_id_scope_idx" ON "report_cards"("tenant_id", "class_id", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "report_cards_tenant_id_enrollment_id_scope_version_key" ON "report_cards"("tenant_id", "enrollment_id", "scope", "version");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_decisions_tenant_id_enrollment_id_key" ON "promotion_decisions"("tenant_id", "enrollment_id");

-- AddForeignKey
ALTER TABLE "grading_scheme_versions" ADD CONSTRAINT "grading_scheme_versions_tenant_id_scheme_id_fkey" FOREIGN KEY ("tenant_id", "scheme_id") REFERENCES "grading_schemes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_tenant_id_class_subject_id_fkey" FOREIGN KEY ("tenant_id", "class_subject_id") REFERENCES "class_subjects"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_tenant_id_period_id_fkey" FOREIGN KEY ("tenant_id", "period_id") REFERENCES "academic_periods"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_submissions" ADD CONSTRAINT "grade_submissions_tenant_id_class_subject_id_fkey" FOREIGN KEY ("tenant_id", "class_subject_id") REFERENCES "class_subjects"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_submissions" ADD CONSTRAINT "grade_submissions_tenant_id_period_id_fkey" FOREIGN KEY ("tenant_id", "period_id") REFERENCES "academic_periods"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_marks" ADD CONSTRAINT "student_marks_tenant_id_assessment_id_fkey" FOREIGN KEY ("tenant_id", "assessment_id") REFERENCES "assessments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_marks" ADD CONSTRAINT "student_marks_tenant_id_enrollment_id_fkey" FOREIGN KEY ("tenant_id", "enrollment_id") REFERENCES "enrollments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_tenant_id_enrollment_id_fkey" FOREIGN KEY ("tenant_id", "enrollment_id") REFERENCES "enrollments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_tenant_id_scheme_version_id_fkey" FOREIGN KEY ("tenant_id", "scheme_version_id") REFERENCES "grading_scheme_versions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_decisions" ADD CONSTRAINT "promotion_decisions_tenant_id_enrollment_id_fkey" FOREIGN KEY ("tenant_id", "enrollment_id") REFERENCES "enrollments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ======================================================================
-- Hand-written part of 0005: tenant isolation, composite FKs, mark range
-- enforcement and report-card immutability.
-- ======================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'grading_schemes', 'grading_scheme_versions', 'assessments', 'grade_submissions', 'student_marks',
    'grade_change_history', 'subject_comments', 'report_cards', 'promotion_decisions'
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

-- References kept inside the tenant.
ALTER TABLE student_marks ADD CONSTRAINT student_marks_student_tenant_fkey
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE grade_change_history ADD CONSTRAINT grade_change_history_assessment_tenant_fkey
  FOREIGN KEY (tenant_id, assessment_id) REFERENCES assessments (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE grade_change_history ADD CONSTRAINT grade_change_history_student_tenant_fkey
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE subject_comments ADD CONSTRAINT subject_comments_class_subject_tenant_fkey
  FOREIGN KEY (tenant_id, class_subject_id) REFERENCES class_subjects (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE subject_comments ADD CONSTRAINT subject_comments_period_tenant_fkey
  FOREIGN KEY (tenant_id, period_id) REFERENCES academic_periods (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE subject_comments ADD CONSTRAINT subject_comments_enrollment_tenant_fkey
  FOREIGN KEY (tenant_id, enrollment_id) REFERENCES enrollments (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE report_cards ADD CONSTRAINT report_cards_student_tenant_fkey
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE report_cards ADD CONSTRAINT report_cards_class_tenant_fkey
  FOREIGN KEY (tenant_id, class_id) REFERENCES classes (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE report_cards ADD CONSTRAINT report_cards_year_tenant_fkey
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic_years (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE promotion_decisions ADD CONSTRAINT promotion_decisions_year_tenant_fkey
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic_years (tenant_id, id) ON DELETE RESTRICT;

-- One default scheme per school; positive maxima and weights.
CREATE UNIQUE INDEX grading_schemes_one_default ON grading_schemes (tenant_id) WHERE is_default;
ALTER TABLE assessments ADD CONSTRAINT assessments_max_positive CHECK (max_score > 0);
ALTER TABLE assessments ADD CONSTRAINT assessments_weight_positive CHECK (weight > 0);

-- A PRESENT mark has a score; any other status has none. Scores lie within [0, assessment max] (GRD-002 AC).
ALTER TABLE student_marks ADD CONSTRAINT student_marks_score_matches_status
  CHECK ((status = 'PRESENT') = (score IS NOT NULL));
ALTER TABLE student_marks ADD CONSTRAINT student_marks_score_non_negative CHECK (score IS NULL OR score >= 0);

CREATE OR REPLACE FUNCTION student_marks_within_max() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE m numeric;
BEGIN
  IF NEW.score IS NOT NULL THEN
    SELECT max_score INTO m FROM assessments WHERE id = NEW.assessment_id;
    IF NEW.score > m THEN
      RAISE EXCEPTION 'mark % exceeds the assessment maximum %', NEW.score, m USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER student_marks_max BEFORE INSERT OR UPDATE ON student_marks
  FOR EACH ROW EXECUTE FUNCTION student_marks_within_max();

-- A report card's content and provenance never change; only its status moves (DRAFT → PUBLISHED → SUPERSEDED).
CREATE OR REPLACE FUNCTION report_cards_freeze() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.content, NEW.input_hash, NEW.scheme_version_id, NEW.verification_code, NEW.enrollment_id, NEW.scope, NEW.version)
     IS DISTINCT FROM
     (OLD.content, OLD.input_hash, OLD.scheme_version_id, OLD.verification_code, OLD.enrollment_id, OLD.scope, OLD.version) THEN
    RAISE EXCEPTION 'report card content is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'SUPERSEDED' AND NEW.status <> 'SUPERSEDED' THEN
    RAISE EXCEPTION 'a superseded report card cannot be reactivated' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER report_cards_freeze BEFORE UPDATE ON report_cards FOR EACH ROW EXECUTE FUNCTION report_cards_freeze();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mboka_app') THEN
    GRANT SELECT, INSERT, UPDATE ON grading_schemes, grade_submissions, report_cards, promotion_decisions TO mboka_app;
    GRANT SELECT, INSERT ON grading_scheme_versions, grade_change_history TO mboka_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON assessments, student_marks, subject_comments TO mboka_app;
  END IF;
END $$;
