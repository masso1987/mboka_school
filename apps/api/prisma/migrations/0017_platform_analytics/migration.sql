-- Phase 7: product analytics settings (PostHog) for the platform console.
-- AlterTable
ALTER TABLE "platform_settings" ADD COLUMN     "analytics" JSONB NOT NULL DEFAULT '{}';
