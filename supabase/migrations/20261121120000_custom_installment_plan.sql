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
