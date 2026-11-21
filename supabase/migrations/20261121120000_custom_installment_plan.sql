-- Custom fee installment plans (2 to 5 installments, admin-chosen amounts and due dates).
-- enrollments.installment_plan holds the agreed schedule: [{"no":1,"amount":10000,"due":"2026-11-21"}, ...].
-- Paid/unpaid per installment is derived from enrollments.amount_paid + payments (paid in order), so
-- "Record payment" keeps working without a second source of truth.
alter table public.enrollments add column if not exists installment_plan jsonb;

alter table public.enrollments drop constraint if exists enrollments_installment_plan_check;
alter table public.enrollments add constraint enrollments_installment_plan_check check (
  installment_plan is null
  or (jsonb_typeof(installment_plan) = 'array' and jsonb_array_length(installment_plan) between 2 and 5)
);

-- Allow the new plan type next to the existing ones.
alter table public.enrollments drop constraint if exists enrollments_payment_plan_check;
alter table public.enrollments add constraint enrollments_payment_plan_check check (payment_plan = any (array['full'::text, 'two'::text, 'custom'::text]));

comment on column public.enrollments.installment_plan is 'Custom fee schedule set by admin: array of {no, amount, due}. Null for full / legacy two-installment plans.';

-- Receipt label for payments on a custom plan, e.g. "Installment 2 of 3 (part payment)" or "Installments 2–3 of 3".
alter table public.payments add column if not exists installment_label text;
comment on column public.payments.installment_label is 'Which plan installment(s) this payment covers; printed on the receipt. Null for full / legacy plans.';

-- Optional payment method (Finance).
alter table public.payments add column if not exists method text;
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check check (method is null or method = any (array['cash'::text, 'bank'::text, 'jazzcash'::text, 'easypaisa'::text, 'other'::text]));
comment on column public.payments.method is 'How the money was paid: cash, bank (bank transfer), jazzcash, easypaisa or other. Optional.';

-- One running payment number per student, so two payments saved at the same moment can't both be stored as the same number.
-- Checked on 2026-11-21: no existing duplicates of (enrollment_id, installment_no).
create unique index if not exists payments_enrollment_installment_no_key on public.payments (enrollment_id, installment_no);
