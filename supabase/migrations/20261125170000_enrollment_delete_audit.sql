-- Deleting an enrollment cascades into notes and attendance. Those delete triggers used to insert
-- admin_activity with the just-deleted enrollment_id, which failed admin_activity_enrollment_id_fkey
-- (found in live QA on pro_delete_test). Skip the per-row log when the parent is already gone;
-- student_removed / test_deleted is the summary. A note or mark deleted on a live enrollment is still logged.
create or replace function private.student_note_log() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if tg_op = 'INSERT' then perform private.log_activity(new.enrollment_id, 'note_added', 'Note: ' || left(new.body, 120));
  elsif tg_op = 'UPDATE' then perform private.log_activity(new.enrollment_id, 'note_edited', 'Note edited: ' || left(new.body, 120));
  elsif exists (select 1 from public.enrollments where id = old.enrollment_id) then
    perform private.log_activity(old.enrollment_id, 'note_deleted', 'Note deleted: ' || left(old.body, 120));
  end if;
  return coalesce(new, old);
end $$;

create or replace function private.attendance_delete_log() returns trigger
language plpgsql security definer set search_path to '' as $$
declare dt date;
begin
  if not exists (select 1 from public.enrollments where id = old.enrollment_id) then return old; end if;
  select session_date into dt from public.class_sessions where id = old.session_id;
  if dt is null then return old; end if;  -- the whole class is being deleted: logged once by class_sessions_delete_log
  perform private.log_activity(old.enrollment_id, 'attendance_deleted', 'Attendance mark (' || old.status || ') on ' || to_char(dt, 'DD Mon YYYY') || ' deleted',
    jsonb_build_object('session_id', old.session_id, 'status', old.status));
  return old;
end $$;
