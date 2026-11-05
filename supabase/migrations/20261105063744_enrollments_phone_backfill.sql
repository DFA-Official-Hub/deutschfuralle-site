-- Backfill enrollments.phone from registration_details / profiles (safe fill only).
-- Prefer sheet_row match, then email match, then profiles.phone.
with candidates as (
  select distinct on (e.id)
    e.id,
    coalesce(
      nullif(trim(rd_sheet.data->>'Mobile Number'), ''),
      nullif(trim(rd_sheet.data->>'Phone'), ''),
      nullif(trim(rd_email.data->>'Mobile Number'), ''),
      nullif(trim(rd_email.data->>'Phone'), ''),
      nullif(trim(p.phone), '')
    ) as mobile
  from public.enrollments e
  left join public.registration_details rd_sheet
    on e.sheet_row is not null and rd_sheet.sheet_row = e.sheet_row
  left join public.registration_details rd_email
    on lower(trim(coalesce(rd_email.email, ''))) = lower(trim(e.email))
    or lower(trim(coalesce(rd_email.data->>'Email ID', ''))) = lower(trim(e.email))
  left join auth.users u on lower(u.email) = lower(trim(e.email))
  left join public.profiles p on p.id = u.id
  where e.phone is null or trim(e.phone) = ''
  order by e.id,
    case
      when nullif(trim(rd_sheet.data->>'Mobile Number'), '') is not null then 0
      when nullif(trim(rd_email.data->>'Mobile Number'), '') is not null then 1
      when nullif(trim(p.phone), '') is not null then 2
      else 3
    end
),
cleaned as (
  select id, mobile
  from candidates
  where mobile is not null
    and length(regexp_replace(mobile, '\D', '', 'g')) between 10 and 15
    and regexp_replace(mobile, '\D', '', 'g') !~ '^0+$'
)
update public.enrollments e
set phone = c.mobile
from cleaned c
where e.id = c.id;
