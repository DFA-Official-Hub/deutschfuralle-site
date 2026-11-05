-- Drop finished/failed doc_jobs older than 30 days (daily, after security cleanup).
select cron.schedule(
  'dfa-doc-jobs-cleanup',
  '45 3 * * *',
  $cmd$
    delete from public.doc_jobs
    where status in ('done', 'skipped', 'error')
      and updated_at < now() - interval '30 days';
  $cmd$
);
