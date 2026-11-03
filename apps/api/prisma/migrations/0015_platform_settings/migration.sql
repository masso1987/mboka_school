-- Phase 7: platform settings (maintenance, session security, branding), legal documents, messages to schools.
-- These are platform tables with no tenant: no row-level security; only platform routes write them.

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "maintenance" JSONB NOT NULL DEFAULT '{}',
    "security" JSONB NOT NULL DEFAULT '{}',
    "branding" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_documents" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "published_by" UUID,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_messages" (
    "id" UUID NOT NULL,
    "audience" TEXT NOT NULL,
    "tenant_id" UUID,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sent_by" UUID NOT NULL,
    "recipients" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "legal_documents_kind_locale_version_key" ON "legal_documents"("kind", "locale", "version");

-- CreateIndex
CREATE INDEX "platform_messages_created_at_idx" ON "platform_messages"("created_at");

-- Hand-written: one settings row, valid kinds, references, append-only history.
ALTER TABLE platform_settings ADD CONSTRAINT platform_settings_single_row CHECK (id = 1);
INSERT INTO platform_settings (id, updated_at) VALUES (1, now());
ALTER TABLE legal_documents ADD CONSTRAINT legal_documents_kind CHECK (kind IN ('terms', 'privacy', 'notice'));
ALTER TABLE legal_documents ADD CONSTRAINT legal_documents_version CHECK (version > 0);
ALTER TABLE platform_messages ADD CONSTRAINT platform_messages_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mboka_app') THEN
    GRANT SELECT, UPDATE ON platform_settings TO mboka_app;
    -- Published legal versions and sent messages are history: never updated or deleted.
    GRANT SELECT, INSERT ON legal_documents, platform_messages TO mboka_app;
  END IF;
END $$;
