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

-- 1b) promoting to staff creates an all-off permissions row; staff cannot write the table; staff_can is false until flags are on
select pg_temp.check((select count(*) from public.staff_permissions where user_id = '00000000-0000-0000-0000-00000000000b') = 1
  and not (select view_students or see_contacts or edit_student_info or add_students or record_payments or open_payment_slips or discounts_refunds or batches or attendance or notes_tags or reminders or documents_emails or export or view_activity or disabled from public.staff_permissions where user_id = '00000000-0000-0000-0000-00000000000b'),
  'new staff start with every permission off');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); set role authenticated;
select pg_temp.check((select count(*) from public.staff_permissions) = 1, 'staff can read their own permissions row');
select pg_temp.check(not private.staff_can('notes_tags') and not private.staff_can('attendance') and not private.staff_can('view_students') and not private.staff_can('no_such_perm'), 'staff_can is false when flags are off');
do $$ begin insert into public.student_notes (enrollment_id, body) values (1, 'should fail'); raise exception 'all-off staff wrote a note'; exception when insufficient_privilege then null; when others then if sqlerrm like 'all-off%' then raise; end if; end $$;
do $$ begin insert into public.student_meta (enrollment_id, tags) values (1, array['x']); raise exception 'all-off staff wrote meta'; exception when insufficient_privilege then null; when others then if sqlerrm like 'all-off%' then raise; end if; end $$;
do $$ begin insert into public.class_sessions (batch_id, session_date) values (1, '2026-12-01'); raise exception 'all-off staff wrote a class'; exception when insufficient_privilege then null; when others then if sqlerrm like 'all-off%' then raise; end if; end $$;
do $$ begin update public.staff_permissions set view_students = true; raise exception 'staff wrote permissions'; exception when insufficient_privilege then null; when others then if sqlerrm like 'staff wrote%' then raise; end if; end $$;
reset role;
select pg_temp.check(has_table_privilege('authenticated', 'public.staff_permissions', 'SELECT')
  and not has_table_privilege('authenticated', 'public.staff_permissions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.staff_permissions', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.staff_permissions', 'DELETE')
  and not has_table_privilege('authenticated', 'public.staff_permissions', 'TRUNCATE')
  and not has_table_privilege('anon', 'public.staff_permissions', 'SELECT'), 'staff_permissions: authenticated may only SELECT; anon nothing');
-- existing tests 4 and 6 still describe a staff member who has notes, reminders and attendance
update public.staff_permissions set notes_tags = true, reminders = true, attendance = true, view_students = true, batches = true
  where user_id = '00000000-0000-0000-0000-00000000000b';

-- 2) B1/B2: staff get nothing from the raw student/payment/email/audit tables and cannot insert students
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); set role authenticated;
select pg_temp.check((select count(*) from public.enrollments) = 0, 'B2: staff cannot read enrollments directly (lists come from pro_students, masked)');
select pg_temp.check((select count(*) from public.payments) = 0, 'B2: staff cannot read payments directly');
select pg_temp.check((select count(*) from public.email_log) = 0, 'B2: staff cannot read the email log directly');
do $$ declare n bigint; begin
  begin execute 'select count(*) from public.enrollment_audit' into n; exception when insufficient_privilege then n := 0; end;  -- production: no grant at all
  perform pg_temp.check(n = 0, 'B2: staff cannot read enrollment_audit (CNIC/DOB old/new values)');
end $$;
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
do $$ begin update public.student_meta set is_test = true; raise exception 'admin marked test directly'; exception when others then if sqlerrm like 'admin marked%' then raise; end if; end $$;
reset role; select pg_temp.check(not (select is_test from public.student_meta), 'QA2: even an admin cannot flip is_test from the browser (typed Student ID confirm is server-side)');
select pg_temp.as_user(''); set role service_role;
select public.set_test_mark(1, true, '00000000-0000-0000-0000-00000000000a', 'QA');
reset role; select pg_temp.check((select is_test from public.student_meta), 'admin can mark a record as test (through set_test_mark)');

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

-- 13) R2-1: a payment can't be voided or lowered below live refunds (fresh student: 10,000 paid, 4,000 refunded)
insert into public.enrollments (email, full_name, course_code, status, fee_total) values ('guard@test.local', 'TEST Guard', 'a1-normal', 'active', 25000);
insert into public.payments (enrollment_id, amount, installment_no) select id, 10000, 1 from public.enrollments where full_name = 'TEST Guard';
insert into public.fee_adjustments (enrollment_id, kind, amount, reason, approved_by) select id, 'refund', 4000, 'Left early', 'Ali' from public.enrollments where full_name = 'TEST Guard';
do $$ begin update public.payments set voided_at = now() where enrollment_id = (select id from public.enrollments where full_name = 'TEST Guard'); raise exception 'void passed'; exception when check_violation then if sqlerrm <> 'This payment has refunds against it. Void the refund first.' then raise; end if; end $$;
select pg_temp.check((select voided_at is null from public.payments where enrollment_id = (select id from public.enrollments where full_name = 'TEST Guard')), 'R2-1: voiding a payment with live refunds is blocked');
do $$ begin update public.payments set amount = 3000 where enrollment_id = (select id from public.enrollments where full_name = 'TEST Guard'); raise exception 'lower passed'; exception when check_violation then null; end $$;
select pg_temp.check((select amount from public.payments where enrollment_id = (select id from public.enrollments where full_name = 'TEST Guard')) = 10000, 'R2-1: lowering the payment to 3,000 (below 4,000 refunded) is blocked');
update public.payments set amount = 5000 where enrollment_id = (select id from public.enrollments where full_name = 'TEST Guard');
select pg_temp.check((select amount_paid from public.enrollments where full_name = 'TEST Guard') = 5000, 'R2-1: lowering the payment to 5,000 (still above refunds) is allowed');
update public.fee_adjustments set voided_at = now(), void_reason = 'entered by mistake' where enrollment_id = (select id from public.enrollments where full_name = 'TEST Guard');
update public.payments set voided_at = now() where enrollment_id = (select id from public.enrollments where full_name = 'TEST Guard');
select pg_temp.check((select amount_paid from public.enrollments where full_name = 'TEST Guard') = 0, 'R2-1: after voiding the refund, the payment can be voided');

-- 14) privileges match production (no default grants): the signed-in role can reach the portal tables, anon can't
select pg_temp.check(has_table_privilege('authenticated', 'public.batches', 'SELECT,INSERT,UPDATE,DELETE')
  and has_table_privilege('authenticated', 'public.class_sessions', 'SELECT,INSERT,UPDATE,DELETE')
  and has_table_privilege('authenticated', 'public.attendance', 'SELECT,INSERT,UPDATE,DELETE')
  and has_table_privilege('authenticated', 'public.student_notes', 'SELECT,INSERT,UPDATE,DELETE')
  and has_table_privilege('authenticated', 'public.student_meta', 'SELECT,INSERT,UPDATE')
  and has_table_privilege('authenticated', 'public.fee_adjustments', 'SELECT')
  and has_table_privilege('authenticated', 'public.admin_activity', 'SELECT')
  and has_table_privilege('authenticated', 'public.account_meta', 'SELECT'), 'grants: authenticated can use the portal tables (RLS decides rows)');
select pg_temp.check(not has_table_privilege('authenticated', 'public.fee_adjustments', 'INSERT') and not has_table_privilege('authenticated', 'public.admin_activity', 'INSERT')
  and not has_table_privilege('authenticated', 'public.account_meta', 'UPDATE') and not has_table_privilege('authenticated', 'public.student_meta', 'DELETE'), 'grants: function-only tables stay read-only for the browser');
select pg_temp.check(not has_table_privilege('anon', 'public.batches', 'SELECT') and not has_table_privilege('anon', 'public.student_notes', 'SELECT') and not has_table_privilege('anon', 'public.fee_adjustments', 'SELECT'), 'grants: anon gets nothing');

-- 15) R4-1: MAINTAIN revoked; new tables get DML grants; every authenticated RLS policy has a matching grant
select pg_temp.check(not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and (has_table_privilege('authenticated', c.oid, 'MAINTAIN') or has_table_privilege('anon', c.oid, 'MAINTAIN'))
  ), 'R4-1: MAINTAIN is revoked on every public table for authenticated and anon');
select pg_temp.check(has_table_privilege('authenticated', 'public.enrollment_audit', 'SELECT')
  and not has_table_privilege('authenticated', 'public.enrollment_audit', 'INSERT')
  and not has_table_privilege('anon', 'public.enrollment_audit', 'SELECT'), 'R4-1: enrollment_audit SELECT matches its admin policy; anon gets nothing');
create table public._grant_probe (id int primary key);
select pg_temp.check(has_table_privilege('authenticated', 'public._grant_probe', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('anon', 'public._grant_probe', 'SELECT')
  and not has_table_privilege('authenticated', 'public._grant_probe', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public._grant_probe', 'MAINTAIN')
  and not has_table_privilege('authenticated', 'public._grant_probe', 'REFERENCES')
  and not has_table_privilege('authenticated', 'public._grant_probe', 'TRIGGER'), 'R4-1: a new public table gets DML grants for authenticated, not TRUNCATE/MAINTAIN/REFERENCES/TRIGGER, and nothing for anon');
drop table public._grant_probe;
do $$
declare privs text;
begin
  select string_agg(e.privilege_type, ',' order by e.privilege_type) into privs
    from pg_default_acl d
    join pg_roles r on r.oid = d.defaclrole
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) e
    join pg_roles g on g.oid = e.grantee
   where r.rolname = 'postgres' and n.nspname = 'public' and d.defaclobjtype = 'r' and g.rolname = 'authenticated';
  perform pg_temp.check(privs = 'DELETE,INSERT,SELECT,UPDATE', 'R4-1: postgres default table ACL for authenticated is exactly DELETE,INSERT,SELECT,UPDATE (was ' || coalesce(privs, 'none') || ')');
  select string_agg(e.privilege_type, ',' order by e.privilege_type) into privs
    from pg_default_acl d
    join pg_roles r on r.oid = d.defaclrole
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) e
    join pg_roles g on g.oid = e.grantee
   where r.rolname = 'postgres' and n.nspname = 'public' and d.defaclobjtype = 'r' and g.rolname = 'anon';
  perform pg_temp.check(privs is null, 'R4-1: postgres default table ACL for anon is empty');
end $$;
do $$
declare r record; missing text := '';
begin
  for r in
    select p.tablename, p.cmd
      from pg_policies p
     where p.schemaname = 'public'
       and ('authenticated' = any (p.roles) or 'public' = any (p.roles))
     group by 1, 2
  loop
    if not has_table_privilege('authenticated', format('public.%I', r.tablename), r.cmd) then
      missing := missing || r.tablename || '.' || r.cmd || ' ';
    end if;
  end loop;
  perform pg_temp.check(missing = '', 'R4-1: every authenticated RLS policy has a matching grant' || case when missing = '' then '' else ': ' || missing end);
end $$;
do $$
declare off text := '';
begin
  select string_agg(c.relname, ', ' order by c.relname) into off
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  perform pg_temp.check(coalesce(off, '') = '', 'R5: every public table has RLS on' || case when coalesce(off, '') = '' then '' else ': ' || off end);
end $$;

-- 16) R4-1: deleting a TEST enrollment that has notes and attendance succeeds (cascade must not write admin_activity against the deleted row)
insert into public.enrollments (email, full_name, course_code, status, fee_total) values ('deltest@test.local', 'TEST DeleteCascade', 'a1-normal', 'active', 25000);
select pg_temp.as_user(''); select public.set_test_mark(id, true, null, null) from public.enrollments where full_name = 'TEST DeleteCascade'; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.student_notes (enrollment_id, body) select id, 'TEST note to cascade' from public.enrollments where full_name = 'TEST DeleteCascade';
insert into public.student_notes (enrollment_id, body) values (1, 'Live note that must still be logged when deleted');
delete from public.student_notes where enrollment_id = 1 and body = 'Live note that must still be logged when deleted';
select pg_temp.check((select count(*) from public.admin_activity where action = 'note_deleted' and enrollment_id = 1 and summary like 'Note deleted: Live note%') = 1, 'R4-1: deleting a note on a live enrollment is still logged');
insert into public.batches (code, course_code, start_date, status) values ('TEST-DEL', 'a1-normal', '2026-11-25', 'planned');
insert into public.class_sessions (batch_id, session_date, topic, status) select id, '2026-11-25', 'TEST cascade class', 'held' from public.batches where code = 'TEST-DEL';
insert into public.attendance (session_id, enrollment_id, status)
  select s.id, e.id, 'present' from public.class_sessions s, public.enrollments e
  where s.topic = 'TEST cascade class' and e.full_name = 'TEST DeleteCascade';
delete from public.enrollments where full_name = 'TEST DeleteCascade';
select pg_temp.check(not exists (select 1 from public.enrollments where full_name = 'TEST DeleteCascade'), 'R4-1: deleting a TEST enrollment with notes and attendance succeeds');
select pg_temp.check(not exists (select 1 from public.student_notes where body = 'TEST note to cascade')
  and not exists (select 1 from public.attendance a join public.class_sessions s on s.id = a.session_id where s.topic = 'TEST cascade class'), 'R4-1: notes and attendance cascaded away');
select pg_temp.check(not exists (select 1 from public.admin_activity where action in ('note_deleted', 'attendance_deleted') and summary like '%TEST note to cascade%')
  and not exists (select 1 from public.admin_activity where action = 'attendance_deleted' and details->>'status' = 'present' and summary like '%25 Nov 2026%'), 'R4-1: cascade does not write per-row note/attendance audit (the enrollment deletion is the summary)');
delete from public.batches where code = 'TEST-DEL';

-- 17) no public table grants TRUNCATE/MAINTAIN/TRIGGER/REFERENCES to anon or authenticated (leftover Dxtm)
-- Older stub tables are seeded with production Dxtm before 160000/190000 so this fails if the revoke loop is missing.
select pg_temp.check(not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and exists (
         select 1 from unnest(array['TRUNCATE', 'MAINTAIN', 'TRIGGER', 'REFERENCES']) p
          where has_table_privilege('authenticated', c.oid, p) or has_table_privilege('anon', c.oid, p)
       )
  ), 'R5: no public table grants TRUNCATE/MAINTAIN/TRIGGER/REFERENCES to anon or authenticated');

-- 18) per-staff permissions: a second staff member, isolation, disable, column guards, trigger backfill
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000d', 'staff2@test.local');
insert into public.profiles (id, username, full_name, role) values ('00000000-0000-0000-0000-00000000000d', 'staff2', 'Staff Two', 'staff');
select pg_temp.check((select not view_students and not attendance and not notes_tags and not disabled from public.staff_permissions where user_id = '00000000-0000-0000-0000-00000000000d'), 'inserting a profile as staff also creates an all-off row');

-- D can read own row only (admin can read both)
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d'); set role authenticated;
select pg_temp.check((select count(*) from public.staff_permissions) = 1
  and (select user_id from public.staff_permissions) = '00000000-0000-0000-0000-00000000000d', 'a staff member cannot read another staff member''s permissions');
select pg_temp.check((select count(*) from public.student_notes) = 0, 'staff without notes_tags cannot read notes');
select pg_temp.check((select count(*) from public.attendance) = 0, 'staff without attendance cannot read marks');
select pg_temp.check((select count(*) from public.batches) = 0, 'staff without batches or attendance cannot read batches');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); set role authenticated;
select pg_temp.check((select count(*) from public.staff_permissions) = 2, 'admin can read every staff permissions row');
reset role;

-- give D only notes_tags: can write notes and tags, cannot pause reminders, cannot mark attendance
update public.staff_permissions set notes_tags = true where user_id = '00000000-0000-0000-0000-00000000000d';
update public.student_meta set reminders_paused = false where enrollment_id = 1;
select pg_temp.check(not (select reminders_paused from public.student_meta where enrollment_id = 1), 'pre-condition: reminders are running before the notes-only staff tries to pause them');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d'); set role authenticated;
insert into public.student_notes (enrollment_id, body) values (1, 'Staff two note');
update public.student_meta set tags = array['vip','staff2'] where enrollment_id = 1;
do $$ begin update public.student_meta set reminders_paused = true, reminders_paused_until = '2027-01-01', pause_reason = 'no'; raise exception 'notes staff paused reminders'; exception when others then if sqlerrm like 'notes staff paused%' then raise; end if; end $$;
do $$ begin insert into public.attendance (session_id, enrollment_id, status) values ((select id from public.class_sessions limit 1), 1, 'present'); raise exception 'notes staff marked attendance'; exception when insufficient_privilege then null; when others then if sqlerrm like 'notes staff marked%' then raise; end if; end $$;
reset role;
select pg_temp.check((select count(*) from public.student_notes where body = 'Staff two note') = 1, 'notes_tags staff can add a note');
select pg_temp.check((select tags @> array['staff2'] from public.student_meta where enrollment_id = 1), 'notes_tags staff can change tags');
select pg_temp.check(not (select reminders_paused from public.student_meta where enrollment_id = 1), 'notes_tags staff cannot pause reminders');

-- disable D: staff_can becomes false even with flags still on
update public.staff_permissions set disabled = true where user_id = '00000000-0000-0000-0000-00000000000d';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d'); set role authenticated;
select pg_temp.check(not private.staff_can('notes_tags'), 'disabled staff fail staff_can even when the flag is on');
do $$ begin insert into public.student_notes (enrollment_id, body) values (1, 'disabled'); raise exception 'disabled staff wrote a note'; exception when insufficient_privilege then null; when others then if sqlerrm like 'disabled staff%' then raise; end if; end $$;
reset role;
update public.staff_permissions set disabled = false where user_id = '00000000-0000-0000-0000-00000000000d';

-- B has attendance (from 1b): still can mark; D still cannot
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); set role authenticated;
select pg_temp.check(private.staff_can('attendance') and private.staff_can('notes_tags') and not private.staff_can('record_payments') and not private.staff_can('discounts_refunds'), 'staff B keeps only the flags granted in 1b');
select pg_temp.check((select count(*) from public.class_sessions) > 0, 'attendance staff can read classes');
reset role;

-- admin is always allowed
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); set role authenticated;
select pg_temp.check(private.staff_can('view_students') and private.staff_can('record_payments') and private.staff_can('export'), 'admin staff_can is true for every known permission');
reset role;

-- B20-5: student_info_lock_update is service-role only; match, mismatch, null, and quoted addresses
select pg_temp.check(
  has_function_privilege('service_role', 'public.student_info_lock_update(bigint,jsonb,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.student_info_lock_update(bigint,jsonb,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.student_info_lock_update(bigint,jsonb,jsonb)', 'execute'),
  'student_info_lock_update is service-role only');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); set role authenticated;
do $$ begin
  perform * from public.student_info_lock_update(1, null, '{}'::jsonb);
  raise exception 'authenticated called lock update';
exception when insufficient_privilege then null; when others then if sqlerrm like 'authenticated called%' then raise; end if; end $$;
reset role;

insert into public.enrollments (email, full_name, course_code, status, student_info)
values ('test-lock-b20@test.local', 'TEST Lock', 'a1-normal', 'pending',
        '{"full_name":"TEST Lock","address":"12, \"Quoted\" Road, Lahore"}'::jsonb);
insert into public.enrollments (email, full_name, course_code, status, student_info)
values ('test-lock-null@test.local', 'TEST Lock Null', 'a1-normal', 'pending', null);

select pg_temp.check((select count(*) from public.student_info_lock_update(
    (select id from public.enrollments where email = 'test-lock-b20@test.local'),
    '{"full_name":"TEST Lock","address":"12, \"Quoted\" Road, Lahore"}'::jsonb,
    jsonb_build_object(
      'student_info', '{"full_name":"TEST Lock 2","address":"12, \"Quoted\" Road, Lahore"}'::jsonb,
      'full_name', 'TEST Lock 2'))) = 1,
  'lock update match returns 1 row');
select pg_temp.check((select full_name from public.enrollments where email = 'test-lock-b20@test.local') = 'TEST Lock 2'
  and (select student_info->>'address' from public.enrollments where email = 'test-lock-b20@test.local') = '12, "Quoted" Road, Lahore',
  'lock update keeps an address with commas and quotes');

select pg_temp.check((select count(*) from public.student_info_lock_update(
    (select id from public.enrollments where email = 'test-lock-b20@test.local'),
    '{"full_name":"TEST Lock","address":"12, \"Quoted\" Road, Lahore"}'::jsonb,
    jsonb_build_object('student_info', '{"full_name":"Hacked"}'::jsonb, 'full_name', 'Hacked'))) = 0,
  'lock update mismatch returns 0 rows');
select pg_temp.check((select full_name from public.enrollments where email = 'test-lock-b20@test.local') = 'TEST Lock 2',
  'lock update mismatch does not write');

select pg_temp.check((select count(*) from public.student_info_lock_update(
    (select id from public.enrollments where email = 'test-lock-null@test.local'),
    null,
    jsonb_build_object('student_info', '{"full_name":"From null"}'::jsonb, 'full_name', 'From null'))) = 1,
  'lock update matches when both sides are null');
select pg_temp.check((select full_name from public.enrollments where email = 'test-lock-null@test.local') = 'From null'
  and (select student_info->>'full_name' from public.enrollments where email = 'test-lock-null@test.local') = 'From null',
  'lock update from a null student_info writes the new value');

select pg_temp.check((select count(*) from public.student_info_lock_update(
    (select id from public.enrollments where email = 'test-lock-null@test.local'),
    null,
    jsonb_build_object('student_info', '{"full_name":"Again"}'::jsonb))) = 0,
  'lock update does not match a null expect after student_info is set');
select pg_temp.check((select full_name from public.enrollments where email = 'test-lock-null@test.local') = 'From null',
  'a stale null expect does not write');

delete from public.enrollments where email in ('test-lock-b20@test.local', 'test-lock-null@test.local');

-- 19) QA round 2: TEST marks, attendance summary row, actor username
reset role; select pg_temp.as_user('');
insert into public.enrollments (email, full_name, course_code, status, fee_total) values ('qa2@test.local', 'QA2 Real Looking', 'a1-normal', 'active', 25000);
do $$ declare eid bigint := (select id from public.enrollments where full_name = 'QA2 Real Looking'); n0 bigint := (select count(*) from public.admin_activity); begin
  perform public.set_test_mark(eid, true, '00000000-0000-0000-0000-00000000000a', 'misclick check');
  perform pg_temp.check((select is_test from public.student_meta where enrollment_id = eid), 'QA2: set_test_mark marks');
  perform pg_temp.check((select count(*) from public.admin_activity where enrollment_id = eid and action = 'marked_test' and actor_name = 'admin1' and summary like 'Marked as TEST record: QA2 Real Looking%misclick check') = 1, 'QA2: every mark writes one audit row with the username and the reason');
  begin perform public.set_test_mark(eid, true, '00000000-0000-0000-0000-00000000000a', null); raise exception 'double mark'; exception when others then if sqlerrm like 'double mark%' then raise; end if; end;
  perform public.set_test_mark(eid, false, '00000000-0000-0000-0000-00000000000a', null);
  perform pg_temp.check((select count(*) from public.admin_activity where enrollment_id = eid and action = 'unmarked_test') = 1 and not (select is_test from public.student_meta where enrollment_id = eid), 'QA2: unmark writes its own audit row');
  perform pg_temp.check((select count(*) from public.admin_activity) = n0 + 2, 'QA2: no duplicate rows from the student_meta trigger');
end $$;
select pg_temp.check(not has_function_privilege('authenticated', 'public.set_test_mark(bigint,boolean,uuid,text)', 'execute') and not has_function_privilege('anon', 'public.set_test_mark(bigint,boolean,uuid,text)', 'execute'), 'QA2: set_test_mark is service-role only');
select pg_temp.check(not has_function_privilege('anon', 'public.attendance_save(bigint,date,text,text,jsonb)', 'execute'), 'QA2: anon cannot save attendance');
-- staff saves a class of 2 (1 present, 1 absent): one summary row, no per-row rows
insert into public.batches (code, course_code, start_date, status) values ('QA2-B', 'a1-normal', '2026-11-20', 'running');
update public.enrollments set batch_id = (select id from public.batches where code = 'QA2-B') where full_name in ('QA2 Real Looking', 'TEST Student');
select (select jsonb_agg(jsonb_build_object('enrollment_id', id, 'status', case when full_name = 'TEST Student' then 'present' else 'absent' end)) from public.enrollments where full_name in ('QA2 Real Looking', 'TEST Student')) as m1,
       (select jsonb_agg(jsonb_build_object('enrollment_id', id, 'status', 'late')) from public.enrollments where full_name = 'QA2 Real Looking') as m2,
       (select jsonb_build_array(jsonb_build_object('enrollment_id', id, 'status', 'present')) from public.enrollments where full_name = 'TEST Other') as m3,
       (select id from public.batches where code = 'QA2-B') as qb \gset
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); set role authenticated;
select public.attendance_save(:qb, '2026-11-24', 'Dativ', 'held', :'m1'::jsonb) is not null as saved;
reset role;
select pg_temp.check((select count(*) from public.admin_activity where action = 'attendance_saved' and actor_name = 'staff1' and summary = 'Attendance saved for QA2-B on 24 Nov 2026: 1 present, 0 late, 1 absent') = 1, 'QA2: one attendance save = one summary activity row (with the staff username)');
select pg_temp.check((select count(*) from public.admin_activity where action = 'attendance' and summary like '% on 24 Nov 2026') = 0, 'QA2: no per-student rows inside a save');
select pg_temp.check((select count(*) from public.attendance a join public.class_sessions s on s.id = a.session_id where s.topic = 'Dativ') = 2, 'QA2: marks saved');
-- saving again (change absent -> late) logs "updated"
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); set role authenticated;
select public.attendance_save(:qb, '2026-11-24', 'Dativ', 'held', :'m2'::jsonb) is not null as saved;
select set_config('qa2.m3', :'m3', false);
-- a student outside the batch is refused; a future date is refused; a plain user is refused
do $$ begin perform public.attendance_save((select id from public.batches where code = 'QA2-B'), '2026-11-24', null, 'held', current_setting('qa2.m3')::jsonb); raise exception 'outsider saved'; exception when others then if sqlerrm like 'outsider%' then raise; end if; end $$;
do $$ begin perform public.attendance_save((select id from public.batches where code = 'QA2-B'), current_date + 5, null, 'held', '[]'); raise exception 'future saved'; exception when others then if sqlerrm like 'future%' then raise; end if; end $$;
reset role; select pg_temp.as_user('00000000-0000-0000-0000-00000000000c'); set role authenticated;
do $$ begin perform public.attendance_save((select id from public.batches where code = 'QA2-B'), '2026-11-23', null, 'held', '[]'); raise exception 'student saved'; exception when others then if sqlerrm like 'student saved%' then raise; end if; end $$;
reset role;
-- staff with notes_tags only (D, re-enabled) cannot use attendance_save
update public.staff_permissions set disabled = false where user_id = '00000000-0000-0000-0000-00000000000d';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d'); set role authenticated;
do $$ begin perform public.attendance_save((select id from public.batches where code = 'QA2-B'), '2026-11-23', null, 'held', '[]'); raise exception 'notes staff saved attendance via rpc'; exception when others then if sqlerrm like 'notes staff saved%' then raise; end if; end $$;
reset role; update public.staff_permissions set disabled = true where user_id = '00000000-0000-0000-0000-00000000000d';

select pg_temp.check((select count(*) from public.admin_activity where action = 'attendance_saved' and summary like 'Attendance updated for QA2-B on 24 Nov 2026: 0 present, 1 late, 0 absent') = 1, 'QA2: a second save logs "updated"; outsiders, future dates, non-staff and staff without attendance are refused');
select pg_temp.check((select count(*) from public.class_sessions where session_date in ('2026-11-23', current_date + 5)) = 0, 'QA2: refused saves leave no class behind');
update public.enrollments set batch_id = null where full_name in ('QA2 Real Looking', 'TEST Student');
select pg_temp.as_user('');
delete from public.enrollments where full_name = 'QA2 Real Looking'; delete from public.batches where code = 'QA2-B';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
