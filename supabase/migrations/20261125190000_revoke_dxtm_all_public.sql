-- Follow-up to 160000/180000: leftover TRUNCATE, REFERENCES and TRIGGER on older public tables
-- (auth_devices, book_catalog, course_books, courses, email_log, enrollments, exam_attempts,
-- login_events, payments, profiles, reader_devices, reviews, security_prefs, …).
-- MAINTAIN was already revoked on every public table in 160000. SELECT/INSERT/UPDATE/DELETE are
-- left unchanged. Idempotent: REVOKE of missing privileges is a no-op.
do $r$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', t);
  end loop;
end $r$;
