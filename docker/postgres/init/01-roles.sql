-- Runs once when the local Postgres volume is first created.
-- The API connects as mboka_app: not the table owner, not a superuser,
-- so Row-Level Security policies are always enforced against it.
CREATE ROLE mboka_app LOGIN PASSWORD 'mboka_app_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE mboka TO mboka_app;
GRANT USAGE ON SCHEMA public TO mboka_app;
