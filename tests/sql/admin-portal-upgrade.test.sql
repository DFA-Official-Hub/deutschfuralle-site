-- Behaviour of 20261125120000_admin_portal_upgrade.sql. Run with tests/sql/run.sh (needs a local Postgres).
\set ON_ERROR_STOP 1
-- people: admin A, staff S, plain user U (also a student by email)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'), ('00000000-0000-0000-0000-00000000000b', 'staff@test.local'), ('00000000-0000-0000-0000-00000000000c', 'student@test.local');
insert into public.profiles (id, username, full_name, role) values ('00000000-0000-0000-0000-00000000000a', 'admin1', 'Admin One', 'admin'), ('00000000-0000-0000-0000-00000000000b', 'staff1', 'Staff One', 'user'), ('00000000-0000-0000-0000-00000000000c', 'stud1', 'Stud One', 'user');
insert into public.enrollments (email, full_name, course_code, status, start_date, fee_total, amount_paid) values ('student@test.local', 'TEST Student', 'a1-normal', 'active', '2026-11-01', 25000, 10000);
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

-- 2) staff reads students and payments, can add a pending student but not an active one, cannot update/delete
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); set role authenticated;
select pg_temp.check((select count(*) from public.enrollments) = 2, 'staff sees all students');
insert into public.enrollments (email, full_name, course_code, source) values ('walkin@test.local', 'TEST Walkin', 'a1-normal', 'manual');
do $$ begin insert into public.enrollments (email, course_code, status) values ('x@test.local', 'a1-normal', 'active'); raise exception 'staff inserted active'; exception when insufficient_privilege then null; when others then if sqlerrm like 'staff inserted%' then raise; end if; end $$;
update public.enrollments set status = 'revoked' where full_name = 'TEST Student';
reset role; select pg_temp.check((select status from public.enrollments where full_name = 'TEST Student') = 'active', 'staff cannot revoke (RLS update is admin only)');
select pg_temp.check((select count(*) from public.admin_activity where action = 'student_added' and actor_name = 'Staff One') = 1, 'Add student by staff is logged with their name');

-- 3) student (plain user) sees only own enrollment and none of the staff tables
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c'); set role authenticated;
select pg_temp.check((select count(*) from public.enrollments) = 1, 'student sees only their own enrollment');
select pg_temp.check((select count(*) from public.admin_activity) = 0, 'student cannot read the activity log');
select pg_temp.check((select count(*) from public.student_notes) = 0, 'student cannot read notes');
do $$ begin insert into public.student_notes (enrollment_id, body) values (1, 'x'); raise exception 'student wrote note'; exception when insufficient_privilege then null; when others then if sqlerrm like 'student wrote%' then raise; end if; end $$;
reset role;

-- 4) notes + tags + reminder pause by staff, logged; staff can't mark test; admin can
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); set role authenticated;
insert into public.student_notes (enrollment_id, body) select id, 'Pays on the 5th' from public.enrollments where full_name = 'TEST Student';
insert into public.student_meta (enrollment_id, tags, reminders_paused, reminders_paused_until, pause_reason) select id, array['Urdu ', 'urdu', 'VIP'], true, '2026-12-05', 'Salary on 5th' from public.enrollments where full_name = 'TEST Student';
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
  from public.class_sessions s, public.enrollments e where e.full_name = 'TEST Student';
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

-- 8) activity visibility: staff sees student-linked entries only, admin sees all
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); set role authenticated;
select pg_temp.check((select count(*) from public.admin_activity where enrollment_id is null) = 0, 'staff does not see global (batch) entries');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); set role authenticated;
select pg_temp.check((select count(*) from public.admin_activity where action like 'batch_%') >= 2, 'admin sees batch entries');
select pg_temp.check((select count(*) from public.account_meta) = 0, 'admin can read account_meta');
reset role;
select pg_temp.check((select value from public.site_settings where key = 'reminder_offsets') = '-3,0,3', 'default reminder schedule -3,0,+3 days');
