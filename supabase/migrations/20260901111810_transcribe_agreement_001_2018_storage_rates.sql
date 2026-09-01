-- Transcribe the storage-rate clauses visible in signed Agreement 001/2018.
-- This is deliberately a draft: the tariff stays inactive with no verifier
-- identities until Finance confirms the Amharic transcription and the
-- 30-day interpretation used for each "three month" band.

begin;

alter table public.tariff_line_items
  add column if not exists source_clause text,
  add column if not exists source_pdf_page smallint check (source_pdf_page is null or source_pdf_page > 0);

update public.tariff_versions
set description = 'Agreement 001/2018 storage rates - draft transcription from CamScanner 07-06-2026 13.21.pdf; three-month bands represented as 90 days pending Finance confirmation',
    active = false,
    verified_by_1 = null,
    verified_by_2 = null
where version_code = 'TARIFF-2026-V1';

insert into public.tariff_line_items (
  tariff_version_id,
  category,
  age_start_days,
  age_end_days,
  daily_rate_per_unit,
  certified,
  source_clause,
  source_pdf_page
)
select
  tariff.id,
  rate.category,
  rate.age_start_days,
  rate.age_end_days,
  rate.daily_rate_per_unit,
  rate.certified,
  rate.source_clause,
  rate.source_pdf_page
from public.tariff_versions tariff
cross join (values
  ('NO_PROCESSING',       1,   90,   5.00, false, '14.2', 8),
  ('NO_PROCESSING',       91,  null, 7.00, false, '14.3', 8),
  ('WAITING_PROCESSING',  1,   20,   0.00, false, '15.1', 8),
  ('WAITING_PROCESSING',  21,  110,  2.75, false, '15.2', 9),
  ('WAITING_PROCESSING',  111, null, 3.50, false, '15.3', 9),
  ('EMPTY_BAGS',          1,   10,   0.00, false, '16.1', 9),
  ('EMPTY_BAGS',          11,  40,   4.00, false, '16.2', 9),
  ('EMPTY_BAGS',          41,  null, 5.00, false, '16.3', 9),
  ('PROCESSED_EXPORT',    1,   15,   0.00, false, '17.1', 10),
  ('PROCESSED_EXPORT',    16,  105,  3.00, false, '17.2', 10),
  ('PROCESSED_EXPORT',    106, null, 5.00, false, '17.3', 10),
  ('PROCESSED_EXPORT',    106, null, 6.00, true,  '17.3', 10),
  ('REJECT',              1,   10,   0.00, false, '18.1', 10),
  ('REJECT',              11,  30,   4.00, false, '18.2', 10),
  ('REJECT',              31,  null, 6.00, false, '18.3', 10)
) rate(category, age_start_days, age_end_days, daily_rate_per_unit, certified, source_clause, source_pdf_page)
where tariff.version_code = 'TARIFF-2026-V1'
  and not exists (
    select 1
    from public.tariff_line_items existing
    where existing.tariff_version_id = tariff.id
      and existing.category = rate.category
      and existing.age_start_days = rate.age_start_days
      and existing.certified = rate.certified
  );

commit;
