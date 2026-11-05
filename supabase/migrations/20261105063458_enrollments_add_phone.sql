-- Student WhatsApp/mobile for admin contact (optional).
-- Visible via existing enrollments RLS: admin (all) or the student themself (own row).
-- Never exposed on public pages; admin UI only.
alter table public.enrollments
  add column if not exists phone text;

comment on column public.enrollments.phone is
  'Student WhatsApp/mobile for admin contact (optional). Not shown on public pages.';
