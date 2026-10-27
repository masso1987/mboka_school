#!/bin/sh
# Runs once, when the production volume is first created. Same role as docker/postgres/init/01-roles.sql,
# with the password taken from the environment instead of a development constant.
set -eu
psql -v ON_ERROR_STOP=1 -v app_password="$APP_DB_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE mboka_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE mboka TO mboka_app;
GRANT USAGE ON SCHEMA public TO mboka_app;
SQL
