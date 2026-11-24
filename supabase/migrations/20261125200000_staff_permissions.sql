-- Per-staff permissions (Ali, Nov 2026). Every toggle defaults to OFF for a new staff member.
-- The global site_settings.staff_payments flag is no longer consulted; record_payments and
-- open_payment_slips on this table replace it (still default off). Admin-only actions stay
-- admin-only. Idempotent. SELECT/INSERT/UPDATE/DELETE for authenticated follow the 160000
-- defaults, then we narrow this table to SELECT only (writes go through the admission function).

create table if not exists public.staff_permissions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  view_students boolean not null default false,
  see_contacts boolean not null default false,
  edit_student_info boolean not null default false,
  add_students boolean not null default false,
  record_payments boolean not null default false,
  open_payment_slips boolean not null default false,
  discounts_refunds boolean not null default false,
  batches boolean not null default false,
  attendance boolean not null default false,
  notes_tags boolean not null default false,
  reminders boolean not null default false,
  documents_emails boolean not null default false,
  export boolean not null default false,
  view_activity boolean not null default false,
  disabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.staff_permissions enable row level security;

comment on table public.staff_permissions is 'Per-staff portal permissions. Every flag defaults to off. Written only by the admission function (admin). Staff may read their own row.';

-- Grants: authenticated may only SELECT (to load their own switches); anon nothing; no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN.
revoke all on public.staff_permissions from anon, authenticated;
grant select on public.staff_permissions to authenticated;

drop policy if exists staff_perms_admin_select on public.staff_permissions;
drop policy if exists staff_perms_admin_ins on public.staff_permissions;
drop policy if exists staff_perms_admin_upd on public.staff_permissions;
drop policy if exists staff_perms_admin_del on public.staff_permissions;
drop policy if exists staff_perms_own_select on public.staff_permissions;
-- Admin reads/writes go through the service-role admission function, but keep admin SELECT via RLS
-- in case the UI also reads the table as the signed-in admin (who is is_admin()).
create policy staff_perms_admin_select on public.staff_permissions for select to authenticated
  using ((select private.is_admin()) or (user_id = (select auth.uid())));

-- staff_can('perm'): admin always; staff only if not disabled and that boolean is true. Unknown perm -> false.
create or replace function private.staff_can(perm text) returns boolean
language plpgsql stable security definer set search_path to '' as $$
declare r public.staff_permissions;
begin
  if (select private.is_admin()) then return true; end if;
  if not exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'staff') then return false; end if;
  select * into r from public.staff_permissions where user_id = (select auth.uid());
  if not found or r.disabled then return false; end if;
  return case perm
    when 'view_students' then r.view_students
    when 'see_contacts' then r.see_contacts
    when 'edit_student_info' then r.edit_student_info
    when 'add_students' then r.add_students
    when 'record_payments' then r.record_payments
    when 'open_payment_slips' then r.open_payment_slips
    when 'discounts_refunds' then r.discounts_refunds
    when 'batches' then r.batches
    when 'attendance' then r.attendance
    when 'notes_tags' then r.notes_tags
    when 'reminders' then r.reminders
    when 'documents_emails' then r.documents_emails
    when 'export' then r.export
    when 'view_activity' then r.view_activity
    else false
  end;
end $$;
revoke all on function private.staff_can(text) from public;
grant execute on function private.staff_can(text) to authenticated, service_role;

-- When someone becomes staff, give them a row with every toggle off (keep an existing row as-is).
create or replace function private.staff_permissions_on_role() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if new.role = 'staff' and (tg_op = 'INSERT' or old.role is distinct from 'staff') then
    insert into public.staff_permissions (user_id) values (new.id) on conflict (user_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function private.staff_permissions_on_role() from public, anon, authenticated;
drop trigger if exists staff_permissions_on_role on public.profiles;
create trigger staff_permissions_on_role after insert or update of role on public.profiles
  for each row execute function private.staff_permissions_on_role();

-- Backfill existing staff (none expected on live at ship time) with all-off rows.
insert into public.staff_permissions (user_id)
select id from public.profiles where role = 'staff'
on conflict (user_id) do nothing;

-- RLS: staff policies now require the matching permission. Admin still passes via staff_can() (is_admin).
drop policy if exists meta_staff_select on public.student_meta;
create policy meta_staff_select on public.student_meta for select to authenticated
  using ((select private.is_admin()) or (select private.staff_can('view_students')) or (select private.staff_can('notes_tags')) or (select private.staff_can('reminders')));
drop policy if exists meta_staff_ins on public.student_meta;
create policy meta_staff_ins on public.student_meta for insert to authenticated
  with check ((select private.is_admin()) or (select private.staff_can('notes_tags')) or (select private.staff_can('reminders')));
drop policy if exists meta_staff_upd on public.student_meta;
create policy meta_staff_upd on public.student_meta for update to authenticated
  using ((select private.is_admin()) or (select private.staff_can('notes_tags')) or (select private.staff_can('reminders')))
  with check ((select private.is_admin()) or (select private.staff_can('notes_tags')) or (select private.staff_can('reminders')));

-- Tighten the existing guard: staff may only change the columns their permission covers.
create or replace function private.student_meta_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
declare old_test boolean := case when tg_op = 'UPDATE' then old.is_test else false end;
begin
  new.tags := coalesce((select array_agg(distinct left(lower(trim(t)), 30)) from unnest(new.tags) t where trim(t) <> ''), '{}');
  if new.is_test is distinct from old_test and (select auth.uid()) is not null and not private.is_admin() then
    raise exception 'Only admins can mark or unmark test records';
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

drop policy if exists notes_staff_select on public.student_notes;
create policy notes_staff_select on public.student_notes for select to authenticated
  using ((select private.is_admin()) or (select private.staff_can('notes_tags')));
drop policy if exists notes_staff_ins on public.student_notes;
create policy notes_staff_ins on public.student_notes for insert to authenticated
  with check (((select private.is_admin()) or (select private.staff_can('notes_tags'))) and created_by = (select auth.uid()));
drop policy if exists notes_own_upd on public.student_notes;
create policy notes_own_upd on public.student_notes for update to authenticated
  using ((select private.is_admin()) or (created_by = (select auth.uid()) and (select private.staff_can('notes_tags'))))
  with check ((select private.is_admin()) or (select private.staff_can('notes_tags')));
drop policy if exists notes_own_del on public.student_notes;
create policy notes_own_del on public.student_notes for delete to authenticated
  using ((select private.is_admin()) or (created_by = (select auth.uid()) and (select private.staff_can('notes_tags'))));

drop policy if exists batches_staff_select on public.batches;
create policy batches_staff_select on public.batches for select to authenticated
  using ((select private.is_admin()) or (select private.staff_can('batches')) or (select private.staff_can('attendance')));

drop policy if exists sess_staff_select on public.class_sessions;
create policy sess_staff_select on public.class_sessions for select to authenticated
  using ((select private.is_admin()) or (select private.staff_can('attendance')) or (select private.staff_can('batches')));
drop policy if exists sess_staff_ins on public.class_sessions;
create policy sess_staff_ins on public.class_sessions for insert to authenticated
  with check ((select private.is_admin()) or (select private.staff_can('attendance')));
drop policy if exists sess_staff_upd on public.class_sessions;
create policy sess_staff_upd on public.class_sessions for update to authenticated
  using ((select private.is_admin()) or (select private.staff_can('attendance')))
  with check ((select private.is_admin()) or (select private.staff_can('attendance')));

drop policy if exists att_staff_select on public.attendance;
create policy att_staff_select on public.attendance for select to authenticated
  using ((select private.is_admin()) or (select private.staff_can('attendance')));
drop policy if exists att_staff_ins on public.attendance;
create policy att_staff_ins on public.attendance for insert to authenticated
  with check ((select private.is_admin()) or (select private.staff_can('attendance')));
drop policy if exists att_staff_upd on public.attendance;
create policy att_staff_upd on public.attendance for update to authenticated
  using ((select private.is_admin()) or (select private.staff_can('attendance')))
  with check ((select private.is_admin()) or (select private.staff_can('attendance')));

drop policy if exists adj_staff_select on public.fee_adjustments;
create policy adj_staff_select on public.fee_adjustments for select to authenticated
  using ((select private.is_admin()) or (select private.staff_can('discounts_refunds')) or (select private.staff_can('view_students')));
