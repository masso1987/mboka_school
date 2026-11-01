-- Phase 6: Mobile Money collection through the operators' APIs (MTN MoMo, Orange Money).
ALTER TABLE "payment_providers" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'SIGNED_WEBHOOK';
ALTER TABLE "payment_providers" ADD CONSTRAINT "payment_providers_kind_check"
  CHECK ("kind" IN ('SIGNED_WEBHOOK', 'MTN_MOMO', 'ORANGE_MONEY'));

ALTER TABLE "payments" ADD COLUMN "payer_msisdn" TEXT,
  ADD COLUMN "provider_state" JSONB,
  ADD COLUMN "provider_checked_at" TIMESTAMPTZ(6),
  ADD COLUMN "failure_reason" TEXT;
ALTER TABLE "payments" ADD CONSTRAINT "payments_payer_msisdn_check" CHECK ("payer_msisdn" IS NULL OR "payer_msisdn" ~ '^[0-9]{9,15}$');

-- The reconciler looks for provider payments still awaiting their result.
CREATE INDEX "payments_pending_provider" ON "payments" ("tenant_id", "provider_checked_at")
  WHERE "status" = 'PENDING_VERIFICATION' AND "provider" IS NOT NULL;
-- Orange notifications carry only the notif_token.
CREATE INDEX "payments_provider_notif_token" ON "payments" (("provider_state" ->> 'notifToken'))
  WHERE "provider_state" IS NOT NULL;
