#!/usr/bin/env bash
# Apply every migration to a throwaway local database and run the assertions.
#   supabase/tests/run-local.sh            # apply + assert
#   PGPORT=55432 supabase/tests/run-local.sh
set -euo pipefail

HOST="${PGHOST:-/var/tmp}"
PORT="${PGPORT:-55432}"
DB="${PGDATABASE:-consflow_test}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
psql() { command psql -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 "$@"; }

psql -d postgres -qc "drop database if exists $DB;" -c "create database $DB;"
psql -d "$DB" -qf "$ROOT/supabase/tests/local-bootstrap.sql"

for f in "$ROOT"/supabase/migrations/*.sql; do
  printf '  %s\n' "$(basename "$f")"
  psql -d "$DB" -qf "$f"
done

# Supabase grants these by default; do the same so the assertions exercise RLS
# rather than table privileges.
psql -d "$DB" -qc "
  grant usage on schema public to anon, authenticated, service_role;
  grant all on all tables in schema public to anon, authenticated, service_role;
  grant all on all sequences in schema public to anon, authenticated, service_role;
"

if [ "${SKIP_ASSERTIONS:-}" != "1" ]; then
  psql -d "$DB" -f "$ROOT/supabase/tests/schema_assertions.sql"
fi
