#!/usr/bin/env bash
# Applies the stub schema + admin migrations to a throwaway local database (twice, to prove they are re-runnable) and runs the SQL tests.
# Usage: PGHOST=/tmp PGPORT=55432 PGUSER=postgres tests/sql/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=dfa_admin_test_$$
createdb "$DB"; trap 'dropdb --if-exists "$DB"' EXIT
P="psql -X -q -v ON_ERROR_STOP=1 -d $DB"
$P -f tests/sql/stub-schema.sql >/dev/null 2>&1 || $P -f tests/sql/stub-schema.sql
for m in supabase/migrations/20261121120000_custom_installment_plan.sql supabase/migrations/20261125090000_student_info_payment_corrections.sql supabase/migrations/20261125120000_admin_portal_upgrade.sql supabase/migrations/20261125130000_admin_portal_hardening.sql supabase/migrations/20261125140000_payment_refund_guard.sql supabase/migrations/20261125150000_admin_portal_grants.sql supabase/migrations/20261125160000_admin_portal_grants_defaults.sql; do
  $P -f "$m" >/dev/null 2>&1 || $P -f "$m"
  $P -f "$m" >/dev/null 2>&1 || { echo "not re-runnable: $m"; $P -f "$m"; exit 1; }
done
out=$($P -f tests/sql/admin-portal-upgrade.test.sql 2>&1) || { echo "$out" | grep -v '^$' | sed 's/^psql:[^ ]* //'; exit 1; }
echo "$out" | sed -n 's/.*NOTICE:  //p'
DB=$DB bash tests/sql/race.sh || exit 1
echo "SQL tests passed"
