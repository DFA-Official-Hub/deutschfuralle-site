-- Admin portal upgrade (WD-3): staff role, internal notes/tags, batches + attendance, activity log,
-- discounts/scholarships/refunds, payment reference + proof file, reminder pause, email delivery status,
-- test-data flags. Safe to run more than once. Builds on 20261125090000 (enrollment_audit).
--
-- Who can do what (enforced here with RLS and again in the admission function):
--   admin: everything.
--   staff: read students/payments/batches/attendance/notes, add a pending student, mark attendance,
--          write notes/tags, pause reminders. No revoke/remove, no refunds/discounts, no settings,
--          no security log, no accounts, no exports, no test-data deletion.
-- Nothing here is readable by students: notes, tags and test flags live in staff-only tables, never on
-- public.enrollments (students can read their own enrollment row).

-- 1) Roles ---------------------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role = any (array['user', 'staff', 'admin']));

create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path to '' as $$
  select exists(select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'staff'));
$$;
create or replace function private.actor_name(uid uuid) returns text
language sql stable security definer set search_path to '' as $$
  select coalesce(nullif(p.full_name, ''), p.username, 'Staff') from public.profiles p where p.id = uid;
$$;
revoke all on function private.is_staff() from public;
grant execute on function private.is_staff() to authenticated, service_role;

-- Staff read access to the existing admin tables (admins keep their own policies).
drop policy if exists enr_staff_select on public.enrollments;
create policy enr_staff_select on public.enrollments for select to authenticated using ((select private.is_staff()));
drop policy if exists enr_staff_ins on public.enrollments;
create policy enr_staff_ins on public.enrollments for insert to authenticated with check ((select private.is_staff()) and status = 'pending');
drop policy if exists pay_staff_select on public.payments;
create policy pay_staff_select on public.payments for select to authenticated using ((select private.is_staff()));
drop policy if exists elog_staff_select on public.email_log;
create policy elog_staff_select on public.email_log for select to authenticated using ((select private.is_staff()));
drop policy if exists courses_staff_read on public.courses;  -- courses are already public; kept for clarity
create policy courses_staff_read on public.courses for select to authenticated using (true);

-- 2) Activity log (who did what, when) -----------------------------------------------------------
create table if not exists public.admin_activity (
  id bigint generated always as identity primary key,
  enrollment_id bigint references public.enrollments(id) on delete set null,
  actor uuid references auth.users(id) on delete set null,
  actor_name text,
  action text not null,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_activity_enr_idx on public.admin_activity (enrollment_id, created_at desc);
create index if not exists admin_activity_time_idx on public.admin_activity (created_at desc);
alter table public.admin_activity enable row level security;
drop policy if exists act_admin_select on public.admin_activity;
create policy act_admin_select on public.admin_activity for select to authenticated using ((select private.is_admin()));
drop policy if exists act_staff_select on public.admin_activity;
create policy act_staff_select on public.admin_activity for select to authenticated using (enrollment_id is not null and (select private.is_staff()));
revoke insert, update, delete on public.admin_activity from anon, authenticated;
comment on table public.admin_activity is 'Admin portal activity: payments, documents, revokes, certificates, notes, batches, attendance, refunds. Written by triggers and the admission function only.';

create or replace function private.log_activity(p_enr bigint, p_action text, p_summary text, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path to '' as $$
declare uid uuid := (select auth.uid());
begin
  insert into public.admin_activity (enrollment_id, actor, actor_name, action, summary, details)
  values (p_enr, uid, case when uid is null then null else private.actor_name(uid) end, p_action, left(p_summary, 500), coalesce(p_details, '{}'::jsonb));
end $$;
revoke all on function private.log_activity(bigint, text, text, jsonb) from public;

-- Direct browser writes to enrollments (Add student, legacy revoke/remove) are logged here.
-- Writes by the admission function (service role, auth.uid() is null) log themselves with the real admin.
create or replace function private.enrollment_activity() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if (select auth.uid()) is null then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    perform private.log_activity(new.id, 'student_added', 'Added ' || coalesce(new.full_name, new.email) || ' as pending (' || coalesce(new.course_code, 'no course') || ')');
  elsif tg_op = 'DELETE' then
    perform private.log_activity(null, 'student_removed', 'Removed ' || coalesce(old.full_name, old.email) || coalesce(' (' || old.student_id || ')', ''), jsonb_build_object('enrollment_id', old.id, 'status', old.status));
  elsif new.status is distinct from old.status then
    perform private.log_activity(new.id, 'status_' || new.status, 'Status ' || old.status || ' → ' || new.status);
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists enrollments_activity on public.enrollments;
create trigger enrollments_activity after insert or update of status or delete on public.enrollments for each row execute function private.enrollment_activity();

-- 3) Staff-only student meta: tags, reminder pause, test flag -------------------------------------
create table if not exists public.student_meta (
  enrollment_id bigint primary key references public.enrollments(id) on delete cascade,
  tags text[] not null default '{}',
  reminders_paused boolean not null default false,
  reminders_paused_until date,
  pause_reason text,
  is_test boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint student_meta_tags_check check (cardinality(tags) <= 12)
);
alter table public.student_meta enable row level security;
drop policy if exists meta_staff_select on public.student_meta;
create policy meta_staff_select on public.student_meta for select to authenticated using ((select private.is_staff()));
drop policy if exists meta_staff_ins on public.student_meta;
create policy meta_staff_ins on public.student_meta for insert to authenticated with check ((select private.is_staff()));
drop policy if exists meta_staff_upd on public.student_meta;
create policy meta_staff_upd on public.student_meta for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create or replace function private.student_meta_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
declare old_test boolean := case when tg_op = 'UPDATE' then old.is_test else false end;
begin
  new.tags := coalesce((select array_agg(distinct left(lower(trim(t)), 30)) from unnest(new.tags) t where trim(t) <> ''), '{}');
  if new.is_test is distinct from old_test and (select auth.uid()) is not null and not private.is_admin() then
    raise exception 'Only admins can mark or unmark test records';
  end if;
  if not new.reminders_paused then new.reminders_paused_until := null; new.pause_reason := null; end if;
  new.updated_at := now(); new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end $$;
drop trigger if exists student_meta_guard on public.student_meta;
create trigger student_meta_guard before insert or update on public.student_meta for each row execute function private.student_meta_guard();
create or replace function private.student_meta_activity() returns trigger
language plpgsql security definer set search_path to '' as $$
declare o_tags text[] := '{}'; o_paused boolean := false; o_until date; o_test boolean := false;
begin
  if tg_op = 'UPDATE' then o_tags := old.tags; o_paused := old.reminders_paused; o_until := old.reminders_paused_until; o_test := old.is_test; end if;
  if new.tags is distinct from o_tags then perform private.log_activity(new.enrollment_id, 'tags', 'Tags: ' || coalesce(nullif(array_to_string(new.tags, ', '), ''), '(none)')); end if;
  if new.reminders_paused is distinct from o_paused or new.reminders_paused_until is distinct from o_until then
    perform private.log_activity(new.enrollment_id, case when new.reminders_paused then 'reminders_paused' else 'reminders_resumed' end,
      case when new.reminders_paused then 'Fee reminders paused' || coalesce(' until ' || to_char(new.reminders_paused_until, 'DD Mon YYYY'), '') || coalesce(': ' || new.pause_reason, '') else 'Fee reminders resumed' end);
  end if;
  if new.is_test is distinct from o_test then perform private.log_activity(new.enrollment_id, case when new.is_test then 'marked_test' else 'unmarked_test' end, case when new.is_test then 'Marked as TEST record' else 'TEST mark removed' end); end if;
  return new;
end $$;
drop trigger if exists student_meta_activity on public.student_meta;
create trigger student_meta_activity after insert or update on public.student_meta for each row execute function private.student_meta_activity();

-- 4) Internal notes -------------------------------------------------------------------------------
create table if not exists public.student_notes (
  id bigint generated always as identity primary key,
  enrollment_id bigint not null references public.enrollments(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  pinned boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists student_notes_enr_idx on public.student_notes (enrollment_id, pinned desc, created_at desc);
alter table public.student_notes enable row level security;
drop policy if exists notes_staff_select on public.student_notes;
create policy notes_staff_select on public.student_notes for select to authenticated using ((select private.is_staff()));
drop policy if exists notes_staff_ins on public.student_notes;
create policy notes_staff_ins on public.student_notes for insert to authenticated with check ((select private.is_staff()) and created_by = (select auth.uid()));
drop policy if exists notes_own_upd on public.student_notes;
create policy notes_own_upd on public.student_notes for update to authenticated using ((select private.is_admin()) or (created_by = (select auth.uid()) and (select private.is_staff()))) with check ((select private.is_staff()));
drop policy if exists notes_own_del on public.student_notes;
create policy notes_own_del on public.student_notes for delete to authenticated using ((select private.is_admin()) or (created_by = (select auth.uid()) and (select private.is_staff())));
create or replace function private.student_note_activity() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if tg_op = 'UPDATE' then new.created_by := old.created_by; new.created_at := old.created_at; new.enrollment_id := old.enrollment_id; new.updated_at := now(); end if;
  return new;
end $$;
drop trigger if exists student_notes_guard on public.student_notes;
create trigger student_notes_guard before update on public.student_notes for each row execute function private.student_note_activity();
create or replace function private.student_note_log() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if tg_op = 'INSERT' then perform private.log_activity(new.enrollment_id, 'note_added', 'Note: ' || left(new.body, 120));
  elsif tg_op = 'UPDATE' then perform private.log_activity(new.enrollment_id, 'note_edited', 'Note edited: ' || left(new.body, 120));
  else perform private.log_activity(old.enrollment_id, 'note_deleted', 'Note deleted: ' || left(old.body, 120)); end if;
  return coalesce(new, old);
end $$;
drop trigger if exists student_notes_log on public.student_notes;
create trigger student_notes_log after insert or update of body or delete on public.student_notes for each row execute function private.student_note_log();

-- 5) Batches --------------------------------------------------------------------------------------
-- Time slots (PKT): 12:00 = 12:00-1:30 PM, 14:00 = 2:00-3:30 PM, 18:30 = 6:30-8:00 PM, 21:00 = 9:00-10:30 PM.
create table if not exists public.batches (
  id bigint generated always as identity primary key,
  code text not null,
  course_code text not null references public.courses(code),
  start_date date not null,
  end_date date,
  time_slot text check (time_slot is null or time_slot in ('12:00', '14:00', '18:30', '21:00')),
  days text,
  teacher text check (teacher is null or char_length(teacher) <= 80),
  capacity integer check (capacity is null or capacity between 1 and 500),
  status text not null default 'planned' check (status in ('planned', 'running', 'finished', 'cancelled')),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint batches_code_check check (code ~ '^[A-Z0-9][A-Z0-9-]{1,23}$')
);
create unique index if not exists batches_code_key on public.batches (code);
alter table public.batches enable row level security;
drop policy if exists batches_staff_select on public.batches;
create policy batches_staff_select on public.batches for select to authenticated using ((select private.is_staff()));
drop policy if exists batches_admin_ins on public.batches;
create policy batches_admin_ins on public.batches for insert to authenticated with check ((select private.is_admin()));
drop policy if exists batches_admin_upd on public.batches;
create policy batches_admin_upd on public.batches for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists batches_admin_del on public.batches;
create policy batches_admin_del on public.batches for delete to authenticated using ((select private.is_admin()));

alter table public.enrollments add column if not exists batch_id bigint references public.batches(id) on delete set null;
create index if not exists enrollments_batch_idx on public.enrollments (batch_id);
comment on column public.enrollments.batch_id is 'Batch picked in the admin portal. When set, batch_code always equals the batch''s code.';

-- Runs after enrollments_numbers (trigger names fire in alphabetical order), so a picked batch wins over the
-- automatic course+month code, and existing free-text batch codes keep working when no batch is picked.
create or replace function private.enrollment_batch() returns trigger
language plpgsql security definer set search_path to '' as $$
declare k text;
begin
  if new.batch_id is not null then
    select code into new.batch_code from public.batches where id = new.batch_id;
  elsif tg_op = 'UPDATE' and old.batch_id is not null then
    select short_code into k from public.courses where code = new.course_code;
    new.batch_code := case when k is null then null else k || '-' || to_char(coalesce(new.start_date, (new.created_at at time zone 'Asia/Karachi')::date), 'YYMM') end;
  end if;
  return new;
end $$;
drop trigger if exists enrollments_zz_batch on public.enrollments;
create trigger enrollments_zz_batch before insert or update on public.enrollments for each row execute function private.enrollment_batch();

create or replace function private.batch_sync() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_activity(null, 'batch_created', 'Batch ' || new.code || ' created (' || new.course_code || ', starts ' || to_char(new.start_date, 'DD Mon YYYY') || coalesce(', ' || new.time_slot, '') || ')', jsonb_build_object('batch_id', new.id));
  elsif tg_op = 'UPDATE' then
    if new.code is distinct from old.code then update public.enrollments set batch_code = new.code where batch_id = new.id; end if;
    perform private.log_activity(null, 'batch_updated', 'Batch ' || new.code || ' updated', jsonb_build_object('batch_id', new.id));
  else
    perform private.log_activity(null, 'batch_deleted', 'Batch ' || old.code || ' deleted', jsonb_build_object('batch_id', old.id));
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists batches_sync on public.batches;
create trigger batches_sync after insert or update or delete on public.batches for each row execute function private.batch_sync();

-- 6) Attendance -----------------------------------------------------------------------------------
create table if not exists public.class_sessions (
  id bigint generated always as identity primary key,
  batch_id bigint not null references public.batches(id) on delete cascade,
  session_date date not null,
  topic text check (topic is null or char_length(topic) <= 200),
  status text not null default 'held' check (status in ('held', 'cancelled')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (batch_id, session_date)
);
create table if not exists public.attendance (
  session_id bigint not null references public.class_sessions(id) on delete cascade,
  enrollment_id bigint not null references public.enrollments(id) on delete cascade,
  status text not null check (status in ('present', 'late', 'absent', 'excused')),
  note text check (note is null or char_length(note) <= 200),
  marked_by uuid default auth.uid() references auth.users(id) on delete set null,
  marked_at timestamptz not null default now(),
  primary key (session_id, enrollment_id)
);
create index if not exists attendance_enr_idx on public.attendance (enrollment_id);
alter table public.class_sessions enable row level security;
alter table public.attendance enable row level security;
drop policy if exists sess_staff_all on public.class_sessions;
create policy sess_staff_all on public.class_sessions for all to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
drop policy if exists att_staff_all on public.attendance;
create policy att_staff_all on public.attendance for all to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create or replace function private.attendance_log() returns trigger
language plpgsql security definer set search_path to '' as $$
declare dt date;
begin
  if tg_op = 'UPDATE' and new.status = old.status then return new; end if;
  new.marked_at := now(); new.marked_by := coalesce((select auth.uid()), new.marked_by);
  select session_date into dt from public.class_sessions where id = new.session_id;
  if new.status in ('absent', 'late') or tg_op = 'UPDATE' then
    perform private.log_activity(new.enrollment_id, 'attendance', initcap(new.status) || ' on ' || to_char(dt, 'DD Mon YYYY'));
  end if;
  return new;
end $$;
drop trigger if exists attendance_log on public.attendance;
create trigger attendance_log before insert or update on public.attendance for each row execute function private.attendance_log();

-- Attendance % per student: (present + late) / sessions marked (held sessions only; excused don't count against).
create or replace view public.attendance_summary with (security_invoker = true) as
select a.enrollment_id,
       count(*) filter (where s.status = 'held') as marked,
       count(*) filter (where s.status = 'held' and a.status = 'present') as present,
       count(*) filter (where s.status = 'held' and a.status = 'late') as late,
       count(*) filter (where s.status = 'held' and a.status = 'absent') as absent,
       count(*) filter (where s.status = 'held' and a.status = 'excused') as excused,
       case when count(*) filter (where s.status = 'held' and a.status <> 'excused') = 0 then null
            else round(100.0 * count(*) filter (where s.status = 'held' and a.status in ('present', 'late'))
                       / count(*) filter (where s.status = 'held' and a.status <> 'excused')) end::int as pct,
       max(s.session_date) filter (where s.status = 'held') as last_class
  from public.attendance a join public.class_sessions s on s.id = a.session_id
 group by a.enrollment_id;
revoke all on public.attendance_summary from anon;
grant select on public.attendance_summary to authenticated;

-- 7) Discounts, scholarships, refunds --------------------------------------------------------------
create table if not exists public.fee_adjustments (
  id bigint generated always as identity primary key,
  enrollment_id bigint not null references public.enrollments(id) on delete cascade,
  kind text not null check (kind in ('discount', 'scholarship', 'refund')),
  amount integer not null check (amount > 0 and amount <= 1000000),
  reason text not null check (char_length(reason) between 3 and 500),
  approved_by text not null check (char_length(approved_by) between 2 and 80),
  method text check (method is null or method in ('cash', 'bank', 'jazzcash', 'easypaisa', 'other')),
  reference text check (reference is null or char_length(reference) <= 80),
  adj_date date not null default ((now() at time zone 'Asia/Karachi')::date),
  receipt_no text unique,
  fee_before integer,
  fee_after integer,
  voided_at timestamptz,
  void_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists fee_adjustments_enr_idx on public.fee_adjustments (enrollment_id);
alter table public.fee_adjustments enable row level security;
drop policy if exists adj_staff_select on public.fee_adjustments;
create policy adj_staff_select on public.fee_adjustments for select to authenticated using ((select private.is_staff()));
revoke insert, update, delete on public.fee_adjustments from anon, authenticated;  -- written by the admission function only
create or replace function private.adjustment_numbers() returns trigger
language plpgsql security definer set search_path to '' as $$
declare y int := extract(year from (now() at time zone 'Asia/Karachi'))::int;
begin
  if new.receipt_no is null then
    new.receipt_no := case new.kind when 'refund' then 'RF-' when 'scholarship' then 'SC-' else 'DS-' end || y || '-' || lpad(private.next_no('adj-' || new.kind, y)::text, 4, '0');
  end if;
  return new;
end $$;
drop trigger if exists fee_adjustments_numbers on public.fee_adjustments;
create trigger fee_adjustments_numbers before insert on public.fee_adjustments for each row execute function private.adjustment_numbers();

-- 8) Payment reference + proof file ----------------------------------------------------------------
alter table public.payments add column if not exists reference text;
alter table public.payments add column if not exists proof_file text;
alter table public.payments drop constraint if exists payments_reference_check;
alter table public.payments add constraint payments_reference_check check (reference is null or char_length(reference) <= 80);
comment on column public.payments.reference is 'Transaction ID / reference from the bank, JazzCash or Easypaisa slip.';
comment on column public.payments.proof_file is 'Path of the uploaded payment proof in the private documents bucket (payment-proofs/...).';

-- 9) Email delivery status (Resend webhook: delivered / bounced / complained) ----------------------
alter table public.email_log add column if not exists provider_id text;
alter table public.email_log add column if not exists delivery text;
alter table public.email_log add column if not exists delivery_at timestamptz;
alter table public.email_log drop constraint if exists email_log_delivery_check;
alter table public.email_log add constraint email_log_delivery_check check (delivery is null or delivery in ('delivered', 'bounced', 'complained', 'delayed'));
create index if not exists email_log_provider_idx on public.email_log (provider_id) where provider_id is not null;
create index if not exists email_log_enr_idx on public.email_log (enrollment_id, created_at desc);

-- 10) Accounts marked as test (admin only) ---------------------------------------------------------
create table if not exists public.account_meta (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_test boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.account_meta enable row level security;
drop policy if exists acct_admin_select on public.account_meta;
create policy acct_admin_select on public.account_meta for select to authenticated using ((select private.is_admin()));
revoke insert, update, delete on public.account_meta from anon, authenticated;

-- 11) Reminder schedule (days relative to the due date; first, second, third reminder) -------------
insert into public.site_settings (key, value) values ('reminder_offsets', '-3,0,3') on conflict (key) do nothing;

-- 12) Staff can see the student-details/payment-correction history from 20261125090000 ------------
do $$ begin
  if to_regclass('public.enrollment_audit') is not null then
    execute 'drop policy if exists audit_staff_select on public.enrollment_audit';
    execute 'create policy audit_staff_select on public.enrollment_audit for select to authenticated using ((select private.is_staff()))';
  end if;
end $$;

-- 13) Fast lists: sorting/paging indexes ------------------------------------------------------------
create index if not exists enrollments_status_created_idx on public.enrollments (status, created_at desc);
create index if not exists enrollments_due_idx on public.enrollments (due_date) where balance_due > 0;
create index if not exists payments_enr_idx on public.payments (enrollment_id);
create index if not exists payments_paid_on_idx on public.payments (paid_on);
