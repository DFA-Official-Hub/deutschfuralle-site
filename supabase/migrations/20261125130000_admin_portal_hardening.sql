-- Admin portal hardening (Head of Tech review of PR #12). Runs after 20261125120000. Safe to run more than once.
--  B1: staff can no longer insert enrollments (they use the pro_add_student function action); an INSERT can never
--      carry a certificate or a paid amount (enrollment_numbers() blanks certificate_issued_at/revoked_at and forces
--      amount_paid = 0, so only the payments trigger sets it).
--  B2: staff have no SELECT on enrollments, payments, email_log, enrollment_audit or admin_activity. Their lists come
--      from the admission function (masked contacts, no student details); every reveal is logged.
--  Also: refunds can't exceed what was paid (row lock), discounts/voids are atomic and void only once, a void puts
--      back the installment plan, at least one admin always remains (race-safe), attendance deletes are admin-only
--      and logged, actor_name/log_activity are not callable by API roles, storage limits on the documents bucket.

-- B1 / B2: drop the staff policies on the raw tables --------------------------------------------------
drop policy if exists enr_staff_ins on public.enrollments;
drop policy if exists enr_staff_select on public.enrollments;
drop policy if exists pay_staff_select on public.payments;
drop policy if exists elog_staff_select on public.email_log;
drop policy if exists act_staff_select on public.admin_activity;
do $$ begin
  if to_regclass('public.enrollment_audit') is not null then execute 'drop policy if exists audit_staff_select on public.enrollment_audit'; end if;
end $$;

-- B1: an INSERT never brings its own certificate or paid amount ----------------------------------------
create or replace function private.enrollment_numbers() returns trigger
language plpgsql security definer set search_path to '' as $function$
declare k text; y int := extract(year from (now() at time zone 'Asia/Karachi'))::int; lv text;
begin
  if tg_op = 'UPDATE' then
    -- numbers are permanent once given
    new.student_id := coalesce(old.student_id, new.student_id);
    new.invoice_no := coalesce(old.invoice_no, new.invoice_no); new.invoiced_at := coalesce(old.invoiced_at, new.invoiced_at);
    new.certificate_no := coalesce(old.certificate_no, new.certificate_no); new.certificate_code := coalesce(old.certificate_code, new.certificate_code);
    new.certificate_issued_at := coalesce(old.certificate_issued_at, new.certificate_issued_at);
  end if;
  if tg_op = 'INSERT' then
    -- a new row starts with nothing issued and nothing paid: certificates come from "certify" (admin),
    -- amount_paid only from the payments trigger (payments_sync_amount_paid)
    new.certificate_issued_at := null; new.certificate_revoked_at := null; new.amount_paid := 0;
  end if;
  if tg_op = 'INSERT' or new.student_id is null then
    if tg_op = 'INSERT' then new.student_id := null; new.invoice_no := null; new.certificate_no := null; new.certificate_code := null; end if;
    new.student_id := 'DFA-' || y || '-' || lpad(private.next_no('student', y)::text, 4, '0');
  end if;
  if new.course_code is not null and (tg_op = 'INSERT' or new.batch_code is null or new.course_code is distinct from old.course_code or new.start_date is distinct from old.start_date) then
    select short_code into k from public.courses where code = new.course_code;
    if k is not null then new.batch_code := k || '-' || to_char(coalesce(new.start_date, (coalesce(new.created_at, now()) at time zone 'Asia/Karachi')::date), 'YYMM'); end if;
  end if;
  if new.status = 'active' and new.invoice_no is null then
    new.invoice_no := 'INV-' || y || '-' || lpad(private.next_no('invoice', y)::text, 4, '0'); new.invoiced_at := now();
  end if;
  if new.certificate_issued_at is not null and new.certificate_no is null then
    select upper(replace(level, '-', '')) into lv from public.courses where code = new.course_code;
    lv := coalesce(lv, 'GEN');
    new.certificate_no := 'DFA-' || lv || '-' || y || '-' || lpad(private.next_no('cert-' || lv, y)::text, 4, '0');
    new.certificate_code := upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 12));
  end if;
  return new;
end $function$;

-- Private helpers are not callable by API roles (triggers call them as their owner) -------------------
revoke all on function private.actor_name(uuid) from public, anon, authenticated;
grant execute on function private.actor_name(uuid) to service_role;
revoke all on function private.log_activity(bigint, text, text, jsonb) from public, anon, authenticated;
grant execute on function private.log_activity(bigint, text, text, jsonb) to service_role;

-- Attendance: staff mark (insert/update), only an admin deletes, and every delete is logged ------------
drop policy if exists sess_staff_all on public.class_sessions;
drop policy if exists sess_staff_select on public.class_sessions;
create policy sess_staff_select on public.class_sessions for select to authenticated using ((select private.is_staff()));
drop policy if exists sess_staff_ins on public.class_sessions;
create policy sess_staff_ins on public.class_sessions for insert to authenticated with check ((select private.is_staff()));
drop policy if exists sess_staff_upd on public.class_sessions;
create policy sess_staff_upd on public.class_sessions for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
drop policy if exists sess_admin_del on public.class_sessions;
create policy sess_admin_del on public.class_sessions for delete to authenticated using ((select private.is_admin()));
drop policy if exists att_staff_all on public.attendance;
drop policy if exists att_staff_select on public.attendance;
create policy att_staff_select on public.attendance for select to authenticated using ((select private.is_staff()));
drop policy if exists att_staff_ins on public.attendance;
create policy att_staff_ins on public.attendance for insert to authenticated with check ((select private.is_staff()));
drop policy if exists att_staff_upd on public.attendance;
create policy att_staff_upd on public.attendance for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
drop policy if exists att_admin_del on public.attendance;
create policy att_admin_del on public.attendance for delete to authenticated using ((select private.is_admin()));

create or replace function private.class_session_delete_log() returns trigger
language plpgsql security definer set search_path to '' as $$
declare n int; bc text;
begin
  select count(*) into n from public.attendance where session_id = old.id;
  select code into bc from public.batches where id = old.batch_id;
  perform private.log_activity(null, 'attendance_deleted', 'Class of ' || to_char(old.session_date, 'DD Mon YYYY') || ' in batch ' || coalesce(bc, '?') || ' deleted (' || n || ' attendance marks)',
    jsonb_build_object('batch_id', old.batch_id, 'session_id', old.id, 'marks', n));
  return old;
end $$;
drop trigger if exists class_sessions_delete_log on public.class_sessions;
create trigger class_sessions_delete_log before delete on public.class_sessions for each row execute function private.class_session_delete_log();

create or replace function private.attendance_delete_log() returns trigger
language plpgsql security definer set search_path to '' as $$
declare dt date;
begin
  select session_date into dt from public.class_sessions where id = old.session_id;
  if dt is null then return old; end if;  -- the whole class is being deleted: logged once by class_sessions_delete_log
  perform private.log_activity(old.enrollment_id, 'attendance_deleted', 'Attendance mark (' || old.status || ') on ' || to_char(dt, 'DD Mon YYYY') || ' deleted',
    jsonb_build_object('session_id', old.session_id, 'status', old.status));
  return old;
end $$;
drop trigger if exists attendance_delete_log on public.attendance;
create trigger attendance_delete_log after delete on public.attendance for each row execute function private.attendance_delete_log();

-- Refunds: never more than what the student paid, even with two at the same moment -------------------
alter table public.fee_adjustments add column if not exists plan_before jsonb;
alter table public.fee_adjustments add column if not exists plan_after jsonb;
comment on column public.fee_adjustments.plan_before is 'Installment plan before this discount/scholarship; put back when it is voided (if the plan was not changed since).';
create or replace function private.refund_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
declare paid int; prior int;
begin
  if new.kind <> 'refund' then return new; end if;
  -- the lock makes concurrent refunds (and payment inserts, which lock the same row) wait for each other
  select coalesce(amount_paid, 0) into paid from public.enrollments where id = new.enrollment_id for no key update;
  if not found then raise exception 'DFA: student not found' using errcode = 'P0002'; end if;
  select coalesce(sum(amount), 0) into prior from public.fee_adjustments where enrollment_id = new.enrollment_id and kind = 'refund' and voided_at is null;
  if prior + new.amount > paid then
    raise exception 'DFA: Refunds can''t be more than what the student has paid (net PKR %).', to_char(paid - prior, 'FM999,999,990') using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists fee_adjustments_refund_guard on public.fee_adjustments;
create trigger fee_adjustments_refund_guard before insert on public.fee_adjustments for each row execute function private.refund_guard();

-- Discounts / scholarships / refunds: record + fee change in one transaction ------------------------
-- p_patch = new enrollment values computed by the admission function (prologic.applyDiscount):
--   {fee_total, installment_plan, due_date, reminder_stage, payment_plan}. Refunds pass null.
create or replace function public.fee_adjust_apply(p_row jsonb, p_expect_fee integer, p_expect_paid integer, p_expect_plan jsonb, p_patch jsonb)
returns public.fee_adjustments language plpgsql security definer set search_path to '' as $$
declare e public.enrollments; r public.fee_adjustments; k text := p_row->>'kind';
begin
  select * into e from public.enrollments where id = (p_row->>'enrollment_id')::bigint for update;
  if not found then raise exception 'DFA: student not found' using errcode = 'P0002'; end if;
  if k <> 'refund' and (e.fee_total is distinct from p_expect_fee or e.amount_paid is distinct from p_expect_paid
      or coalesce(e.installment_plan, 'null'::jsonb) is distinct from coalesce(p_expect_plan, 'null'::jsonb)) then
    raise exception 'DFA: changed meanwhile' using errcode = '40001';
  end if;
  insert into public.fee_adjustments (enrollment_id, kind, amount, reason, approved_by, method, reference, adj_date, fee_before, fee_after, plan_before, plan_after, created_by)
  values (e.id, k, (p_row->>'amount')::int, p_row->>'reason', p_row->>'approved_by', p_row->>'method', p_row->>'reference',
          coalesce((p_row->>'adj_date')::date, (now() at time zone 'Asia/Karachi')::date), e.fee_total,
          case when k = 'refund' then e.fee_total else (p_patch->>'fee_total')::int end,
          case when k = 'refund' then null else e.installment_plan end,
          case when k = 'refund' then null else nullif(p_patch->'installment_plan', 'null'::jsonb) end,
          nullif(p_row->>'created_by', '')::uuid)
  returning * into r;
  if k <> 'refund' then
    update public.enrollments set fee_total = (p_patch->>'fee_total')::int, installment_plan = nullif(p_patch->'installment_plan', 'null'::jsonb),
      due_date = (p_patch->>'due_date')::date, reminder_stage = coalesce((p_patch->>'reminder_stage')::smallint, reminder_stage),
      payment_plan = coalesce(p_patch->>'payment_plan', payment_plan)
     where id = e.id;
  end if;
  return r;
end $$;
-- Void: only once (conditional on voided_at is null), fee + plan restored in the same transaction.
create or replace function public.fee_adjust_void(p_id bigint, p_reason text, p_expect_fee integer, p_expect_plan jsonb, p_patch jsonb)
returns public.fee_adjustments language plpgsql security definer set search_path to '' as $$
declare a public.fee_adjustments; e public.enrollments;
begin
  select * into a from public.fee_adjustments where id = p_id;
  if not found then raise exception 'DFA: not found' using errcode = 'P0002'; end if;
  select * into e from public.enrollments where id = a.enrollment_id for update;
  update public.fee_adjustments set voided_at = now(), void_reason = left(p_reason, 300) where id = p_id and voided_at is null returning * into a;
  if not found then raise exception 'DFA: already void' using errcode = 'P0001'; end if;
  if a.kind <> 'refund' then
    if e.fee_total is distinct from p_expect_fee or coalesce(e.installment_plan, 'null'::jsonb) is distinct from coalesce(p_expect_plan, 'null'::jsonb) then
      raise exception 'DFA: changed meanwhile' using errcode = '40001';
    end if;
    update public.enrollments set fee_total = (p_patch->>'fee_total')::int, installment_plan = nullif(p_patch->'installment_plan', 'null'::jsonb),
      due_date = (p_patch->>'due_date')::date, reminder_stage = coalesce((p_patch->>'reminder_stage')::smallint, reminder_stage),
      payment_plan = coalesce(p_patch->>'payment_plan', payment_plan)
     where id = e.id;
  end if;
  return a;
end $$;
revoke all on function public.fee_adjust_apply(jsonb, integer, integer, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.fee_adjust_void(bigint, text, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.fee_adjust_apply(jsonb, integer, integer, jsonb, jsonb) to service_role;
grant execute on function public.fee_adjust_void(bigint, text, integer, jsonb, jsonb) to service_role;

-- At least one admin always remains (serialised with an advisory lock, so two demotions can't race) ---
create or replace function private.keep_one_admin() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role is distinct from 'admin') then
    perform pg_advisory_xact_lock(hashtext('dfa:last-admin'));
    if not exists (select 1 from public.profiles where role = 'admin' and id <> old.id) then
      raise exception 'DFA: At least one admin must remain.' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists profiles_keep_one_admin on public.profiles;
create trigger profiles_keep_one_admin before update of role or delete on public.profiles for each row execute function private.keep_one_admin();

-- Staff payment recording is off until an admin switches it on (Ali's decision pending) --------------
insert into public.site_settings (key, value) values ('staff_payments', 'off') on conflict (key) do nothing;

-- Storage: the private documents bucket takes PDFs and images up to 10 MB (payment slips: 5 MB, checked by the function)
do $$ begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets set file_size_limit = 10485760, allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] where id = 'documents';
  end if;
end $$;
