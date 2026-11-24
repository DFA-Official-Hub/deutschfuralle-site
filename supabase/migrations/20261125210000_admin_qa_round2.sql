-- QA round 2 (admin portal). Idempotent: safe to run twice.
-- 1) TEST marks change only through the admission function (pro_mark_test: typed Student ID, checked on the server).
--    A browser write to student_meta.is_test is refused for everyone, admins included, so a misclick can never skip the typed confirm.
--    public.set_test_mark() changes the flag and writes the audit row in one transaction (service role only).
-- 2) Attendance: public.attendance_save() saves a class and its marks in one call and writes ONE activity row per save
--    (the per-row trigger stays quiet inside it). Admins, or staff with the attendance permission.
-- 3) Activity "Who": the actor's username (falls back to the full name), not the account's display name.
-- 4) Covering indexes for the activity/attendance foreign keys used by the portal.

-- 1) TEST marks ------------------------------------------------------------------------------------
-- Combined guard: the QA2 is_test lock (everyone, admins included) AND the staff_can column
-- guards from 20261125200000 (notes_tags / reminders). Replaces the 200000 definition.
create or replace function private.student_meta_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
declare old_test boolean := case when tg_op = 'UPDATE' then old.is_test else false end;
begin
  new.tags := coalesce((select array_agg(distinct left(lower(trim(t)), 30)) from unnest(new.tags) t where trim(t) <> ''), '{}');
  if new.is_test is distinct from old_test and (select auth.uid()) is not null then
    raise exception 'DFA: TEST marks are changed only in the admin portal (type the Student ID to confirm)' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (select auth.uid()) is not null and not private.is_admin() then
    if new.tags is distinct from old.tags and not private.staff_can('notes_tags') then
      raise exception 'You cannot change tags.';
    end if;
    if (new.reminders_paused is distinct from old.reminders_paused
        or new.reminders_paused_until is distinct from old.reminders_paused_until
        or new.pause_reason is distinct from old.pause_reason)
       and not private.staff_can('reminders') then
      raise exception 'You cannot change reminder pauses.';
    end if;
  end if;
  if not new.reminders_paused then new.reminders_paused_until := null; new.pause_reason := null; end if;
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end $$;

create or replace function public.set_test_mark(p_enr bigint, p_on boolean, p_actor uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare e record; was boolean;
begin
  select id, full_name, email, student_id into e from public.enrollments where id = p_enr for update;
  if not found then raise exception 'DFA: Student not found' using errcode = 'P0002'; end if;
  select is_test into was from public.student_meta where enrollment_id = p_enr for update;
  if coalesce(was, false) = p_on then raise exception 'DFA: %', case when p_on then 'Already marked TEST' else 'Not marked TEST' end using errcode = '23514'; end if;
  insert into public.student_meta (enrollment_id, is_test, updated_by) values (p_enr, p_on, p_actor)
    on conflict (enrollment_id) do update set is_test = excluded.is_test, updated_by = excluded.updated_by;
  insert into public.admin_activity (enrollment_id, actor, actor_name, action, summary, details)
  values (p_enr, p_actor, case when p_actor is null then null else private.actor_name(p_actor) end,
          case when p_on then 'marked_test' else 'unmarked_test' end,
          left((case when p_on then 'Marked as TEST record: ' else 'TEST mark removed: ' end) || coalesce(e.full_name, e.email, '') || coalesce(' (' || e.student_id || ')', '')
               || coalesce('. Reason: ' || nullif(trim(p_reason), ''), ''), 500),
          jsonb_build_object('student_id', e.student_id, 'on', p_on, 'confirmed_with', 'student_id'));
  return jsonb_build_object('id', p_enr, 'is_test', p_on, 'student_id', e.student_id);
end $$;
revoke all on function public.set_test_mark(bigint, boolean, uuid, text) from public, anon, authenticated;
grant execute on function public.set_test_mark(bigint, boolean, uuid, text) to service_role;

-- 2) Attendance: one save = one activity row --------------------------------------------------------
create or replace function private.attendance_log() returns trigger
language plpgsql security definer set search_path to '' as $$
declare dt date;
begin
  if tg_op = 'UPDATE' and new.status = old.status then return new; end if;
  new.marked_at := now(); new.marked_by := coalesce((select auth.uid()), new.marked_by);
  if coalesce(current_setting('dfa.attendance_bulk', true), '') = '1' then return new; end if;  -- attendance_save() logs one summary row
  select session_date into dt from public.class_sessions where id = new.session_id;
  if new.status in ('absent', 'late') or tg_op = 'UPDATE' then
    perform private.log_activity(new.enrollment_id, 'attendance', initcap(new.status) || ' on ' || to_char(dt, 'DD Mon YYYY'));
  end if;
  return new;
end $$;

create or replace function public.attendance_save(p_batch bigint, p_date date, p_topic text, p_status text, p_marks jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare s public.class_sessions; b public.batches; n_p int := 0; n_l int := 0; n_a int := 0; n_e int := 0; m jsonb; bad int; isnew boolean;
begin
  if not (private.is_admin() or private.staff_can('attendance')) then raise exception 'DFA: You cannot mark attendance' using errcode = '42501'; end if;
  if p_status not in ('held', 'cancelled') then raise exception 'DFA: Pick held or cancelled' using errcode = '23514'; end if;
  if p_date is null or p_date > (now() at time zone 'Asia/Karachi')::date then raise exception 'DFA: Pick a class date that is not in the future' using errcode = '23514'; end if;
  select * into b from public.batches where id = p_batch;
  if not found then raise exception 'DFA: Batch not found' using errcode = 'P0002'; end if;
  p_marks := coalesce(p_marks, '[]'::jsonb);
  if jsonb_typeof(p_marks) <> 'array' or jsonb_array_length(p_marks) > 500 then raise exception 'DFA: Bad attendance list' using errcode = '23514'; end if;
  select count(*) into bad from jsonb_array_elements(p_marks) x
   where coalesce(x->>'status', '') not in ('present', 'late', 'absent', 'excused')
      or not exists (select 1 from public.enrollments e where e.id = (x->>'enrollment_id')::bigint and e.batch_id = p_batch);
  if bad > 0 then raise exception 'DFA: Some students are not in this batch any more. Reload and try again.' using errcode = '23514'; end if;
  isnew := not exists (select 1 from public.class_sessions where batch_id = p_batch and session_date = p_date);
  insert into public.class_sessions (batch_id, session_date, topic, status) values (p_batch, p_date, nullif(left(trim(coalesce(p_topic, '')), 200), ''), p_status)
    on conflict (batch_id, session_date) do update set topic = excluded.topic, status = excluded.status
    returning * into s;
  perform set_config('dfa.attendance_bulk', '1', true);
  for m in select * from jsonb_array_elements(p_marks) loop
    insert into public.attendance (session_id, enrollment_id, status) values (s.id, (m->>'enrollment_id')::bigint, m->>'status')
      on conflict (session_id, enrollment_id) do update set status = excluded.status;
    case m->>'status' when 'present' then n_p := n_p + 1; when 'late' then n_l := n_l + 1; when 'absent' then n_a := n_a + 1; else n_e := n_e + 1; end case;
  end loop;
  perform set_config('dfa.attendance_bulk', '', true);
  perform private.log_activity(null, 'attendance_saved',
    left('Attendance ' || case when isnew then 'saved' else 'updated' end || ' for ' || b.code || ' on ' || to_char(p_date, 'DD Mon YYYY')
      || case when p_status = 'cancelled' then ' (class cancelled)' else '' end
      || ': ' || n_p || ' present, ' || n_l || ' late, ' || n_a || ' absent' || case when n_e > 0 then ', ' || n_e || ' excused' else '' end, 500),
    jsonb_build_object('batch_id', p_batch, 'session_id', s.id, 'date', p_date, 'status', p_status, 'present', n_p, 'late', n_l, 'absent', n_a, 'excused', n_e,
      'absent_ids', (select coalesce(jsonb_agg((x->>'enrollment_id')::bigint), '[]'::jsonb) from jsonb_array_elements(p_marks) x where x->>'status' = 'absent')));
  return to_jsonb(s);
end $$;
revoke all on function public.attendance_save(bigint, date, text, text, jsonb) from public, anon;
grant execute on function public.attendance_save(bigint, date, text, text, jsonb) to authenticated, service_role;

-- 3) Who did it: username first ----------------------------------------------------------------------
create or replace function private.actor_name(uid uuid) returns text
language sql stable security definer set search_path to '' as $$
  select coalesce(nullif(p.username, ''), nullif(p.full_name, ''), 'Staff') from public.profiles p where p.id = uid;
$$;
revoke all on function private.actor_name(uuid) from public, anon, authenticated;
grant execute on function private.actor_name(uuid) to service_role;

-- 4) Indexes ---------------------------------------------------------------------------------------------
create index if not exists admin_activity_actor_idx on public.admin_activity (actor);
create index if not exists admin_activity_action_idx on public.admin_activity (action, created_at desc);
create index if not exists attendance_marked_by_idx on public.attendance (marked_by);
create index if not exists class_sessions_created_by_idx on public.class_sessions (created_by);
create index if not exists email_log_kind_idx on public.email_log (kind, created_at desc);
