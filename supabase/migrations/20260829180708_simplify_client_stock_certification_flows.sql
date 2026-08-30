-- Client-centred workflow refinements. Existing posted transactions remain
-- immutable; these additions only enrich future operational decisions.

alter table public.warehouse_receipts
  add column if not exists certification_status text not null default 'NOT_RECORDED'
    check (certification_status in ('NOT_RECORDED', 'NOT_CERTIFIED', 'PENDING_VERIFICATION', 'VERIFIED')),
  add column if not exists certification_schemes text[] not null default '{}',
  add column if not exists certificate_number text,
  add column if not exists certification_issuer text,
  add column if not exists certification_valid_from date,
  add column if not exists certification_valid_to date,
  add constraint warehouse_receipts_certification_dates_check
    check (certification_valid_to is null or certification_valid_from is null or certification_valid_to >= certification_valid_from),
  add constraint warehouse_receipts_certification_details_check check (
    certification_status in ('NOT_RECORDED', 'NOT_CERTIFIED')
    or coalesce(array_length(certification_schemes, 1), 0) > 0
  ),
  add constraint warehouse_receipts_verified_certificate_check check (
    certification_status <> 'VERIFIED' or (
      nullif(btrim(certificate_number), '') is not null
      and nullif(btrim(certification_issuer), '') is not null
      and certification_valid_from is not null
      and certification_valid_to is not null
    )
  );

alter table public.coffee_lots
  add column if not exists certification_status text not null default 'NOT_RECORDED'
    check (certification_status in ('NOT_RECORDED', 'NOT_CERTIFIED', 'PENDING_VERIFICATION', 'VERIFIED')),
  add column if not exists certification_schemes text[] not null default '{}',
  add column if not exists certificate_number text,
  add column if not exists certification_issuer text,
  add column if not exists certification_valid_from date,
  add column if not exists certification_valid_to date,
  add constraint coffee_lots_certification_dates_check
    check (certification_valid_to is null or certification_valid_from is null or certification_valid_to >= certification_valid_from),
  add constraint coffee_lots_certification_details_check check (
    certification_status in ('NOT_RECORDED', 'NOT_CERTIFIED')
    or coalesce(array_length(certification_schemes, 1), 0) > 0
  ),
  add constraint coffee_lots_verified_certificate_check check (
    certification_status <> 'VERIFIED' or (
      nullif(btrim(certificate_number), '') is not null
      and nullif(btrim(certification_issuer), '') is not null
      and certification_valid_from is not null
      and certification_valid_to is not null
    )
  );

create index if not exists coffee_lots_certification_expiry_idx
  on public.coffee_lots (certification_status, certification_valid_to);

create or replace function public.update_grn_certification(
  p_receipt_id uuid,
  p_status text,
  p_schemes text[] default '{}',
  p_certificate_number text default null,
  p_issuer text default null,
  p_valid_from date default null,
  p_valid_to date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt public.warehouse_receipts;
  v_schemes text[] := coalesce(p_schemes, '{}');
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer');

  select * into v_receipt
  from public.warehouse_receipts
  where id = p_receipt_id
  for update;

  if not found then raise exception 'Warehouse receipt not found.'; end if;
  if v_receipt.status <> 'DRAFT' then
    raise exception 'Certification can only be changed while the GRN is a draft.';
  end if;
  if p_status not in ('NOT_RECORDED', 'NOT_CERTIFIED', 'PENDING_VERIFICATION', 'VERIFIED') then
    raise exception 'Choose a valid certification status.';
  end if;
  if p_valid_to is not null and p_valid_from is not null and p_valid_to < p_valid_from then
    raise exception 'Certification expiry cannot be before its start date.';
  end if;
  if p_status = 'VERIFIED' and (
    coalesce(array_length(v_schemes, 1), 0) = 0
    or nullif(btrim(coalesce(p_certificate_number, '')), '') is null
    or nullif(btrim(coalesce(p_issuer, '')), '') is null
    or p_valid_from is null
    or p_valid_to is null
  ) then
    raise exception 'Verified coffee requires a scheme, certificate number, valid-from date, and expiry date.';
  end if;

  update public.warehouse_receipts
  set certification_status = p_status,
      certification_schemes = case when p_status in ('NOT_RECORDED', 'NOT_CERTIFIED') then '{}' else v_schemes end,
      certificate_number = case when p_status in ('NOT_RECORDED', 'NOT_CERTIFIED') then null else nullif(btrim(p_certificate_number), '') end,
      certification_issuer = case when p_status in ('NOT_RECORDED', 'NOT_CERTIFIED') then null else nullif(btrim(p_issuer), '') end,
      certification_valid_from = case when p_status in ('NOT_RECORDED', 'NOT_CERTIFIED') then null else p_valid_from end,
      certification_valid_to = case when p_status in ('NOT_RECORDED', 'NOT_CERTIFIED') then null else p_valid_to end
  where id = p_receipt_id;

  perform private.record_audit('GRN_CERTIFICATION_UPDATED', 'WAREHOUSE_RECEIPT', p_receipt_id,
    jsonb_build_object('status', p_status, 'schemes', v_schemes,
      'certificate_number', nullif(btrim(coalesce(p_certificate_number, '')), '')));

  return jsonb_build_object('id', p_receipt_id, 'status', p_status);
end;
$$;

create or replace function private.apply_lot_certification()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_receipt public.warehouse_receipts;
  v_input_count integer;
  v_verified_count integer;
  v_schemes text[];
begin
  if new.receipt_id is not null then
    select * into v_receipt from public.warehouse_receipts where id = new.receipt_id;
    if found then
      new.certification_status := v_receipt.certification_status;
      new.certification_schemes := v_receipt.certification_schemes;
      new.certificate_number := v_receipt.certificate_number;
      new.certification_issuer := v_receipt.certification_issuer;
      new.certification_valid_from := v_receipt.certification_valid_from;
      new.certification_valid_to := v_receipt.certification_valid_to;
    end if;
  elsif new.source_processing_order_id is not null then
    select count(*), count(*) filter (where lot.certification_status = 'VERIFIED'),
      coalesce(array_agg(distinct scheme) filter (where scheme is not null), '{}')
    into v_input_count, v_verified_count, v_schemes
    from public.processing_order_inputs input
    join public.coffee_lots lot on lot.id = input.lot_id
    left join lateral unnest(lot.certification_schemes) scheme on true
    where input.order_id = new.source_processing_order_id;

    if v_input_count > 0 and v_input_count = v_verified_count then
      new.certification_status := 'PENDING_VERIFICATION';
      new.certification_schemes := v_schemes;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists coffee_lots_apply_certification on public.coffee_lots;
create trigger coffee_lots_apply_certification
  before insert on public.coffee_lots
  for each row execute function private.apply_lot_certification();

update public.coffee_lots lot
set certification_status = receipt.certification_status,
    certification_schemes = receipt.certification_schemes,
    certificate_number = receipt.certificate_number,
    certification_issuer = receipt.certification_issuer,
    certification_valid_from = receipt.certification_valid_from,
    certification_valid_to = receipt.certification_valid_to
from public.warehouse_receipts receipt
where lot.receipt_id = receipt.id;

create or replace function private.lot_is_certified_for_period(
  p_lot_id uuid,
  p_period_start date,
  p_period_end date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select lot.certification_status = 'VERIFIED'
      and coalesce(array_length(lot.certification_schemes, 1), 0) > 0
      and lot.certification_valid_from is not null
      and lot.certification_valid_to is not null
      and lot.certification_valid_from <= p_period_start
      and lot.certification_valid_to >= p_period_end
    from public.coffee_lots lot
    where lot.id = p_lot_id
  ), false);
$$;

create or replace function private.storage_billing_daily_rows(
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
  age_day integer,
  rate_etb numeric,
  billable_units numeric,
  amount_etb numeric,
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

  v_certified := private.lot_is_certified_for_period(p_lot_id, p_period_start, p_period_end);

  select tariff.id
  into v_tariff_id
  from public.tariff_versions tariff
  where tariff.version_code = p_tariff_version
    and tariff.active
    and tariff.verified_by_1 is not null
    and tariff.verified_by_2 is not null
    and tariff.verified_by_1 <> tariff.verified_by_2
    and tariff.effective_from <= p_period_start
    and (tariff.effective_to is null or tariff.effective_to >= p_period_end);

  if v_tariff_id is null then
    raise exception 'No independently verified tariff covers the selected date range.';
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
    raise exception 'The verified tariff has no rate for part of this date range, category, or certification.';
  end if;

  return query
  with days as (
    select day::date as charge_date
    from generate_series(v_received_date, p_period_end, interval '1 day') day
  ),
  daily as (
    select days.charge_date,
      coalesce(sum(movement.bag_delta), 0)::numeric as movement_bags,
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
      sum(daily.movement_bags) over (order by daily.charge_date)::numeric as closing_bags
    from daily
  )
  select balance.charge_date, balance.opening_bags, balance.movement_bags,
    balance.closing_bags, ((balance.charge_date - v_received_date) + 1)::integer,
    rate.daily_rate_per_unit::numeric,
    (case when p_category = 'EMPTY_BAGS' then balance.closing_bags / 50 else balance.closing_bags end)::numeric,
    round((case when p_category = 'EMPTY_BAGS' then balance.closing_bags / 50 else balance.closing_bags end) * rate.daily_rate_per_unit, 2)::numeric,
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

create or replace function private.set_storage_run_certification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.certified := private.lot_is_certified_for_period(new.lot_id, new.period_start, new.period_end);
  return new;
end;
$$;

drop trigger if exists storage_runs_authoritative_certification on public.storage_billing_runs;
create trigger storage_runs_authoritative_certification
  before insert on public.storage_billing_runs
  for each row execute function private.set_storage_run_certification();

alter table public.ecs_transfers
  add column if not exists transfer_reference text,
  add column if not exists driver_name text,
  add column if not exists seal_number text,
  add column if not exists expected_arrival_on date,
  add column if not exists departure_document_reference text,
  add column if not exists destination_document_reference text;

create or replace function public.post_ecx_transfer_v2(
  p_lot_id uuid,
  p_destination_warehouse_id uuid,
  p_sent_kg numeric,
  p_vehicle_plate text,
  p_transfer_reference text,
  p_driver_name text default null,
  p_seal_number text default null,
  p_expected_arrival_on date default null,
  p_departure_document_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer_id uuid;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer');
  if nullif(btrim(coalesce(p_transfer_reference, '')), '') is null then
    raise exception 'An ECX transfer reference is required.';
  end if;
  if p_expected_arrival_on is not null and p_expected_arrival_on < current_date then
    raise exception 'Expected arrival cannot be before today.';
  end if;
  if nullif(btrim(coalesce(p_departure_document_reference, '')), '') is null then
    raise exception 'A waybill, gate pass, or ECX departure document reference is required.';
  end if;

  v_transfer_id := public.post_ecs_transfer(
    p_lot_id, p_destination_warehouse_id, p_sent_kg, nullif(btrim(p_vehicle_plate), '')
  );

  update public.ecs_transfers
  set transfer_reference = btrim(p_transfer_reference),
      driver_name = nullif(btrim(p_driver_name), ''),
      seal_number = nullif(btrim(p_seal_number), ''),
      expected_arrival_on = p_expected_arrival_on,
      departure_document_reference = nullif(btrim(p_departure_document_reference), '')
  where id = v_transfer_id;

  return v_transfer_id;
end;
$$;

create or replace function public.receive_ecx_transfer_v2(
  p_transfer_id uuid,
  p_received_kg numeric,
  p_destination_section text,
  p_variance_approved_by uuid default null,
  p_destination_document_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer_id uuid;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer');
  if nullif(btrim(coalesce(p_destination_document_reference, '')), '') is null then
    raise exception 'A destination receipt or weighbridge reference is required.';
  end if;

  v_transfer_id := public.receive_ecs_transfer(
    p_transfer_id, p_received_kg, p_destination_section, p_variance_approved_by
  );
  update public.ecs_transfers
  set destination_document_reference = btrim(p_destination_document_reference)
  where id = p_transfer_id;
  return v_transfer_id;
end;
$$;

revoke all on function public.update_grn_certification(uuid, text, text[], text, text, date, date) from public, anon, authenticated;
revoke all on function public.post_ecx_transfer_v2(uuid, uuid, numeric, text, text, text, text, date, text) from public, anon, authenticated;
revoke all on function public.receive_ecx_transfer_v2(uuid, numeric, text, uuid, text) from public, anon, authenticated;
revoke all on function private.lot_is_certified_for_period(uuid, date, date) from public, anon, authenticated;

grant execute on function public.update_grn_certification(uuid, text, text[], text, text, date, date) to authenticated;
grant execute on function public.post_ecx_transfer_v2(uuid, uuid, numeric, text, text, text, text, date, text) to authenticated;
grant execute on function public.receive_ecx_transfer_v2(uuid, numeric, text, uuid, text) to authenticated;
