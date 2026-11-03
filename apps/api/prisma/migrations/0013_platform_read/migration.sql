-- Phase 7: read-only platform scope for the super-admin console.
-- A transaction that sets app.platform = 'on' (PrismaService.platform(), used only behind @PlatformAdmin())
-- may READ every tenant's rows, so the console can count and list across schools. It grants no write:
-- changes to a school still run inside that school's own tenant scope.

CREATE OR REPLACE FUNCTION app_platform_read() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT current_setting('app.platform', true) = 'on' $$;

-- Every table under row-level security today gets the same SELECT policy. Tables added later must add it
-- in their own migration if the console needs them (see docs/architecture.md).
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  LOOP
    EXECUTE format('CREATE POLICY platform_read ON %I FOR SELECT USING (app_platform_read())', t);
  END LOOP;
END $$;
