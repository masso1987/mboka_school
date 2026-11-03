-- Phase 7: per-school licence notes and optional module prices.
-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "licence_notes" TEXT;

-- CreateTable
CREATE TABLE "module_prices" (
    "module" TEXT NOT NULL,
    "monthly_price" DECIMAL(18,0) NOT NULL,
    "annual_price" DECIMAL(18,0) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "module_prices_pkey" PRIMARY KEY ("module")
);

ALTER TABLE module_prices ADD CONSTRAINT module_prices_values CHECK (monthly_price >= 0 AND annual_price >= 0);

-- Platform reference data, like plans: no tenant, so no row-level security; only platform routes write it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mboka_app') THEN
    GRANT SELECT, INSERT, UPDATE ON module_prices TO mboka_app;
  END IF;
END $$;
