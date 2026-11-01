-- Phase 6: password reset and e-mailed invitations. One single-use link per account; only its SHA-256 is stored.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "password_reset_expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "password_reset_token_hash" TEXT;
