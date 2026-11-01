-- CreateEnum
CREATE TYPE "FinancialPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "FeeKind" AS ENUM ('REGISTRATION', 'TUITION', 'EXAM', 'TRANSPORT', 'CANTEEN', 'UNIFORM', 'OTHER');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceLineKind" AS ENUM ('CHARGE', 'DISCOUNT');

-- CreateEnum
CREATE TYPE "DiscountKind" AS ENUM ('DISCOUNT', 'SCHOLARSHIP', 'WAIVER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD', 'MOBILE_MONEY', 'CHEQUE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING_VERIFICATION', 'CONFIRMED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CashierSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED');
























-- CreateTable
CREATE TABLE "currencies" (
    "code" CHAR(3) NOT NULL,
    "minor_units" INTEGER NOT NULL,
    "name_fr" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "finance_settings" (
    "tenant_id" UUID NOT NULL,
    "reporting_currency" CHAR(3) NOT NULL,
    "enabled_currencies" TEXT[],
    "expense_approval_threshold" DECIMAL(18,2) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "finance_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "base_currency" CHAR(3) NOT NULL,
    "quote_currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "effective_date" DATE NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_periods" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "FinancialPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMPTZ(6),
    "closed_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_categories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_fr" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "kind" "FeeKind" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_schedules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "level_id" UUID,
    "class_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_installments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "fee_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_fee_assignments" (
    "tenant_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_fee_assignments_pkey" PRIMARY KEY ("schedule_id","enrollment_id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "student_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "enrollment_id" UUID,
    "currency" CHAR(3) NOT NULL,
    "issue_date" DATE NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "reporting_currency" CHAR(3) NOT NULL,
    "reporting_rate" DECIMAL(20,10) NOT NULL,
    "notes" TEXT,
    "cancelled_reason" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "kind" "InvoiceLineKind" NOT NULL,
    "category_id" UUID,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "due_date" DATE,
    "installment_id" UUID,
    "discount_kind" "DiscountKind",
    "reason" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "received_on" DATE NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "external_reference" TEXT,
    "provider" TEXT,
    "idempotency_key" UUID NOT NULL,
    "cashier_session_id" UUID,
    "recorded_by" UUID,
    "reporting_currency" CHAR(3) NOT NULL,
    "reporting_rate" DECIMAL(20,10) NOT NULL,
    "reporting_amount" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "confirmed_at" TIMESTAMPTZ(6),
    "reversed_at" TIMESTAMPTZ(6),
    "reversed_by" UUID,
    "reversal_reason" TEXT,
    "reversal_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "invoice_amount" DECIMAL(18,2) NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "exchange_difference" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "payment_id" UUID NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by" UUID,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "requested_by" UUID NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_providers" (
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "secret_encrypted" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_providers_pkey" PRIMARY KEY ("tenant_id","code")
);

-- CreateTable
CREATE TABLE "payment_provider_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_tx_id" TEXT NOT NULL,
    "provider_status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payment_id" UUID,
    "outcome" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashier_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cashier_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "opening_float" DECIMAL(18,2) NOT NULL,
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "CashierSessionStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMPTZ(6),
    "expected_amount" DECIMAL(18,2),
    "counted_amount" DECIMAL(18,2),
    "discrepancy" DECIMAL(18,2),
    "notes" TEXT,

    CONSTRAINT "cashier_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_fr" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "supplier" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "expense_date" DATE NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'SUBMITTED',
    "reporting_amount" DECIMAL(18,2) NOT NULL,
    "reporting_rate" DECIMAL(20,10) NOT NULL,
    "submitted_by" UUID NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "payment_reference" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "expense_id" UUID NOT NULL,
    "from_status" "ExpenseStatus",
    "to_status" "ExpenseStatus" NOT NULL,
    "actor_id" UUID NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_tenant_id_base_currency_quote_currency_effec_key" ON "exchange_rates"("tenant_id", "base_currency", "quote_currency", "effective_date");

-- CreateIndex
CREATE UNIQUE INDEX "financial_periods_tenant_id_id_key" ON "financial_periods"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_categories_tenant_id_code_key" ON "fee_categories"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "fee_categories_tenant_id_id_key" ON "fee_categories"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_schedules_tenant_id_id_key" ON "fee_schedules"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_installments_tenant_id_schedule_id_position_key" ON "fee_installments"("tenant_id", "schedule_id", "position");

-- CreateIndex
CREATE INDEX "student_fee_assignments_tenant_id_idx" ON "student_fee_assignments"("tenant_id");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_student_id_idx" ON "invoices"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_number_key" ON "invoices"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_id_key" ON "invoices"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "invoice_lines_tenant_id_invoice_id_idx" ON "invoice_lines"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_student_id_idx" ON "payments"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_received_on_idx" ON "payments"("tenant_id", "received_on");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_idempotency_key_key" ON "payments"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_id_key" ON "payments"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "payment_allocations_tenant_id_invoice_id_idx" ON "payment_allocations"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payment_allocations_tenant_id_payment_id_idx" ON "payment_allocations"("tenant_id", "payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_payment_id_key" ON "receipts"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_tenant_id_number_key" ON "receipts"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "refunds_tenant_id_payment_id_idx" ON "refunds"("tenant_id", "payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_provider_events_tenant_id_provider_provider_tx_id_p_key" ON "payment_provider_events"("tenant_id", "provider", "provider_tx_id", "provider_status");

-- CreateIndex
CREATE UNIQUE INDEX "cashier_sessions_tenant_id_id_key" ON "cashier_sessions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_tenant_id_code_key" ON "expense_categories"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_tenant_id_id_key" ON "expense_categories"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "expenses_tenant_id_expense_date_idx" ON "expenses"("tenant_id", "expense_date");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_tenant_id_number_key" ON "expenses"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_tenant_id_id_key" ON "expenses"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "expense_events_tenant_id_expense_id_idx" ON "expense_events"("tenant_id", "expense_id");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_tenant_id_academic_year_id_key" ON "budgets"("tenant_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_tenant_id_id_key" ON "budgets"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "budget_lines_tenant_id_budget_id_category_id_key" ON "budget_lines"("tenant_id", "budget_id", "category_id");

-- AddForeignKey
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_tenant_id_academic_year_id_fkey" FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_tenant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "fee_categories"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_installments" ADD CONSTRAINT "fee_installments_tenant_id_schedule_id_fkey" FOREIGN KEY ("tenant_id", "schedule_id") REFERENCES "fee_schedules"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_fee_assignments" ADD CONSTRAINT "student_fee_assignments_tenant_id_schedule_id_fkey" FOREIGN KEY ("tenant_id", "schedule_id") REFERENCES "fee_schedules"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_fee_assignments" ADD CONSTRAINT "student_fee_assignments_tenant_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "invoices"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_academic_year_id_fkey" FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "invoices"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "fee_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_id_payment_id_fkey" FOREIGN KEY ("tenant_id", "payment_id") REFERENCES "payments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "invoices"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_id_payment_id_fkey" FOREIGN KEY ("tenant_id", "payment_id") REFERENCES "payments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "expense_categories"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_events" ADD CONSTRAINT "expense_events_tenant_id_expense_id_fkey" FOREIGN KEY ("tenant_id", "expense_id") REFERENCES "expenses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_tenant_id_academic_year_id_fkey" FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_tenant_id_budget_id_fkey" FOREIGN KEY ("tenant_id", "budget_id") REFERENCES "budgets"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_tenant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "expense_categories"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ======================================================================
-- Hand-written part of 0004: reference currencies, tenant isolation,
-- cross-tenant-safe optional FKs, money invariants and append-only rules.
-- ======================================================================

-- ISO 4217 reference data for the target markets.
INSERT INTO currencies (code, minor_units, name_fr, name_en) VALUES
  ('XAF', 0, 'Franc CFA (CEMAC)', 'Central African CFA franc'),
  ('XOF', 0, 'Franc CFA (UEMOA)', 'West African CFA franc'),
  ('EUR', 2, 'Euro', 'Euro'),
  ('USD', 2, 'Dollar américain', 'US dollar'),
  ('GBP', 2, 'Livre sterling', 'Pound sterling'),
  ('NGN', 2, 'Naira nigérian', 'Nigerian naira'),
  ('CDF', 2, 'Franc congolais', 'Congolese franc'),
  ('CAD', 2, 'Dollar canadien', 'Canadian dollar');

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'finance_settings', 'exchange_rates', 'financial_periods', 'fee_categories', 'fee_schedules',
    'fee_installments', 'student_fee_assignments', 'invoices', 'invoice_lines', 'payments',
    'payment_allocations', 'receipts', 'refunds', 'payment_providers', 'payment_provider_events',
    'cashier_sessions', 'expense_categories', 'expenses', 'expense_events', 'budgets', 'budget_lines'
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

-- Every currency column refers to the ISO reference table.
ALTER TABLE finance_settings ADD CONSTRAINT finance_settings_currency_fkey FOREIGN KEY (reporting_currency) REFERENCES currencies(code);
ALTER TABLE exchange_rates ADD CONSTRAINT exchange_rates_base_fkey FOREIGN KEY (base_currency) REFERENCES currencies(code);
ALTER TABLE exchange_rates ADD CONSTRAINT exchange_rates_quote_fkey FOREIGN KEY (quote_currency) REFERENCES currencies(code);
ALTER TABLE fee_schedules ADD CONSTRAINT fee_schedules_currency_fkey FOREIGN KEY (currency) REFERENCES currencies(code);
ALTER TABLE invoices ADD CONSTRAINT invoices_currency_fkey FOREIGN KEY (currency) REFERENCES currencies(code);
ALTER TABLE payments ADD CONSTRAINT payments_currency_fkey FOREIGN KEY (currency) REFERENCES currencies(code);
ALTER TABLE cashier_sessions ADD CONSTRAINT cashier_sessions_currency_fkey FOREIGN KEY (currency) REFERENCES currencies(code);
ALTER TABLE expenses ADD CONSTRAINT expenses_currency_fkey FOREIGN KEY (currency) REFERENCES currencies(code);

-- Optional references stay inside the tenant (composite FKs, skipped when NULL).
CREATE UNIQUE INDEX fee_installments_tenant_id_id_key ON fee_installments (tenant_id, id);
ALTER TABLE fee_schedules ADD CONSTRAINT fee_schedules_level_tenant_fkey
  FOREIGN KEY (tenant_id, level_id) REFERENCES education_levels (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE fee_schedules ADD CONSTRAINT fee_schedules_class_tenant_fkey
  FOREIGN KEY (tenant_id, class_id) REFERENCES classes (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE student_fee_assignments ADD CONSTRAINT student_fee_assignments_enrollment_tenant_fkey
  FOREIGN KEY (tenant_id, enrollment_id) REFERENCES enrollments (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE invoices ADD CONSTRAINT invoices_enrollment_tenant_fkey
  FOREIGN KEY (tenant_id, enrollment_id) REFERENCES enrollments (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_category_tenant_fkey
  FOREIGN KEY (tenant_id, category_id) REFERENCES fee_categories (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_installment_tenant_fkey
  FOREIGN KEY (tenant_id, installment_id) REFERENCES fee_installments (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE payments ADD CONSTRAINT payments_cashier_session_tenant_fkey
  FOREIGN KEY (tenant_id, cashier_session_id) REFERENCES cashier_sessions (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE receipts ADD CONSTRAINT receipts_payment_tenant_fkey
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments (tenant_id, id) ON DELETE RESTRICT;

-- Money invariants.
ALTER TABLE exchange_rates ADD CONSTRAINT exchange_rates_positive CHECK (rate > 0 AND base_currency <> quote_currency);
ALTER TABLE fee_schedules ADD CONSTRAINT fee_schedules_amount_positive CHECK (amount > 0);
ALTER TABLE fee_schedules ADD CONSTRAINT fee_schedules_single_scope CHECK (level_id IS NULL OR class_id IS NULL);
ALTER TABLE fee_installments ADD CONSTRAINT fee_installments_amount_positive CHECK (amount > 0);
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_amount_positive CHECK (amount > 0);
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_discount_kind
  CHECK ((kind = 'DISCOUNT') = (discount_kind IS NOT NULL));
ALTER TABLE payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0 AND reporting_amount >= 0);
ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_positive CHECK (amount > 0 AND invoice_amount > 0 AND rate > 0);
ALTER TABLE refunds ADD CONSTRAINT refunds_amount_positive CHECK (amount > 0);
ALTER TABLE cashier_sessions ADD CONSTRAINT cashier_sessions_float_non_negative CHECK (opening_float >= 0);
ALTER TABLE expenses ADD CONSTRAINT expenses_amount_positive CHECK (amount > 0);
ALTER TABLE budget_lines ADD CONSTRAINT budget_lines_amount_non_negative CHECK (amount >= 0);
ALTER TABLE financial_periods ADD CONSTRAINT financial_periods_dates_ordered CHECK (end_date >= start_date);
ALTER TABLE financial_periods ADD CONSTRAINT financial_periods_no_overlap
  EXCLUDE USING gist (tenant_id WITH =, daterange(start_date, end_date, '[]') WITH &&);

-- One open till per cashier and currency; one payment per provider transaction.
CREATE UNIQUE INDEX cashier_sessions_one_open ON cashier_sessions (tenant_id, cashier_id, currency) WHERE status = 'OPEN';
CREATE UNIQUE INDEX payments_provider_reference ON payments (tenant_id, provider, external_reference)
  WHERE provider IS NOT NULL AND external_reference IS NOT NULL;

-- A payment's financial facts never change after insert; only its status and lifecycle metadata do.
CREATE OR REPLACE FUNCTION payments_freeze_financial_fields() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.tenant_id, NEW.student_id, NEW.method, NEW.currency, NEW.amount, NEW.received_on, NEW.idempotency_key,
      NEW.reporting_currency, NEW.reporting_rate, NEW.reporting_amount)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.student_id, OLD.method, OLD.currency, OLD.amount, OLD.received_on, OLD.idempotency_key,
      OLD.reporting_currency, OLD.reporting_rate, OLD.reporting_amount) THEN
    RAISE EXCEPTION 'payment financial fields are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('REVERSED', 'FAILED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'payment status % is final', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_freeze BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION payments_freeze_financial_fields();

-- Grants: posted records are append-only for the runtime role.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mboka_app') THEN
    GRANT SELECT ON currencies TO mboka_app;
    GRANT SELECT, INSERT, UPDATE ON finance_settings, financial_periods, invoices, payments, refunds,
      cashier_sessions, expenses TO mboka_app;
    GRANT SELECT, INSERT ON exchange_rates, invoice_lines, student_fee_assignments, payment_allocations,
      receipts, payment_provider_events, expense_events TO mboka_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON fee_categories, fee_schedules, fee_installments, payment_providers,
      expense_categories, budgets, budget_lines TO mboka_app;
  END IF;
END $$;
