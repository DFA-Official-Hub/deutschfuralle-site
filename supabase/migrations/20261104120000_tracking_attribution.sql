-- DFA tracking v1 (spec section 5.1). NOT applied by this PR: apply on a preview branch / staging copy first, then production per the rollout order (spec section 10).
-- Additive only: no drops, no changes to existing columns, RLS stays enabled with no anon/authenticated access.

-- 1) Attribution on existing mock exam leads
alter table public.mock_exam_leads add column if not exists form_type      text not null default 'Mock Exam';
alter table public.mock_exam_leads add column if not exists utm_source     text;
alter table public.mock_exam_leads add column if not exists utm_medium     text;
alter table public.mock_exam_leads add column if not exists utm_campaign   text;
alter table public.mock_exam_leads add column if not exists utm_content    text;
alter table public.mock_exam_leads add column if not exists landing_page   text;
alter table public.mock_exam_leads add column if not exists first_touch_at timestamptz;
alter table public.mock_exam_leads add column if not exists gclid          text;
alter table public.mock_exam_leads add column if not exists fbclid         text;
alter table public.mock_exam_leads add column if not exists event_id       uuid;

-- 2) New table for registration-form leads
create table if not exists public.registration_leads (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  form_type      text not null default 'Registration' check (form_type in ('Registration','WhatsApp')),
  name           text not null check (char_length(name) between 1 and 120),
  phone          text not null check (phone ~ '^\+[0-9]{8,15}$'),
  email          text,
  course         text not null,
  timing         text not null,
  message        text,
  send_via       text not null default 'wa' check (send_via in ('wa','mail')),
  consent        boolean not null default false,
  consent_text   text,
  utm_source     text,
  utm_medium     text,
  utm_campaign   text,
  utm_content    text,
  landing_page   text,
  first_touch_at timestamptz,
  gclid          text,
  fbclid         text,
  event_id       uuid,
  page           text,
  user_agent     text,
  is_test        boolean not null default false
);
create index if not exists registration_leads_phone_created_idx on public.registration_leads (phone, created_at desc);
alter table public.registration_leads enable row level security;
-- Deliberately NO policies: only the service role (Edge Function `leads`) can insert/select.
revoke all on public.registration_leads from anon, authenticated;
