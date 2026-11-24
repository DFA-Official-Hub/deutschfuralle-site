-- Student details edited by staff, payment corrections and an audit trail. Safe to run more than once.

-- 1) Staff overrides for what the documents show. Keys (all optional): full_name, dob (YYYY-MM-DD), cnic, email,
--    phone, gender, address, city, state, country, qualification. Missing keys fall back to the registration form
--    copy (registration_details). The student can read their own enrollment row, so only the values live here;
--    who changed what, and when, is kept in enrollment_audit (staff only).
alter table public.enrollments add column if not exists student_info jsonb;
alter table public.enrollments drop constraint if exists enrollments_student_info_check;
alter table public.enrollments add constraint enrollments_student_info_check check (student_info is null or jsonb_typeof(student_info) = 'object');
comment on column public.enrollments.student_info is 'Student details set by staff in the admin portal (override the registration form copy on every document). History in enrollment_audit.';

-- 2) Payment corrections. A voided payment stays for the record but no longer counts towards amount_paid.
--    revision counts re-issued receipts: the invoice number stays, the PDF is saved as INV-…-R<n>.pdf and marked "Revised".
alter table public.payments add column if not exists voided_at timestamptz;
alter table public.payments add column if not exists void_reason text;
alter table public.payments add column if not exists revision integer not null default 0;
comment on column public.payments.voided_at is 'Set when staff void this payment (entered by mistake). Voided payments are not counted.';
comment on column public.payments.revision is 'Receipt revision. 0 = original receipt; 1, 2, … = receipt re-issued after a correction (same invoice number, marked Revised).';

-- 3) Audit trail (staff only). kind: student_info | payment_correct | payment_void.
create table if not exists public.enrollment_audit (
  id bigint generated always as identity primary key,
  enrollment_id bigint not null references public.enrollments(id) on delete cascade,
  payment_id bigint references public.payments(id) on delete set null,
  kind text not null check (kind in ('student_info', 'payment_correct', 'payment_void')),
  reason text,
  old_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists enrollment_audit_enrollment_idx on public.enrollment_audit (enrollment_id, changed_at desc);
alter table public.enrollment_audit enable row level security;
drop policy if exists audit_admin_select on public.enrollment_audit;
create policy audit_admin_select on public.enrollment_audit for select to authenticated using ((select private.is_admin()));
-- No insert/update/delete policies: only the admission function (service role) writes, so entries can't be edited from the browser.
revoke insert, update, delete on public.enrollment_audit from anon, authenticated;
comment on table public.enrollment_audit is 'Who changed a student''s details or corrected a payment, when, why, and the old -> new values.';
