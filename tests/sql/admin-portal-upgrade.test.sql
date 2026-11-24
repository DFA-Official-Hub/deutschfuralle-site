-- Behaviour of 20261125120000_admin_portal_upgrade.sql + 20261125130000_admin_portal_hardening.sql. Run with tests/sql/run.sh (needs a local Postgres).
\set ON_ERROR_STOP 1
-- people: admin A, staff S, plain user U (also a student by email)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'), ('00000000-0000-0000-0000-00000000000b', 'staff@test.local'), ('00000000-0000-0000-0000-00000000000c', 'student@test.local');
insert into public.profiles (id, username, full_name, role) values ('00000000-0000-0000-0000-00000000000a', 'admin1', 'Admin One', 'admin'), ('00000000-0000-0000-0000-00000000000b', 'staff1', 'Staff One', 'user'), ('00000000-0000-0000-0000-00000000000c', 'stud1', 'Stud One', 'user');
insert into public.enrollments (email, full_name, course_code, status, start_date, fee_total, amount_paid) values ('student@test.local', 'TEST Student', 'a1-normal', 'active', '2026-11-01', 25000, 10000);
insert into public.payments (enrollment_id, amount, installment_no) values (1, 10000, 1);  -- amount_paid comes from payments only
insert into public.enrollments (email, full_name, course_code) values ('other@test.local', 'TEST Other', 'b1');
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', u, false);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'email', (select email from auth.users where id = nullif(u, '')::uuid), 'email_verified', true)::text, false);
end $$;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok - %', msg; end $$;

-- 1) admin promotes S to staff; staff cannot change roles
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); set role authenticated;
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-00000000000b';
reset role; select pg_temp.check((select role from public.profiles where username = 'staff1') = 'staff', 'admin can make someone staff');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); set role authenticated;
do $$ begin update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000000b'; raise exception 'staff promoted self'; exception when others then if sqlerrm like 'staff promoted%' then raise; end if; end $$;
reset role; select pg_temp.check((select role from public.profiles where username = 'staff1') = 'staff', 'staff cannot promote themselves');

-- 2) B1/B2: staff get nothing from the raw student/payment/email/audit tables and cannot insert students
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); set role authenticated;
select pg_temp.check((select count(*) from public.enrollments) = 0, 'B2: staff cannot read enrollments directly (lists come from pro_students, masked)');
select pg_temp.check((select count(*) from public.payments) = 0, 'B2: staff cannot read payments directly');
select pg_temp.check((select count(*) from public.email_log) = 0, 'B2: staff cannot read the email log directly');
select pg_temp.check((select count(*) from public.enrollment_audit) = 0, 'B2: staff cannot read enrollment_audit (CNIC/DOB old/new values)');
-- the review's B1 repro: a staff insert with a certificate date and a paid amount. Must now fail.
do $$ begin insert into public.enrollments (email, full_name, course_code, status, certificate_issued_at, fee_total, amount_paid) values ('student@test.local', 'Forged Person', 'a1-normal', 'pending', now(), 25000, 25000); raise exception 'staff inserted'; exception when insufficient_privilege then null; when others then if sqlerrm like 'staff inserted%' then raise; end if; end $$;
do $$ begin insert into public.enrollments (email, full_name, course_code, source) values ('walkin@test.local', 'TEST Walkin', 'a1-normal', 'manual'); raise exception 'staff inserted plain'; exception when insufficient_privilege then null; when others then if sqlerrm like 'staff inserted%' then raise; end if; end $$;
update public.enrollments set status = 'revoked' where full_name = 'TEST Student';
reset role;
select pg_temp.check((select count(*) from public.enrollments where full_name in ('Forged Person', 'TEST Walkin')) = 0, 'B1 repro fails: staff cannot insert any enrollment row');
select pg_temp.check((select status from public.enrollments where full_name = 'TEST Student') = 'active', 'staff cannot revoke (RLS update is admin only)');
-- even the service role (pro_add_student, intake) can't insert a certificate or a paid amount
select pg_temp.as_user(''); set role service_role;
insert into public.enrollments (email, full_name, course_code, status, certificate_issued_at, certificate_revoked_at, fee_total, amount_paid) values ('x@test.local', 'TEST Forged2', 'a1-normal', 'pending', now(), now(), 25000, 25000);
reset role;
select pg_temp.check((select certificate_no is null and certificate_code is null and certificate_issued_at is null and certificate_revoked_at is null from public.enrollments where full_name = 'TEST Forged2'), 'B1: an insert never mints a certificate (certificate_issued_at blanked)');
select pg_temp.check((select amount_paid = 0 and balance_due = 25000 from public.enrollments where full_name = 'TEST Forged2'), 'B1: an insert always starts at amount_paid 0');
select pg_temp.check((select amount_paid from public.enrollments where full_name = 'TEST Student') = 10000, 'amount_paid follows the payments trigger');
delete from public.enrollments where full_name = 'TEST Forged2';

-- 3) student (plain user) sees only own enrollment and none of the staff tables
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c'); set role authenticated;
select pg_temp.check((select count(*) from public.enrollments) = 1, 'student sees only their own enrollment');
select pg_temp.check((select count(*) from public.admin_activity) = 0, 'student cannot read the activity log');
select pg_temp.check((select count(*) from public.student_notes) = 0, 'student cannot read notes');
do $$ begin insert into public.student_notes (enrollment_id, body) values (1, 'x'); raise exception 'student wrote note'; exception when insufficient_privilege then null; when others then if sqlerrm like 'student wrote%' then raise; end if; end $$;
reset role;

-- 4) notes + tags + reminder pause by staff, logged; staff can't mark test; admin can
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); set role authenticated;
insert into public.student_notes (enrollment_id, body) values (1, 'Pays on the 5th');
insert into public.student_meta (enrollment_id, tags, reminders_paused, reminders_paused_until, pause_reason) values (1, array['Urdu ', 'urdu', 'VIP'], true, '2026-12-05', 'Salary on 5th');
do $$ begin update public.student_meta set is_test = true; raise exception 'staff marked test'; exception when others then if sqlerrm like 'staff marked%' then raise; end if; end $$;
reset role;
select pg_temp.check((select tags from public.student_meta) = array['urdu','vip'], 'tags are trimmed, lower-cased and de-duplicated');
select pg_temp.check((select count(*) from public.admin_activity where action in ('note_added','tags','reminders_paused')) = 3, 'note, tags and pause are logged');
select pg_temp.check(not (select is_test from public.student_meta), 'staff cannot mark a record as test');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); set role authenticated;
update public.student_meta set is_test = true;
reset role; select pg_temp.check((select is_test from public.student_meta), 'admin can mark a record as test');

-- 5) batches: admin creates; staff cannot; picking a batch sets batch_code; course/start change keeps the batch code; unassign restores auto code
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); set role authenticated;
do $$ begin insert into public.batches (code, course_code, start_date) values ('A1N-2612', 'a1-normal', '2026-12-01'); raise exception 'staff created batch'; exception when insufficient_privilege then null; when others then if sqlerrm like 'staff created%' then raise; end if; end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); set role authenticated;
insert into public.batches (code, course_code, start_date, time_slot, teacher, capacity) values ('A1N-2612-1830', 'a1-normal', '2026-12-01', '18:30', 'Teacher T', 20);
update public.enrollments set batch_id = (select id from public.batches where code = 'A1N-2612-1830') where full_name = 'TEST Student';
reset role;
select pg_temp.check((select batch_code from public.enrollments where full_name = 'TEST Student') = 'A1N-2612-1830', 'picked batch sets batch_code');
update public.enrollments set start_date = '2026-11-02' where full_name = 'TEST Student';
select pg_temp.check((select batch_code from public.enrollments where full_name = 'TEST Student') = 'A1N-2612-1830', 'batch code survives a start-date change');
update public.batches set code = 'A1N-2612-E' where code = 'A1N-2612-1830';
select pg_temp.check((select batch_code from public.enrollments where full_name = 'TEST Student') = 'A1N-2612-E', 'renaming a batch updates its students');
update public.enrollments set batch_id = null where full_name = 'TEST Student';
select pg_temp.check((select batch_code from public.enrollments where full_name = 'TEST Student') = 'A1N-2611', 'unassigning returns to the automatic course+month code');
select pg_temp.check((select batch_code from public.enrollments where full_name = 'TEST Other') like 'B1-%', 'students without a batch keep the old automatic code');
do $$ begin insert into public.batches (code, course_code, start_date, time_slot) values ('BAD', 'b1', '2026-12-01', '10:00'); raise exception 'bad slot accepted'; exception when check_violation then null; end $$;
update public.enrollments set batch_id = (select id from public.batches where code = 'A1N-2612-E') where full_name = 'TEST Student';

-- 6) attendance by staff + summary %
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); set role authenticated;
insert into public.class_sessions (batch_id, session_date) select id, d::date from public.batches, generate_series('2026-12-01'::date, '2026-12-04'::date, '1 day') d where code = 'A1N-2612-E';
insert into public.attendance (session_id, enrollment_id, status) select s.id, e.id, case when s.session_date = '2026-12-02' then 'absent' when s.session_date = '2026-12-03' then 'excused' else 'present' end
  from public.class_sessions s, (values (1::bigint)) e(id);  -- staff can't read enrollments; the UI gets ids from pro_students
select pg_temp.check((select pct from public.attendance_summary) = 67, 'attendance % = (present+late)/(marked-excused) = 2/3');
update public.attendance set status = 'present' where status = 'absent';
select pg_temp.check((select pct from public.attendance_summary) = 100, 'changing a mark updates the %');
reset role;
select pg_temp.check((select count(*) from public.admin_activity where action = 'attendance') = 2, 'absences and changes are logged');

-- 7) adjustments: browser cannot write; service role can; numbers
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); set role authenticated;
do $$ begin insert into public.fee_adjustments (enrollment_id, kind, amount, reason, approved_by) values (1, 'discount', 1000, 'test', 'Ali'); raise exception 'browser wrote adjustment'; exception when insufficient_privilege then null; end $$;
reset role;
select pg_temp.as_user(''); set role service_role;
insert into public.fee_adjustments (enrollment_id, kind, amount, reason, approved_by) select id, 'refund', 2000, 'Left the course', 'Ali' from public.enrollments where full_name = 'TEST Student';
reset role;
select pg_temp.check((select receipt_no from public.fee_adjustments) ~ '^RF-\d{4}-0001$', 'refund gets an RF- receipt number');

-- 8) activity visibility: staff read none of it directly (pro_activity serves them), admin sees all
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); set role authenticated;
select pg_temp.check((select count(*) from public.admin_activity) = 0, 'B2: staff cannot read admin_activity directly');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); set role authenticated;
select pg_temp.check((select count(*) from public.admin_activity where action like 'batch_%') >= 2, 'admin sees batch entries');
select pg_temp.check((select count(*) from public.account_meta) = 0, 'admin can read account_meta');
reset role;
select pg_temp.check((select value from public.site_settings where key = 'reminder_offsets') = '-3,0,3', 'default reminder schedule -3,0,+3 days');

-- 9) attendance deletes: staff can't, admin can and it is logged (one line for a whole class)
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); set role authenticated;
delete from public.attendance; delete from public.class_sessions;
reset role;
select pg_temp.check((select count(*) from public.attendance) = 4 and (select count(*) from public.class_sessions) = 4, 'staff cannot delete attendance or classes');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); set role authenticated;
delete from public.attendance where session_id = (select id from public.class_sessions where session_date = '2026-12-04');
delete from public.class_sessions where session_date = '2026-12-03';
reset role;
select pg_temp.check((select count(*) from public.admin_activity where action = 'attendance_deleted' and enrollment_id = 1 and summary like 'Attendance mark (present) on 04 Dec 2026%') = 1, 'deleting a mark is logged on the student');
select pg_temp.check((select count(*) from public.admin_activity where action = 'attendance_deleted' and summary like 'Class of 03 Dec 2026 in batch A1N-2612-E deleted (1 attendance marks)') = 1
  and (select count(*) from public.admin_activity where action = 'attendance_deleted') = 2, 'deleting a class is logged once with its mark count');

-- 10) refunds never exceed what was paid (2000 already refunded of 10000 paid)
select pg_temp.as_user(''); set role service_role;
do $$ begin insert into public.fee_adjustments (enrollment_id, kind, amount, reason, approved_by) values (1, 'refund', 8001, 'too much', 'Ali'); raise exception 'over-refund accepted'; exception when check_violation then null; end $$;
insert into public.fee_adjustments (enrollment_id, kind, amount, reason, approved_by) values (1, 'refund', 8000, 'rest', 'Ali');
reset role;
select pg_temp.check((select sum(amount) from public.fee_adjustments where kind = 'refund') = 10000, 'refund up to the net paid is accepted, one rupee more is refused');

-- 11) discount: record + fee change in one call; stale data refuses both; void once, restores fee and plan
select pg_temp.as_user(''); set role service_role;
update public.enrollments set installment_plan = '[{"amount":10000,"due":"2026-11-01"},{"amount":10000,"due":"2026-12-01"},{"amount":5000,"due":"2027-01-01"}]' where id = 1;
do $$ begin perform public.fee_adjust_apply('{"enrollment_id":1,"kind":"discount","amount":5000,"reason":"stale","approved_by":"Ali"}', 24000, 10000, null, '{"fee_total":19000}'); raise exception 'stale discount applied'; exception when serialization_failure then null; end $$;
select public.fee_adjust_apply('{"enrollment_id":1,"kind":"discount","amount":15000,"reason":"Hardship","approved_by":"Ali"}', 25000, 10000,
  (select installment_plan from public.enrollments where id = 1), '{"fee_total":10000,"installment_plan":null,"due_date":null,"reminder_stage":3,"payment_plan":"full"}');
reset role;
select pg_temp.check((select count(*) from public.fee_adjustments where kind = 'discount') = 1 and (select reason from public.fee_adjustments where kind = 'discount') = 'Hardship', 'stale discount wrote nothing; fresh one wrote exactly one record');
select pg_temp.check((select fee_total = 10000 and installment_plan is null from public.enrollments where id = 1), 'discount record and fee change land together');
select pg_temp.check((select jsonb_array_length(plan_before) = 3 and plan_after is null and fee_before = 25000 and fee_after = 10000 from public.fee_adjustments where kind = 'discount'), 'discount keeps the plan it removed (plan_before)');
select pg_temp.as_user(''); set role service_role;
select public.fee_adjust_void((select id from public.fee_adjustments where kind = 'discount'), 'Wrong student', 10000, null,
  jsonb_build_object('fee_total', 25000, 'installment_plan', (select plan_before from public.fee_adjustments where kind = 'discount'), 'due_date', '2026-12-01', 'reminder_stage', 0));
do $$ begin perform public.fee_adjust_void((select id from public.fee_adjustments where kind = 'discount'), 'again', 25000, null, '{"fee_total":40000}'); raise exception 'double void'; exception when raise_exception then if sqlerrm not like 'DFA: already void%' then raise; end if; end $$;
reset role;
select pg_temp.check((select fee_total = 25000 and jsonb_array_length(installment_plan) = 3 from public.enrollments where id = 1), 'void restores the fee and the removed installment plan');
select pg_temp.check((select voided_at is not null from public.fee_adjustments where kind = 'discount'), 'second void is refused and changes nothing');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); set role authenticated;
do $$ begin perform public.fee_adjust_apply('{"enrollment_id":1,"kind":"refund","amount":1,"reason":"x","approved_by":"Al"}', null, null, null, null); raise exception 'browser called rpc'; exception when insufficient_privilege then null; end $$;
reset role;
select pg_temp.check(not has_function_privilege('authenticated', 'public.fee_adjust_apply(jsonb,integer,integer,jsonb,jsonb)', 'execute') and not has_function_privilege('anon', 'public.fee_adjust_void(bigint,text,integer,jsonb,jsonb)', 'execute'), 'adjustment functions are service-role only');

-- 12) last admin can't be demoted; private helpers not callable by API roles; staff payments default off
do $$ begin update public.profiles set role = 'user' where username = 'admin1'; raise exception 'last admin demoted'; exception when raise_exception then if sqlerrm not like 'DFA: At least one admin%' then raise; end if; end $$;
update public.profiles set role = 'admin' where username = 'stud1';
update public.profiles set role = 'user' where username = 'stud1';
select pg_temp.check((select count(*) from public.profiles where role = 'admin') = 1 and (select role from public.profiles where username = 'admin1') = 'admin', 'last admin stays; a second admin can be demoted');
select pg_temp.check(not has_function_privilege('anon', 'private.actor_name(uuid)', 'execute') and not has_function_privilege('authenticated', 'private.actor_name(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.log_activity(bigint,text,text,jsonb)', 'execute'), 'actor_name/log_activity not executable by anon/authenticated');
select pg_temp.check((select value from public.site_settings where key = 'staff_payments') = 'off', 'staff payment recording defaults to off');
