-- Background document/email jobs for admission activation (idempotent, free-tier safe).
create table if not exists public.doc_jobs (
  id bigserial primary key,
  enrollment_id bigint not null references public.enrollments(id) on delete cascade,
  kind text not null check (kind in ('admission','receipt','welcome')),
  status text not null default 'pending' check (status in ('pending','running','done','error','skipped')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrollment_id, kind)
);
create index if not exists doc_jobs_pending_idx on public.doc_jobs (status, id) where status in ('pending','error');
alter table public.doc_jobs enable row level security;
-- service role / edge function only; no public policies
revoke all on public.doc_jobs from anon, authenticated;
grant all on public.doc_jobs to service_role;
grant usage, select on sequence public.doc_jobs_id_seq to service_role;
