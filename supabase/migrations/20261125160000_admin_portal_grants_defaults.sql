-- R4-1: stop new tables silently missing grants, revoke MAINTAIN, and grant enrollment_audit to match its existing admin SELECT policy.
-- Default privileges apply only to tables created later by postgres (this project's migration role). They do not widen the
-- function-only tables already granted more narrowly in 20261125150000. RLS still decides which rows anyone sees.
-- anon still gets nothing. MAINTAIN (PG17) is revoked on the portal tables, alongside truncate/references/trigger from 150000.
alter default privileges for role postgres in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon;

grant select on public.enrollment_audit to authenticated;  -- policy audit_admin_select already existed; same missing-grant bug as #16

revoke all on public.enrollment_audit from anon;
revoke truncate, references, trigger, maintain on public.batches, public.class_sessions, public.attendance, public.student_notes,
              public.student_meta, public.fee_adjustments, public.admin_activity, public.account_meta, public.enrollment_audit from authenticated;
