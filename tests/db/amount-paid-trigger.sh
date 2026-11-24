#!/usr/bin/env bash
# Runs the 20261125090000 migration twice on a throwaway local Postgres 17 and checks the amount_paid trigger,
# including two corrections at the same moment. Needs postgresql-17 (initdb). Usage: bash tests/db/amount-paid-trigger.sh
set -euo pipefail
P=/usr/lib/postgresql/17/bin; D=$(mktemp -d); PORT=${PGPORT_TEST:-55499}
M="$(cd "$(dirname "$0")/../.." && pwd)/supabase/migrations/20261125090000_student_info_payment_corrections.sql"
$P/initdb -D "$D" -U postgres -A trust >/dev/null; $P/pg_ctl -D "$D" -o "-p $PORT -k /tmp -c listen_addresses=" -l "$D/log" start >/dev/null; trap '$P/pg_ctl -D "$D" stop >/dev/null; rm -rf "$D"' EXIT; sleep 1
Q="psql -h /tmp -p $PORT -U postgres -v ON_ERROR_STOP=1 -qAt"
$Q -c "create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create schema private; create function private.is_admin() returns boolean language sql as 'select true';
create table public.enrollments(id bigint generated always as identity primary key, email text, fee_total int, amount_paid int, balance_due int generated always as (greatest(coalesce(fee_total,0)-coalesce(amount_paid,0),0)) stored);
create table public.payments(id bigint generated always as identity primary key, enrollment_id bigint references public.enrollments(id), amount int, installment_no int);"
$Q -f "$M" >/dev/null 2>&1; $Q -f "$M" >/dev/null 2>&1; echo "migration ran twice: ok"
chk() { local got; got=$($Q -c "$1"); [ "$got" = "$2" ] || { echo "FAIL: $1 -> $got (want $2)"; exit 1; }; echo "ok: $3"; }
$Q -c "insert into enrollments(email,fee_total,amount_paid) values('s@x',25000,7); insert into payments(enrollment_id,amount,installment_no) values(1,7,1);"
chk "select amount_paid||'/'||balance_due from enrollments" "7/24993" "activate"
$Q -c "insert into payments(enrollment_id,amount,installment_no) values(1,5000,2);"
chk "with u as (update enrollments set amount_paid=5007 where id=1 and amount_paid<=5007 returning 1) select count(*) from u" "1" "record_payment's guarded update still matches"
$Q -c "update payments set amount=6500 where id=1;"; chk "select amount_paid from enrollments" "11500" "correction"
$Q -c "update payments set voided_at=now() where id=2;"; chk "select amount_paid||'/'||balance_due from enrollments" "6500/18500" "void"
$Q -c "delete from payments where id=2; insert into payments(enrollment_id,amount,installment_no) values(1,1000,3);"
$Q -c "begin; update payments set amount=7000 where id=1; select pg_sleep(2); commit;" >/dev/null & sleep 0.5
$Q -c "begin; update payments set amount=2000 where id=3; commit;"; wait
chk "select amount_paid from enrollments" "9000" "two corrections at the same moment"
chk "select has_function_privilege('authenticated','private.sync_amount_paid()','execute')" "f" "trigger function not callable by users"
echo "amount-paid-trigger: OK"
