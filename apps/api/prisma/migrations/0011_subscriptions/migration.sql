-- Phase 6: SaaS plans, subscription lifecycle, self-service sign-up verification.
-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'CANCELED');

-- CreateEnum
CREATE TYPE "SubscriptionInvoiceStatus" AS ENUM ('OPEN', 'PAID', 'VOID');
































































































-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "billing_cycle" TEXT NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "max_students" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "trial_ends_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verification_required" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "email_verify_expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "email_verify_token_hash" TEXT;

-- CreateTable
CREATE TABLE "plans" (
    "code" TEXT NOT NULL,
    "name_fr" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "description_fr" TEXT,
    "description_en" TEXT,
    "monthly_price" DECIMAL(18,0) NOT NULL,
    "annual_price" DECIMAL(18,0) NOT NULL,
    "max_students" INTEGER NOT NULL,
    "max_campuses" INTEGER NOT NULL,
    "max_users" INTEGER NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "subscription_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "billing_cycle" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "amount" DECIMAL(18,0) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'XAF',
    "status" "SubscriptionInvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ(6),
    "paid_reference" TEXT,
    "confirmed_by" UUID,

    CONSTRAINT "subscription_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_invoices_number_key" ON "subscription_invoices"("number");

-- CreateIndex
CREATE INDEX "subscription_invoices_tenant_id_created_at_idx" ON "subscription_invoices"("tenant_id", "created_at");


-- ======================================================================
-- Hand-written: isolation, invariants, numbering and grants.
-- ======================================================================

ALTER TABLE subscription_invoices ADD CONSTRAINT subscription_invoices_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE subscription_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscription_invoices USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE subscription_invoices ADD CONSTRAINT subscription_invoices_amount CHECK (amount >= 0);
ALTER TABLE subscription_invoices ADD CONSTRAINT subscription_invoices_cycle CHECK (billing_cycle IN ('MONTHLY', 'ANNUAL'));
ALTER TABLE subscription_invoices ADD CONSTRAINT subscription_invoices_period CHECK (period_end > period_start);
ALTER TABLE subscription_invoices ADD CONSTRAINT subscription_invoices_paid CHECK ((status = 'PAID') = (paid_at IS NOT NULL));
-- At most one invoice awaiting payment per school.
CREATE UNIQUE INDEX subscription_invoices_one_open ON subscription_invoices (tenant_id) WHERE status = 'OPEN';

ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_cycle CHECK (billing_cycle IN ('MONTHLY', 'ANNUAL'));
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_trial CHECK (status <> 'TRIALING' OR trial_ends_at IS NOT NULL);
ALTER TABLE plans ADD CONSTRAINT plans_values CHECK (monthly_price >= 0 AND annual_price >= 0 AND max_students > 0 AND max_campuses > 0 AND max_users > 0);
ALTER TABLE plans ADD CONSTRAINT plans_code CHECK (code ~ '^[a-z0-9_-]{2,30}$');

-- Invoice numbers are platform-wide (SUB-2026-000001), so they come from one sequence.
CREATE SEQUENCE subscription_invoice_number_seq;

-- An invoice's amount and period never change; paid and void are final.
CREATE OR REPLACE FUNCTION subscription_invoices_freeze() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.tenant_id, NEW.number, NEW.plan, NEW.billing_cycle, NEW.period_start, NEW.period_end, NEW.amount, NEW.currency)
     IS DISTINCT FROM (OLD.tenant_id, OLD.number, OLD.plan, OLD.billing_cycle, OLD.period_start, OLD.period_end, OLD.amount, OLD.currency) THEN
    RAISE EXCEPTION 'subscription invoice terms are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'OPEN' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'subscription invoice status % is final', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER subscription_invoices_freeze BEFORE UPDATE ON subscription_invoices FOR EACH ROW EXECUTE FUNCTION subscription_invoices_freeze();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mboka_app') THEN
    GRANT SELECT, INSERT, UPDATE ON plans, subscription_invoices TO mboka_app;
    GRANT USAGE, SELECT ON SEQUENCE subscription_invoice_number_seq TO mboka_app;
  END IF;
END $$;
