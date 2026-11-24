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

-- 4) The student's paid total always equals the sum of their counted (non-voided) payments.
--    Kept by the database on every payment insert / update / delete, so two saves at the same moment
--    (two corrections, or a correction next to a new payment) can't leave amount_paid out of step.
--    balance_due is a generated column (fee_total - amount_paid), so it follows automatically.
--    The enrollment row is locked first, then the sum is read in a fresh statement, so concurrent
--    changes for the same student are applied one after the other.
create or replace function private.sync_amount_paid() returns trigger
language plpgsql security definer set search_path = '' as $$
declare eid bigint; s bigint;
begin
  foreach eid in array (case when tg_op = 'UPDATE' and old.enrollment_id is distinct from new.enrollment_id then array[old.enrollment_id, new.enrollment_id]
                             when tg_op = 'DELETE' then array[old.enrollment_id] else array[new.enrollment_id] end) loop
    continue when eid is null;
    perform 1 from public.enrollments where id = eid for no key update;  -- no key: payments' FK share locks don't conflict, so no lock-upgrade deadlock
    select coalesce(sum(amount), 0) into s from public.payments where enrollment_id = eid and voided_at is null;
    update public.enrollments set amount_paid = s where id = eid and amount_paid is distinct from s;
  end loop;
  return null;
end $$;
revoke all on function private.sync_amount_paid() from public, anon, authenticated;
drop trigger if exists payments_sync_amount_paid on public.payments;
create trigger payments_sync_amount_paid after insert or delete or update of amount, voided_at, enrollment_id on public.payments
  for each row execute function private.sync_amount_paid();
-- One-time consistency pass (safe to re-run): students with payments get amount_paid = sum of their live payments.
update public.enrollments e set amount_paid = t.s from (select enrollment_id, coalesce(sum(amount) filter (where voided_at is null), 0) s from public.payments group by enrollment_id) t where t.enrollment_id = e.id and e.amount_paid is distinct from t.s;
