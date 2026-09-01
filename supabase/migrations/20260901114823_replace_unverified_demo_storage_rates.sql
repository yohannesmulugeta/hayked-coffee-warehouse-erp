-- Remove earlier seeded demonstration bands and leave one exact, traceable
-- transcription. The guard prevents replacement after Finance activates or
-- verifies the tariff.

do $$
declare
  v_tariff_id uuid;
  v_rate_count integer;
begin
  select tariff.id
  into v_tariff_id
  from public.tariff_versions tariff
  where tariff.version_code = 'TARIFF-2026-V1'
    and tariff.active = false
    and tariff.verified_by_1 is null
    and tariff.verified_by_2 is null
  for update;

  if v_tariff_id is null then
    raise exception 'TARIFF-2026-V1 must remain inactive and unverified while replacing demo rates.';
  end if;

  delete from public.tariff_line_items
  where tariff_version_id = v_tariff_id;

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
    v_tariff_id,
    rate.category,
    rate.age_start_days,
    rate.age_end_days,
    rate.daily_rate_per_unit,
    rate.certified,
    rate.source_clause,
    rate.source_pdf_page
  from (values
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
  ) rate(category, age_start_days, age_end_days, daily_rate_per_unit, certified, source_clause, source_pdf_page);

  select count(*)
  into v_rate_count
  from public.tariff_line_items
  where tariff_version_id = v_tariff_id;

  if v_rate_count <> 15 then
    raise exception 'Expected 15 Agreement 001/2018 storage rate bands, found %.', v_rate_count;
  end if;
end;
$$;
