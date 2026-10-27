-- Tenant isolation, defense in depth (spec §6.4, ADR 0001).
-- The API connects as the non-owner role `mboka_app`; every request runs inside a
-- transaction that sets app.tenant_id / app.user_id with set_config(..., true).
-- When the settings are absent, the helper functions return NULL and policies match nothing.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- Tables whose rows belong strictly to one tenant.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'subscriptions', 'campuses', 'roles', 'role_permissions',
    'user_role_assignments', 'academic_years'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t
    );
  END LOOP;
END $$;

-- Memberships: visible inside the current tenant, or to the user they belong to
-- (needed to list "my schools" before a tenant is chosen). Writes need tenant context.
ALTER TABLE user_tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tenant_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_read ON user_tenant_memberships FOR SELECT
  USING (tenant_id = app_current_tenant() OR user_id = app_current_user());
CREATE POLICY membership_write ON user_tenant_memberships FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY membership_update ON user_tenant_memberships FOR UPDATE
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- Audit log: tenant events readable only inside the tenant; platform events (tenant_id NULL)
-- are written without tenant context and read only through the owner role.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON audit_logs FOR SELECT USING (tenant_id = app_current_tenant());
CREATE POLICY audit_insert ON audit_logs FOR INSERT
  WITH CHECK (tenant_id IS NULL OR tenant_id = app_current_tenant());

-- Academic years of one tenant must not overlap (ACA-003).
ALTER TABLE academic_years
  ADD CONSTRAINT academic_years_no_overlap
  EXCLUDE USING gist (tenant_id WITH =, daterange(start_date, end_date, '[]') WITH &&);
ALTER TABLE academic_years
  ADD CONSTRAINT academic_years_dates_ordered CHECK (end_date > start_date);

-- Grants for the runtime role, when it exists (created by docker/postgres/init or ops).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mboka_app') THEN
    GRANT USAGE ON SCHEMA public TO mboka_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mboka_app;
    REVOKE ALL ON TABLE _prisma_migrations FROM mboka_app;
    -- Audit records are append-only for the application.
    REVOKE UPDATE, DELETE ON TABLE audit_logs FROM mboka_app;
    -- The permission catalogue is maintained by migrations/seed only.
    REVOKE INSERT, UPDATE, DELETE ON TABLE permissions FROM mboka_app;
    GRANT EXECUTE ON FUNCTION app_current_tenant(), app_current_user() TO mboka_app;
  END IF;
END $$;
