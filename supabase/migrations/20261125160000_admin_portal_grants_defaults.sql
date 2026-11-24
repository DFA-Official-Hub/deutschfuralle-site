-- R4-1 / R5 (B18-1): stop new tables silently missing DML grants, without leaving TRUNCATE or MAINTAIN on them.
-- Production default ACL for role postgres in schema public is already authenticated=Dxtm and anon=Dxtm.
-- GRANT select/insert/update/delete on top of that would leave new tables at arwdDxtm (TRUNCATE bypasses RLS, plus MAINTAIN).
-- Revoke everything first, then grant only the four DML privileges to authenticated. anon stays with nothing.
-- This does not widen the function-only tables already granted more narrowly in 20261125150000.
-- RLS still decides which rows anyone sees.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public grant select, insert, update, delete on tables to authenticated;

grant select on public.enrollment_audit to authenticated;  -- policy audit_admin_select already existed; same missing-grant bug as #16

revoke all on public.enrollment_audit from anon;
revoke truncate, references, trigger, maintain on public.batches, public.class_sessions, public.attendance, public.student_notes,
              public.student_meta, public.fee_adjustments, public.admin_activity, public.account_meta, public.enrollment_audit from authenticated;
-- Optional (R5): MAINTAIN is not needed in the browser on any public table, including older ones (enrollments, payments, …).
do $m$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('revoke maintain on public.%I from authenticated, anon', t);
  end loop;
end $m$;
