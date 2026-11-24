-- A payment can't be voided or lowered below the live refunds of its enrollment (Head of Tech review, round 2, R2-1).
-- Without this, 10,000 paid + 4,000 refunded + payment voided left amount_paid 0 with 4,000 still refunded.
-- Same row lock as refund_guard and payments_sync_amount_paid, so a refund and a void can't pass each other.
-- TEST deletes need no exemption: they delete the enrollment (cascade), which never fires this UPDATE trigger.
create or replace function private.payment_refund_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
declare paid bigint; refunds bigint;
begin
  if new.voided_at is not distinct from old.voided_at and new.amount is not distinct from old.amount then return new; end if;
  perform 1 from public.enrollments where id = new.enrollment_id for no key update;
  select coalesce(sum(amount), 0) into paid from public.payments where enrollment_id = new.enrollment_id and voided_at is null and id <> new.id;
  if new.voided_at is null then paid := paid + new.amount; end if;
  select coalesce(sum(amount), 0) into refunds from public.fee_adjustments where enrollment_id = new.enrollment_id and kind = 'refund' and voided_at is null;
  if paid < refunds then
    raise exception 'This payment has refunds against it. Void the refund first.' using errcode = '23514', hint = 'DFA_REFUND_GUARD';
  end if;
  return new;
end $$;
revoke all on function private.payment_refund_guard() from public, anon, authenticated;
drop trigger if exists payments_refund_guard on public.payments;
create trigger payments_refund_guard before update of voided_at, amount on public.payments for each row execute function private.payment_refund_guard();
