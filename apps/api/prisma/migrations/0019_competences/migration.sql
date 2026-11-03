-- Phase 8: competence-based marking (MINEDUB 2018 primary curriculum) and report book remarks.
-- CreateTable
CREATE TABLE "competence_components" (
    "tenant_id" UUID NOT NULL,
    "class_subject_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "max_score" DECIMAL(5,2) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "competence_components_pkey" PRIMARY KEY ("tenant_id","class_subject_id","kind")
);

-- CreateTable
CREATE TABLE "competence_marks" (
    "tenant_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "class_subject_id" UUID NOT NULL,
    "month" SMALLINT NOT NULL,
    "kind" TEXT NOT NULL,
    "score" DECIMAL(5,2) NOT NULL,
    "entered_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "competence_marks_pkey" PRIMARY KEY ("tenant_id","enrollment_id","class_subject_id","month","kind")
);

-- CreateTable
CREATE TABLE "report_book_entries" (
    "tenant_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "term" SMALLINT NOT NULL,
    "teacher_remark" TEXT,
    "head_remark" TEXT,
    "conduct" TEXT,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "report_book_entries_pkey" PRIMARY KEY ("tenant_id","enrollment_id","term")
);

-- CreateIndex
CREATE INDEX "competence_marks_tenant_id_class_subject_id_month_idx" ON "competence_marks"("tenant_id", "class_subject_id", "month");

-- Hand-written: composite tenant FKs, value checks, row-level security, grants.
ALTER TABLE competence_components ADD CONSTRAINT competence_components_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE competence_components ADD CONSTRAINT competence_components_class_subject_fkey FOREIGN KEY (tenant_id, class_subject_id) REFERENCES class_subjects(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE competence_components ADD CONSTRAINT competence_components_kind CHECK (kind IN ('ORAL', 'WRITTEN', 'PRACTICAL', 'ATTITUDE'));
ALTER TABLE competence_components ADD CONSTRAINT competence_components_max CHECK (max_score > 0);

ALTER TABLE competence_marks ADD CONSTRAINT competence_marks_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE competence_marks ADD CONSTRAINT competence_marks_enrollment_fkey FOREIGN KEY (tenant_id, enrollment_id) REFERENCES enrollments(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE competence_marks ADD CONSTRAINT competence_marks_component_fkey FOREIGN KEY (tenant_id, class_subject_id, kind) REFERENCES competence_components(tenant_id, class_subject_id, kind) ON DELETE RESTRICT;
ALTER TABLE competence_marks ADD CONSTRAINT competence_marks_month CHECK (month BETWEEN 1 AND 9);
ALTER TABLE competence_marks ADD CONSTRAINT competence_marks_score CHECK (score >= 0);

ALTER TABLE report_book_entries ADD CONSTRAINT report_book_entries_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE report_book_entries ADD CONSTRAINT report_book_entries_enrollment_fkey FOREIGN KEY (tenant_id, enrollment_id) REFERENCES enrollments(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE report_book_entries ADD CONSTRAINT report_book_entries_term CHECK (term BETWEEN 0 AND 3);

-- A mark never exceeds its component's maximum.
CREATE OR REPLACE FUNCTION competence_marks_within_max() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE cap numeric;
BEGIN
  SELECT max_score INTO cap FROM competence_components
   WHERE tenant_id = NEW.tenant_id AND class_subject_id = NEW.class_subject_id AND kind = NEW.kind;
  IF NEW.score > cap THEN
    RAISE EXCEPTION 'competence mark % exceeds the maximum %', NEW.score, cap USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER competence_marks_within_max BEFORE INSERT OR UPDATE ON competence_marks FOR EACH ROW EXECUTE FUNCTION competence_marks_within_max();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['competence_components', 'competence_marks', 'report_book_entries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
    EXECUTE format('CREATE POLICY platform_read ON %I FOR SELECT USING (app_platform_read())', t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mboka_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON competence_components, competence_marks, report_book_entries TO mboka_app;
  END IF;
END $$;
