-- Phase 6: payroll (Cameroon) — rule versions, monthly runs, payslips.
-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'PAID');




























































































-- CreateTable
CREATE TABLE "payroll_rule_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "rules" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "period" DATE NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL,
    "rules_version" INTEGER,
    "rules" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_by" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "paid_by" UUID,
    "paid_at" TIMESTAMPTZ(6),

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "employee" JSONB NOT NULL,
    "base_salary" DECIMAL(18,2) NOT NULL,
    "input" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "gross" DECIMAL(18,2) NOT NULL,
    "net" DECIMAL(18,2) NOT NULL,
    "employer_cost" DECIMAL(18,2) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_rule_versions_tenant_id_version_key" ON "payroll_rule_versions"("tenant_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_tenant_id_period_key" ON "payroll_runs"("tenant_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_tenant_id_id_key" ON "payroll_runs"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_run_id_staff_id_key" ON "payslips"("run_id", "staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_tenant_id_number_key" ON "payslips"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_tenant_id_id_key" ON "payslips"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_tenant_id_run_id_fkey" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "payroll_runs"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ======================================================================
-- Hand-written: tenant isolation, invariants and the freeze of approved payroll.
-- ======================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_rule_versions', 'payroll_runs', 'payslips'] LOOP
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

ALTER TABLE payroll_runs ADD CONSTRAINT payroll_runs_first_of_month CHECK (EXTRACT(DAY FROM period) = 1);
ALTER TABLE payroll_runs ADD CONSTRAINT payroll_runs_currency_fkey FOREIGN KEY (currency) REFERENCES currencies(code);
ALTER TABLE payroll_runs ADD CONSTRAINT payroll_runs_approver_differs CHECK (approved_by IS NULL OR approved_by <> submitted_by);
ALTER TABLE payroll_rule_versions ADD CONSTRAINT payroll_rule_versions_positive CHECK (version > 0);
ALTER TABLE payslips ADD CONSTRAINT payslips_amounts CHECK (base_salary >= 0 AND gross >= 0 AND employer_cost >= 0);

-- Status only moves forward (a submitted run may be sent back to draft); period, rules and currency are
-- fixed once submitted; only drafts may be deleted.
CREATE OR REPLACE FUNCTION payroll_runs_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE rank_old int; rank_new int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'only draft payroll runs can be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  rank_old := array_position(ARRAY['DRAFT','SUBMITTED','APPROVED','PAID'], OLD.status::text);
  rank_new := array_position(ARRAY['DRAFT','SUBMITTED','APPROVED','PAID'], NEW.status::text);
  IF rank_new < rank_old AND NOT (OLD.status = 'SUBMITTED' AND NEW.status = 'DRAFT') THEN
    RAISE EXCEPTION 'payroll run status cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'DRAFT' AND (NEW.period, NEW.rules, NEW.currency, NEW.tenant_id) IS DISTINCT FROM (OLD.period, OLD.rules, OLD.currency, OLD.tenant_id) THEN
    RAISE EXCEPTION 'a submitted payroll run is fixed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payroll_runs_guard BEFORE UPDATE OR DELETE ON payroll_runs FOR EACH ROW EXECUTE FUNCTION payroll_runs_guard();

-- Payslips change only while their run is a draft (a deleted draft run takes its payslips with it).
CREATE OR REPLACE FUNCTION payslips_freeze() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM payroll_runs WHERE id = COALESCE(NEW.run_id, OLD.run_id);
  IF st IS NOT NULL AND st <> 'DRAFT' THEN
    RAISE EXCEPTION 'payslips of a % payroll run are frozen', st USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER payslips_freeze BEFORE INSERT OR UPDATE OR DELETE ON payslips FOR EACH ROW EXECUTE FUNCTION payslips_freeze();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mboka_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_runs, payslips TO mboka_app;
    -- Rule history is never rewritten: a change is a new version.
    GRANT SELECT, INSERT ON payroll_rule_versions TO mboka_app;
  END IF;
END $$;
