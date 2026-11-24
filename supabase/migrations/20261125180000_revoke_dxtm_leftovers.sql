-- Leftover default ACL (Dxtm: TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) on six older public tables
-- that have no RLS policies for anon/authenticated. TRUNCATE bypasses RLS. Idempotent: REVOKE of
-- missing privileges is a no-op, and missing tables (not in the local test stub) are skipped.
-- SELECT/INSERT/UPDATE/DELETE are left unchanged.
do $r$
declare t text;
begin
  foreach t in array array['disposable_domains', 'email_codes', 'grade_rate', 'registration_details', 'site_settings', 'verified_sessions']
  loop
    if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname = t) then
      execute format('revoke truncate, references, trigger, maintain on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $r$;
