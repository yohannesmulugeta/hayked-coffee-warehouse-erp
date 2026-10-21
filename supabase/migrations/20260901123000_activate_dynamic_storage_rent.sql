-- Activate the signed storage tariff without employee verification and charge
-- coffee from the daily kg balance converted by the client's agreement bag
-- weight. Empty bags continue to use actual bag movements in groups of 50.

update public.tariff_versions
set active = true,
    description = 'Agreement 001/2018 storage rates; three-month bands represented as 90 days pending Finance confirmation'
where version_code = 'TARIFF-2026-V1';

alter table public.storage_billing_run_days
  add column if not exists opening_kg numeric(16,3) not null default 0,
  add column if not exists movement_kg numeric(16,3) not null default 0,
  add column if not exists closing_kg numeric(16,3) not null default 0 check (closing_kg >= 0),
  add column if not exists billing_basis text not null default 'LEGACY_BAGS'
    check (billing_basis in ('LEGACY_BAGS', 'EQUIVALENT_BAG_FROM_KG', 'FIFTY_EMPTY_BAGS')),
  add column if not exists bag_weight_kg numeric(8,3) not null default 60 check (bag_weight_kg > 0);

create or replace function private.storage_billing_daily_rows_v2(
  p_client_id uuid,
  p_lot_id uuid,
  p_category text,
  p_period_start date,
  p_period_end date,
  p_certified boolean,
  p_tariff_version text
)
returns table (
  charge_date date,
  opening_bags numeric,
  movement_bags numeric,
  closing_bags numeric,
  opening_kg numeric,
  movement_kg numeric,
  closing_kg numeric,
  age_day integer,
  rate_etb numeric,
  billable_units numeric,
  amount_etb numeric,
  billing_basis text,
  bag_weight_kg numeric,
  movement_references text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_received_date date;
  v_tariff_id uuid;
  v_certified boolean;
  v_bag_weight_kg numeric;
  v_billing_basis text;
begin
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'Choose a valid storage billing date range.';
  end if;

  select coalesce(receipt.arrival_at::date, lot.created_at::date)
  into v_received_date
  from public.coffee_lots lot
  left join public.warehouse_receipts receipt on receipt.id = lot.receipt_id
  where lot.id = p_lot_id and lot.client_id = p_client_id;

  if v_received_date is null then
    raise exception 'The selected lot does not belong to the selected client.';
  end if;
  if p_period_start < v_received_date then
    raise exception 'Storage billing cannot start before the lot was received.';
  end if;

  select agreement.default_bag_weight_kg
  into v_bag_weight_kg
  from public.agreements agreement
  where agreement.client_id = p_client_id
    and agreement.tariff_version = p_tariff_version
    and agreement.status in ('ACTIVE', 'EXPIRED')
    and agreement.effective_from <= p_period_start
    and (agreement.effective_to is null or agreement.effective_to >= p_period_end)
  order by agreement.effective_from desc
  limit 1;

  if v_bag_weight_kg is null then
    select coalesce(receipt.bag_weight_kg, receipt.net_weight_kg / nullif(receipt.bag_count, 0))
    into v_bag_weight_kg
    from public.coffee_lots lot
    join public.warehouse_receipts receipt on receipt.id = lot.receipt_id
    where lot.id = p_lot_id;
  end if;
  if v_bag_weight_kg is null or v_bag_weight_kg <= 0 then
    raise exception 'A positive agreement or receiving bag weight is required for storage rent.';
  end if;

  v_certified := private.lot_is_certified_for_period(p_lot_id, p_period_start, p_period_end);
  v_billing_basis := case when p_category = 'EMPTY_BAGS'
    then 'FIFTY_EMPTY_BAGS' else 'EQUIVALENT_BAG_FROM_KG' end;

  select tariff.id
  into v_tariff_id
  from public.tariff_versions tariff
  where tariff.version_code = p_tariff_version
    and tariff.active
    and tariff.effective_from <= p_period_start
    and (tariff.effective_to is null or tariff.effective_to >= p_period_end);

  if v_tariff_id is null then
    raise exception 'No active storage tariff covers the selected date range.';
  end if;

  if exists (
    select 1
    from generate_series(p_period_start, p_period_end, interval '1 day') day
    where not exists (
      select 1
      from public.tariff_line_items rate
      where rate.tariff_version_id = v_tariff_id
        and rate.category = p_category
        and rate.certified = v_certified
        and ((day::date - v_received_date) + 1) >= rate.age_start_days
        and (rate.age_end_days is null or ((day::date - v_received_date) + 1) <= rate.age_end_days)
    )
  ) then
    raise exception 'The active tariff has no rate for part of this date range, category, or certification.';
  end if;

  return query
  with days as (
    select day::date as charge_date
    from generate_series(v_received_date, p_period_end, interval '1 day') day
  ),
  daily as (
    select days.charge_date,
      coalesce(sum(movement.bag_delta), 0)::numeric as movement_bags,
      coalesce(sum(movement.quantity_kg), 0)::numeric as movement_kg,
      coalesce(array_agg(distinct movement.reference_type || ':' || left(movement.reference_id::text, 8))
        filter (where movement.id is not null), '{}')::text[] as movement_references
    from days
    left join public.stock_movements movement
      on movement.lot_id = p_lot_id and movement.occurred_at::date = days.charge_date
    group by days.charge_date
  ),
  balances as (
    select daily.*,
      coalesce(sum(daily.movement_bags) over (
        order by daily.charge_date rows between unbounded preceding and 1 preceding
      ), 0)::numeric as opening_bags,
      sum(daily.movement_bags) over (order by daily.charge_date)::numeric as closing_bags,
      coalesce(sum(daily.movement_kg) over (
        order by daily.charge_date rows between unbounded preceding and 1 preceding
      ), 0)::numeric as opening_kg,
      sum(daily.movement_kg) over (order by daily.charge_date)::numeric as closing_kg
    from daily
  )
  select balance.charge_date,
    balance.opening_bags, balance.movement_bags, balance.closing_bags,
    balance.opening_kg, balance.movement_kg, balance.closing_kg,
    ((balance.charge_date - v_received_date) + 1)::integer,
    rate.daily_rate_per_unit::numeric,
    (case when p_category = 'EMPTY_BAGS'
      then balance.closing_bags / 50
      else balance.closing_kg / v_bag_weight_kg end)::numeric,
    round((case when p_category = 'EMPTY_BAGS'
      then balance.closing_bags / 50
      else balance.closing_kg / v_bag_weight_kg end) * rate.daily_rate_per_unit, 2)::numeric,
    v_billing_basis,
    v_bag_weight_kg,
    balance.movement_references
  from balances balance
  join lateral (
    select line.daily_rate_per_unit
    from public.tariff_line_items line
    where line.tariff_version_id = v_tariff_id
      and line.category = p_category
      and line.certified = v_certified
      and ((balance.charge_date - v_received_date) + 1) >= line.age_start_days
      and (line.age_end_days is null or ((balance.charge_date - v_received_date) + 1) <= line.age_end_days)
    order by line.age_start_days desc
    limit 1
  ) rate on true
  where balance.charge_date >= p_period_start
  order by balance.charge_date;
end;
$$;

revoke all on function private.storage_billing_daily_rows_v2(uuid, uuid, text, date, date, boolean, text)
  from public, anon, authenticated;

create or replace function public.quote_storage_billing(
  p_client_id uuid,
  p_lot_id uuid,
  p_category text,
  p_period_start date,
  p_period_end date,
  p_certified boolean default false,
  p_tariff_version text default 'TARIFF-2026-V1'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'finance_officer', 'auditor', 'viewer');

  select jsonb_build_object(
    'tariffVersion', p_tariff_version,
    'billingBasis', max(row.billing_basis),
    'bagWeightKg', max(row.bag_weight_kg),
    'duplicateKey', p_client_id::text || '|' || p_lot_id::text || '|' || p_category || '|' || p_period_start::text || '|' || p_period_end::text || '|' || p_tariff_version,
    'billableBagDays', coalesce(sum(row.billable_units) filter (where row.rate_etb > 0 and row.billable_units > 0), 0),
    'amount', coalesce(sum(row.amount_etb) filter (where row.rate_etb > 0 and row.billable_units > 0), 0),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'date', row.charge_date,
      'openingBags', row.opening_bags,
      'movementBags', row.movement_bags,
      'closingBags', row.closing_bags,
      'openingKg', row.opening_kg,
      'movementKg', row.movement_kg,
      'closingKg', row.closing_kg,
      'ageDay', row.age_day,
      'rate', row.rate_etb,
      'units', row.billable_units,
      'amount', row.amount_etb,
      'references', row.movement_references
    ) order by row.charge_date), '[]'::jsonb)
  )
  into v_result
  from private.storage_billing_daily_rows_v2(
    p_client_id, p_lot_id, p_category, p_period_start, p_period_end, p_certified, p_tariff_version
  ) row;

  return v_result;
end;
$$;

create or replace function public.calculate_and_save_storage_billing_v2(
  p_client_id uuid,
  p_lot_id uuid,
  p_category text,
  p_period_start date,
  p_period_end date,
  p_certified boolean default false,
  p_tariff_version text default 'TARIFF-2026-V1'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_duplicate_key text;
  v_run_number text;
  v_run_id uuid;
  v_billable_units numeric;
  v_total numeric;
begin
  perform private.require_role('system_admin', 'finance_officer', 'warehouse_manager');

  v_duplicate_key := p_client_id::text || '|' || p_lot_id::text || '|' || p_category || '|' || p_period_start::text || '|' || p_period_end::text || '|' || p_tariff_version;
  if exists (select 1 from public.storage_billing_runs where duplicate_key = v_duplicate_key) then
    raise exception 'A billing run for this lot and date range has already been executed.';
  end if;

  select coalesce(sum(row.billable_units) filter (where row.rate_etb > 0 and row.billable_units > 0), 0),
    coalesce(sum(row.amount_etb) filter (where row.rate_etb > 0 and row.billable_units > 0), 0)
  into v_billable_units, v_total
  from private.storage_billing_daily_rows_v2(
    p_client_id, p_lot_id, p_category, p_period_start, p_period_end, p_certified, p_tariff_version
  ) row;

  if v_billable_units <= 0 or v_total <= 0 then
    raise exception 'There is no billable storage charge in the selected period.';
  end if;

  v_run_number := 'SBR-' || to_char(now(), 'YYYYMMDD') || '-' || floor(random() * 8999 + 1000)::text;
  insert into public.storage_billing_runs (
    run_number, client_id, lot_id, category, period_start, period_end,
    tariff_version, certified, billable_bag_days, total_amount, duplicate_key, run_by
  ) values (
    v_run_number, p_client_id, p_lot_id, p_category, p_period_start, p_period_end,
    p_tariff_version, p_certified, v_billable_units, v_total, v_duplicate_key, v_user_id
  ) returning id into v_run_id;

  insert into public.storage_billing_run_days (
    run_id, charge_date, opening_bags, movement_bags, closing_bags,
    opening_kg, movement_kg, closing_kg, billing_basis, bag_weight_kg,
    age_day, rate_etb, billable_units, amount_etb, movement_references
  )
  select v_run_id, row.charge_date, row.opening_bags, row.movement_bags, row.closing_bags,
    row.opening_kg, row.movement_kg, row.closing_kg, row.billing_basis, row.bag_weight_kg,
    row.age_day, row.rate_etb, row.billable_units, row.amount_etb, row.movement_references
  from private.storage_billing_daily_rows_v2(
    p_client_id, p_lot_id, p_category, p_period_start, p_period_end, p_certified, p_tariff_version
  ) row;

  insert into public.service_events (
    client_id, lot_id, service_type, description, quantity, unit_price, total_amount, reference_id
  ) values (
    p_client_id, p_lot_id, 'STORAGE', 'Warehouse Storage Charges (' || p_period_start || ' to ' || p_period_end || ')',
    v_billable_units, round(v_total / v_billable_units, 2), v_total, v_run_id
  );

  insert into public.audit_events (actor_id, action, reference_type, reference_id, event_data)
  values (v_user_id, 'STORAGE_BILLING_POSTED', 'STORAGE_BILLING_RUN', v_run_id,
    jsonb_build_object('run_number', v_run_number, 'tariff_version', p_tariff_version,
      'billing_basis', case when p_category = 'EMPTY_BAGS' then 'FIFTY_EMPTY_BAGS' else 'EQUIVALENT_BAG_FROM_KG' end,
      'total_amount', v_total));

  return v_run_id;
end;
$$;

revoke all on function public.quote_storage_billing(uuid, uuid, text, date, date, boolean, text)
  from public, anon;
revoke all on function public.calculate_and_save_storage_billing_v2(uuid, uuid, text, date, date, boolean, text)
  from public, anon;
grant execute on function public.quote_storage_billing(uuid, uuid, text, date, date, boolean, text)
  to authenticated;
grant execute on function public.calculate_and_save_storage_billing_v2(uuid, uuid, text, date, date, boolean, text)
  to authenticated;
