-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('ANNUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'UNPAID', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Audience" AS ENUM ('ALL', 'STAFF', 'GUARDIANS', 'STUDENTS', 'CLASS');

-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

















































































-- AlterTable
ALTER TABLE "guardians" ADD COLUMN     "membership_id" UUID;

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "membership_id" UUID;

-- CreateTable
CREATE TABLE "employment_contracts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "type" "EmploymentType" NOT NULL,
    "position" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employment_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compensations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "base_salary" DECIMAL(18,2) NOT NULL,
    "allowances" JSONB NOT NULL DEFAULT '[]',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compensations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "type" "LeaveType" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'REQUESTED',
    "requested_by" UUID NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_entitlements" (
    "tenant_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "days" INTEGER NOT NULL,

    CONSTRAINT "leave_entitlements_pkey" PRIMARY KEY ("tenant_id","staff_id","year")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "Audience" NOT NULL,
    "class_id" UUID,
    "author_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "dedupe_key" TEXT,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "channel" "DeliveryChannel" NOT NULL,
    "destination" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employment_contracts_tenant_id_staff_id_idx" ON "employment_contracts"("tenant_id", "staff_id");

-- CreateIndex
CREATE INDEX "compensations_tenant_id_staff_id_idx" ON "compensations"("tenant_id", "staff_id");

-- CreateIndex
CREATE INDEX "leave_requests_tenant_id_staff_id_idx" ON "leave_requests"("tenant_id", "staff_id");

-- CreateIndex
CREATE INDEX "announcements_tenant_id_published_at_idx" ON "announcements"("tenant_id", "published_at");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_user_id_read_at_idx" ON "notifications"("tenant_id", "user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenant_id_user_id_dedupe_key_key" ON "notifications"("tenant_id", "user_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenant_id_id_key" ON "notifications"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "notification_deliveries_tenant_id_status_idx" ON "notification_deliveries"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "guardians_membership_id_key" ON "guardians"("membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_membership_id_key" ON "students"("membership_id");

-- AddForeignKey
ALTER TABLE "employment_contracts" ADD CONSTRAINT "employment_contracts_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compensations" ADD CONSTRAINT "compensations_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_entitlements" ADD CONSTRAINT "leave_entitlements_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_tenant_id_notification_id_fkey" FOREIGN KEY ("tenant_id", "notification_id") REFERENCES "notifications"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ======================================================================
-- Hand-written part of 0007: tenant isolation, composite FKs for portal
-- accounts, confidentiality of compensation and leave invariants.
-- ======================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employment_contracts', 'compensations', 'leave_requests', 'leave_entitlements',
    'announcements', 'notifications', 'notification_deliveries'
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

-- Portal accounts stay inside the school.
ALTER TABLE guardians ADD CONSTRAINT guardians_membership_tenant_fkey
  FOREIGN KEY (tenant_id, membership_id) REFERENCES user_tenant_memberships (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE students ADD CONSTRAINT students_membership_tenant_fkey
  FOREIGN KEY (tenant_id, membership_id) REFERENCES user_tenant_memberships (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE announcements ADD CONSTRAINT announcements_class_tenant_fkey
  FOREIGN KEY (tenant_id, class_id) REFERENCES classes (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE announcements ADD CONSTRAINT announcements_class_audience CHECK ((audience = 'CLASS') = (class_id IS NOT NULL));

ALTER TABLE employment_contracts ADD CONSTRAINT employment_contracts_dates CHECK (end_date IS NULL OR end_date >= start_date);
ALTER TABLE compensations ADD CONSTRAINT compensations_salary_non_negative CHECK (base_salary >= 0);
ALTER TABLE compensations ADD CONSTRAINT compensations_currency_fkey FOREIGN KEY (currency) REFERENCES currencies(code);
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_dates CHECK (end_date >= start_date AND days > 0);
ALTER TABLE leave_entitlements ADD CONSTRAINT leave_entitlements_days CHECK (days >= 0);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mboka_app') THEN
    GRANT SELECT, INSERT, UPDATE ON employment_contracts, leave_requests, notifications, notification_deliveries TO mboka_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON leave_entitlements, announcements TO mboka_app;
    -- Salary history is never rewritten: a change is a new row.
    GRANT SELECT, INSERT ON compensations TO mboka_app;
  END IF;
END $$;
