-- Phase 7: demo schools with an expiry date.
-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "demo_expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "is_demo" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE tenants ADD CONSTRAINT tenants_demo_expiry CHECK (NOT is_demo OR demo_expires_at IS NOT NULL);
CREATE INDEX tenants_demo_expires_idx ON tenants (demo_expires_at) WHERE is_demo;
