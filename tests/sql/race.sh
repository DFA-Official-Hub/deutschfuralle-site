#!/usr/bin/env bash
# Concurrency checks for 20261125130000 (two sessions at the same moment). Called by tests/sql/run.sh with DB set.
set -uo pipefail
P="psql -X -q -At -v ON_ERROR_STOP=1 -d $DB"
fail() { echo "FAIL: $1"; exit 1; }
$P -c "insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1','r1@t.l'),('00000000-0000-0000-0000-0000000000a2','r2@t.l');
insert into public.profiles (id, username, role) values ('00000000-0000-0000-0000-0000000000a1','race1','admin'),('00000000-0000-0000-0000-0000000000a2','race2','admin');
insert into public.enrollments (email, full_name, course_code, status, fee_total) values ('race@t.l','TEST Race','a1-normal','active',25000);" >/dev/null
EID=$($P -c "select id from public.enrollments where full_name='TEST Race'")
$P -c "insert into public.payments (enrollment_id, amount, installment_no) values ($EID, 10000, 1)" >/dev/null

# 1) two refunds of 6000 each against 10000 paid: exactly one may succeed
$P -c "begin; insert into public.fee_adjustments (enrollment_id, kind, amount, reason, approved_by) values ($EID,'refund',6000,'race A','Ali'); select pg_sleep(1.5); commit;" >/dev/null 2>&1 &
sleep 0.4
$P -c "insert into public.fee_adjustments (enrollment_id, kind, amount, reason, approved_by) values ($EID,'refund',6000,'race B','Ali')" >/dev/null 2>&1; B=$?
wait
N=$($P -c "select count(*) from public.fee_adjustments where enrollment_id=$EID and kind='refund'")
[ "$N" = "1" ] && [ "$B" != "0" ] || fail "concurrent refunds: $N recorded (want 1)"
echo "ok - two refunds at the same moment can't exceed what was paid"

# 2) two admins demote each other at the same moment (plus the test file's admin is in another DB): one must stay
$P -c "update public.profiles set role='user' where role='admin' and username not in ('race1','race2')" >/dev/null 2>&1
$P -c "begin; update public.profiles set role='user' where username='race1'; select pg_sleep(1.5); commit;" >/dev/null 2>&1 &
sleep 0.4
$P -c "update public.profiles set role='user' where username='race2'" >/dev/null 2>&1
wait
A=$($P -c "select count(*) from public.profiles where role='admin'")
[ "$A" = "1" ] || fail "concurrent demotions left $A admins (want 1)"
echo "ok - two admins demoted at the same moment still leave one admin"

# 3) the same discount voided twice at the same moment: fee goes back up only once
$P -c "select public.fee_adjust_apply(jsonb_build_object('enrollment_id',$EID,'kind','discount','amount',3000,'reason','race disc','approved_by','Ali'), 25000, 10000, null, '{\"fee_total\":22000}')" >/dev/null
AID=$($P -c "select id from public.fee_adjustments where enrollment_id=$EID and kind='discount'")
$P -c "begin; select public.fee_adjust_void($AID,'v1',22000,null,'{\"fee_total\":25000}'); select pg_sleep(1.5); commit;" >/dev/null 2>&1 &
sleep 0.4
$P -c "select public.fee_adjust_void($AID,'v2',22000,null,'{\"fee_total\":25000}')" >/dev/null 2>&1
wait
F=$($P -c "select fee_total from public.enrollments where id=$EID")
[ "$F" = "25000" ] || fail "double void: fee $F (want 25000)"
echo "ok - a discount voided twice at the same moment is restored once"
