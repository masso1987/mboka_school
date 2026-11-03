-- Phase 8: school documents' images, pupil origin for the MINEDUB booklet, marking system per level.
-- CreateEnum
CREATE TYPE "MarkingSystem" AS ENUM ('SUBJECTS', 'COMPETENCES');

-- AlterTable
ALTER TABLE "education_levels" ADD COLUMN     "marking_system" "MarkingSystem" NOT NULL DEFAULT 'SUBJECTS';

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "division" TEXT,
ADD COLUMN     "health_status" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "sub_division" TEXT;

-- CreateTable
CREATE TABLE "school_assets" (
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "school_assets_pkey" PRIMARY KEY ("tenant_id","kind")
);

-- Hand-written: tenant FK, allowed kinds and types, size cap, row-level security, grants.
ALTER TABLE school_assets ADD CONSTRAINT school_assets_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE school_assets ADD CONSTRAINT school_assets_kind CHECK (kind IN ('logo', 'emblem', 'stamp', 'signature'));
ALTER TABLE school_assets ADD CONSTRAINT school_assets_type CHECK (content_type IN ('image/png', 'image/jpeg'));
ALTER TABLE school_assets ADD CONSTRAINT school_assets_size CHECK (octet_length(data) <= 409600);

ALTER TABLE school_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON school_assets USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY platform_read ON school_assets FOR SELECT USING (app_platform_read());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mboka_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON school_assets TO mboka_app;
  END IF;
END $$;
