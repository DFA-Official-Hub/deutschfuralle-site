-- Admin portal: table privileges for the signed-in role (found in live QA after deploy, 25 Nov 2026).
-- This project has no default SELECT/INSERT/UPDATE/DELETE grants for `authenticated` on new tables, so the
-- tables from 20261125120000 were unreachable from the admin page ("permission denied for table batches").
-- RLS (already on, policies in 20261125120000/130000) still decides who sees and changes which rows;
-- each grant below matches an existing policy, nothing more. anon gets nothing.
grant select, insert, update, delete on public.batches        to authenticated;
grant select, insert, update, delete on public.class_sessions to authenticated;
grant select, insert, update, delete on public.attendance     to authenticated;
grant select, insert, update, delete on public.student_notes  to authenticated;
grant select, insert, update         on public.student_meta   to authenticated;
grant select                         on public.fee_adjustments to authenticated;  -- written by the admission function only
grant select                         on public.admin_activity  to authenticated;  -- written by triggers / the function only
grant select                         on public.account_meta    to authenticated;  -- written by the admission function only
revoke all on public.batches, public.class_sessions, public.attendance, public.student_notes, public.student_meta,
              public.fee_adjustments, public.admin_activity, public.account_meta from anon;
revoke truncate, references, trigger on public.batches, public.class_sessions, public.attendance, public.student_notes,
              public.student_meta, public.fee_adjustments, public.admin_activity, public.account_meta from authenticated;
