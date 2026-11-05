-- Optional services billed per pupil (bus, canteen, uniform…) and each class's book list for the year.
-- AlterTable
ALTER TABLE "fee_schedules" ADD COLUMN "is_optional" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "book_list_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "level_id" UUID,
    "class_id" UUID,
    "subject" TEXT,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "publisher" TEXT,
    "isbn" TEXT,
    "price" DECIMAL(18,2),
    "currency" CHAR(3) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "book_list_items_tenant_id_id_key" ON "book_list_items"("tenant_id", "id");
CREATE INDEX "book_list_items_tenant_id_academic_year_id_idx" ON "book_list_items"("tenant_id", "academic_year_id");

-- Hand-written: composite tenant FKs, value checks, row-level security, grants.
ALTER TABLE book_list_items ADD CONSTRAINT book_list_items_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE book_list_items ADD CONSTRAINT book_list_items_year_fkey FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic_years(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE book_list_items ADD CONSTRAINT book_list_items_level_fkey FOREIGN KEY (tenant_id, level_id) REFERENCES education_levels(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE book_list_items ADD CONSTRAINT book_list_items_class_fkey FOREIGN KEY (tenant_id, class_id) REFERENCES classes(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE book_list_items ADD CONSTRAINT book_list_items_single_scope CHECK (level_id IS NULL OR class_id IS NULL);
ALTER TABLE book_list_items ADD CONSTRAINT book_list_items_price CHECK (price IS NULL OR price >= 0);

DO $$
BEGIN
  ALTER TABLE book_list_items ENABLE ROW LEVEL SECURITY;
  ALTER TABLE book_list_items FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON book_list_items USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
  CREATE POLICY platform_read ON book_list_items FOR SELECT USING (app_platform_read());
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mboka_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON book_list_items TO mboka_app;
  END IF;
END $$;
