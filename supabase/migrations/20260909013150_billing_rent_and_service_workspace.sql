-- Billing workspace: additive snapshots, daily movement accounting and stage rent.
-- Existing billing runs/invoices remain unchanged; no historical financial repricing.
alter table public.storage_rent_records
  add column agreement_id uuid references public.agreements(id),
  add column tariff_version text,
  add column bag_weight_kg numeric(8,3) check (bag_weight_kg > 0),
  add column category_start_on date,
  add column inherited_from_id uuid references public.storage_rent_records(id);
alter table public.service_events add column tariff_version text;
alter table public.tariff_versions
  add column invoice_tax_rate numeric(7,4) check (invoice_tax_rate between 0 and 1),
  add column service_rate_draft jsonb not null default '[]'::jsonb;

create or replace function private.bind_storage_agreement()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_agreement public.agreements; v_start date;
begin
  select a.* into v_agreement from public.coffee_lots l
    join public.warehouse_receipts r on r.id=l.receipt_id
    join public.agreements a on a.id=r.agreement_id
    where l.id=new.lot_id and l.client_id=new.client_id;
  if not found then raise exception 'Rent needs the original receiving agreement.'; end if;
  select case when l.parent_lot_id is not null
    then (l.created_at at time zone 'Africa/Addis_Ababa')::date
    else (r.arrival_at at time zone 'Africa/Addis_Ababa')::date end
    into v_start from public.coffee_lots l join public.warehouse_receipts r on r.id=l.receipt_id where l.id=new.lot_id;
  new.agreement_id := v_agreement.id;
  new.tariff_version := v_agreement.tariff_version;
  new.bag_weight_kg := v_agreement.default_bag_weight_kg;
  new.category_start_on := v_start;
  new.charge_start_on := greatest(new.charge_start_on, v_start);
  return new;
end; $$;
revoke all on function private.bind_storage_agreement() from public,anon,authenticated;
create trigger storage_rent_bind_agreement before insert on public.storage_rent_records
for each row execute function private.bind_storage_agreement();

-- Attach metadata only, without changing historical billed dates or amounts.
update public.storage_rent_records rent set
  agreement_id=a.id, tariff_version=a.tariff_version, bag_weight_kg=a.default_bag_weight_kg,
  category_start_on=case when l.parent_lot_id is not null then (l.created_at at time zone 'Africa/Addis_Ababa')::date
    else (r.arrival_at at time zone 'Africa/Addis_Ababa')::date end
from public.coffee_lots l join public.warehouse_receipts r on r.id=l.receipt_id
join public.agreements a on a.id=r.agreement_id where rent.lot_id=l.id;

create or replace function private.inherit_processed_storage(p_parent_lot_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_parent public.storage_rent_records; v_lot public.coffee_lots; v_category text;
begin
  select * into v_parent from public.storage_rent_records where lot_id=p_parent_lot_id and status='ACTIVE';
  if not found then return; end if;
  for v_lot in select * from public.coffee_lots where parent_lot_id=p_parent_lot_id
    and client_id=v_parent.client_id and ownership_type='CLIENT' and source_processing_order_id is not null
  loop
    v_category := case when v_lot.lot_category='ACCEPTED_PROCESSED' then 'PROCESSED_EXPORT'
      when v_lot.lot_category='CLIENT_REJECT' then 'REJECT' else null end;
    -- Movement insertion occurs before processing_outputs is inserted.
    if v_category is null then continue; end if;
    insert into public.storage_rent_records (
      rent_number,client_id,lot_id,storage_category,charge_start_on,
      recorded_by,note,inherited_from_id,evidence_reference
    ) values (
      'RENT-'||v_lot.id::text,v_lot.client_id,v_lot.id,v_category,
      greatest(v_parent.charge_start_on,(v_lot.created_at at time zone 'Africa/Addis_Ababa')::date),
      v_parent.recorded_by,'Rent follows processing output; free days start with this storage stage.',
      v_parent.id,'PROCESSING_ORDER:'||v_lot.source_processing_order_id::text
    ) on conflict (lot_id) where status='ACTIVE' do nothing;
  end loop;
end; $$;
revoke all on function private.inherit_processed_storage(uuid) from public,anon,authenticated;

create or replace function private.follow_storage_output()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_parent uuid;
begin
  if tg_table_name='storage_rent_records' then
    perform private.inherit_processed_storage(new.lot_id);
  elsif new.movement_type='PROCESS_OUTPUT' then
    select parent_lot_id into v_parent from public.coffee_lots where id=new.lot_id;
    if v_parent is not null then perform private.inherit_processed_storage(v_parent); end if;
  end if;
  return new;
end; $$;
revoke all on function private.follow_storage_output() from public,anon,authenticated;
create trigger storage_rent_follow_children after insert on public.storage_rent_records
for each row execute function private.follow_storage_output();
create trigger stock_output_follow_rent after insert on public.stock_movements
for each row execute function private.follow_storage_output();
do $$ declare r record; begin
  for r in select lot_id from public.storage_rent_records where status='ACTIVE'
  loop perform private.inherit_processed_storage(r.lot_id); end loop;
end $$;

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
  v_agreement public.agreements;
  v_rent public.storage_rent_records;
  v_row record;
  v_tariff_id uuid;
  v_certified boolean;
  v_bag_weight_kg numeric;
  v_billing_basis text;
begin
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'Choose a valid storage billing date range.';
  end if;

  select agreement.* into v_agreement
  from public.coffee_lots lot
  join public.warehouse_receipts receipt on receipt.id = lot.receipt_id
  join public.agreements agreement on agreement.id = receipt.agreement_id
  where lot.id = p_lot_id and lot.client_id = p_client_id;
  if not found then raise exception 'The lot needs its original receiving agreement.'; end if;
  select * into v_rent from public.storage_rent_records
  where lot_id = p_lot_id and status = 'ACTIVE';
  if p_tariff_version is distinct from coalesce(v_rent.tariff_version, v_agreement.tariff_version) then
    raise exception 'Use the tariff attached to this lot agreement: %.', coalesce(v_rent.tariff_version, v_agreement.tariff_version);
  end if;
  if v_rent.id is not null and p_category <> v_rent.storage_category then
    raise exception 'Use the recorded rent category for this lot.';
  end if;
  select coalesce(v_rent.category_start_on,
    case when lot.parent_lot_id is not null then (lot.created_at at time zone 'Africa/Addis_Ababa')::date
      else (receipt.arrival_at at time zone 'Africa/Addis_Ababa')::date end)
  into v_received_date
  from public.coffee_lots lot join public.warehouse_receipts receipt on receipt.id = lot.receipt_id
  where lot.id = p_lot_id;
  if p_period_start < v_received_date then
    raise exception 'Storage billing cannot start before this storage stage began.';
  end if;
  v_bag_weight_kg := coalesce(v_rent.bag_weight_kg, v_agreement.default_bag_weight_kg);
  if v_bag_weight_kg is null or v_bag_weight_kg <= 0 then
    raise exception 'A positive agreement bag weight is required for storage rent.';
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
;

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
        and (rate.certified = v_certified or (v_certified and not rate.certified))
        and ((day::date - v_received_date) + 1) >= rate.age_start_days
        and (rate.age_end_days is null or ((day::date - v_received_date) + 1) <= rate.age_end_days)
    )
  ) then
    raise exception 'The active tariff has no rate for part of this date range, category, or certification.';
  end if;

  for v_row in
  with days as (
    select day::date as charge_date from generate_series(p_period_start, p_period_end, interval '1 day') day
  ), ledger as (
    select movement.*,
      case when movement.movement_type = 'RECEIPT'
        then (receipt.arrival_at at time zone 'Africa/Addis_Ababa')::date
        else (movement.occurred_at at time zone 'Africa/Addis_Ababa')::date end as business_date
    from public.stock_movements movement
    join public.coffee_lots lot on lot.id = movement.lot_id
    left join public.warehouse_receipts receipt on receipt.id = lot.receipt_id
    where movement.lot_id = p_lot_id
  ), balances as (
    select days.charge_date,
      coalesce(sum(m.bag_delta) filter (where m.business_date < days.charge_date),0)::numeric as opening_bags,
      coalesce(sum(m.bag_delta) filter (where m.business_date = days.charge_date),0)::numeric as movement_bags,
      coalesce(sum(m.bag_delta),0)::numeric as closing_bags,
      coalesce(sum(m.quantity_kg) filter (where m.business_date < days.charge_date),0)::numeric as opening_kg,
      coalesce(sum(m.quantity_kg) filter (where m.business_date = days.charge_date),0)::numeric as movement_kg,
      coalesce(sum(m.quantity_kg),0)::numeric as closing_kg,
      coalesce(array_agg(distinct m.reference_type || ':' || left(m.reference_id::text,8))
        filter (where m.business_date = days.charge_date), '{}')::text[] as refs
    from days left join ledger m on m.business_date <= days.charge_date
    group by days.charge_date
  )
  select b.*, (b.charge_date - v_received_date + 1)::integer as age,
    rate.daily_rate_per_unit as rate,
    case when p_category = 'EMPTY_BAGS' then b.closing_bags / 50 else b.closing_kg / v_bag_weight_kg end as units
  from balances b join lateral (
    select line.daily_rate_per_unit from public.tariff_line_items line
    where line.tariff_version_id = v_tariff_id and line.category = p_category
      and (line.certified = v_certified or (v_certified and not line.certified))
      and b.charge_date - v_received_date + 1 >= line.age_start_days
      and (line.age_end_days is null or b.charge_date - v_received_date + 1 <= line.age_end_days)
    order by line.certified desc, line.age_start_days desc limit 1
  ) rate on true order by b.charge_date
  loop
    if v_row.closing_kg < 0 or v_row.closing_bags < 0 then
      raise exception 'Stock does not reconcile on %. Review receiving and movement dates before billing.', v_row.charge_date;
    end if;
    charge_date := v_row.charge_date;
    opening_bags := v_row.opening_bags; movement_bags := v_row.movement_bags; closing_bags := v_row.closing_bags;
    opening_kg := v_row.opening_kg; movement_kg := v_row.movement_kg; closing_kg := v_row.closing_kg;
    age_day := v_row.age; rate_etb := v_row.rate; billable_units := v_row.units;
    amount_etb := round(v_row.units * v_row.rate,2);
    billing_basis := v_billing_basis; bag_weight_kg := v_bag_weight_kg; movement_references := v_row.refs;
    return next;
  end loop;
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

  perform 1 from public.coffee_lots where id = p_lot_id for update;
  if p_period_end >= (now() at time zone 'Africa/Addis_Ababa')::date then
    raise exception 'Post rent through yesterday. Today remains an estimate until all movements are complete.';
  end if;
  if exists(select 1 from public.storage_billing_runs where lot_id=p_lot_id
    and period_start <= p_period_end and period_end >= p_period_start) then
    raise exception 'Some selected storage days have already been billed for this lot.';
  end if;
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

  -- Zero-charge periods are recorded as evidence and advance billed-through.

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

  if v_total > 0 then
    insert into public.service_events (
      client_id, lot_id, service_type, description, quantity, unit_price, total_amount,
      reference_id, reference_type, service_date, unit_label, tariff_version
    ) values (
      p_client_id, p_lot_id, 'STORAGE', 'Warehouse Storage Charges (' || p_period_start || ' to ' || p_period_end || ')',
      v_billable_units, round(v_total / nullif(v_billable_units,0), 2), v_total,
      v_run_id, 'STORAGE_BILLING_RUN', p_period_end, 'equivalent bag-days', p_tariff_version
    );
  end if;

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

alter table public.service_rate_catalog drop constraint service_rate_catalog_service_code_check;
alter table public.service_rate_catalog add constraint service_rate_catalog_service_code_check check(service_code in ('PROCESSING', 'HULLING', 'CLEANING', 'TRANSPORT', 'OTHER', 'LABOUR', 'LOADING', 'UNLOADING', 'WEIGHING', 'BAG_PRINTING', 'PACKING', 'VACUUM_PACKING', 'CONTAINER_HANDLING', 'GENERATOR', 'CERTIFICATION'));
alter table public.manual_service_records drop constraint manual_service_records_service_code_check;
alter table public.manual_service_records add constraint manual_service_records_service_code_check check(service_code in ('PROCESSING', 'HULLING', 'CLEANING', 'TRANSPORT', 'OTHER', 'LABOUR', 'LOADING', 'UNLOADING', 'WEIGHING', 'BAG_PRINTING', 'PACKING', 'VACUUM_PACKING', 'CONTAINER_HANDLING', 'GENERATOR', 'CERTIFICATION'));
alter table public.service_events drop constraint service_events_service_type_check;
alter table public.service_events add constraint service_events_service_type_check check(service_type in ('STORAGE', 'PROCESSING', 'HULLING', 'CLEANING', 'TRANSPORT', 'OTHER', 'LABOUR', 'LOADING', 'UNLOADING', 'WEIGHING', 'BAG_PRINTING', 'PACKING', 'VACUUM_PACKING', 'CONTAINER_HANDLING', 'GENERATOR', 'CERTIFICATION'));

create or replace function public.post_manual_service_record(
  p_client_id uuid,
  p_service_code text,
  p_service_date date,
  p_description text,
  p_quantity numeric,
  p_unit_label text,
  p_unit_price numeric,
  p_approved_by uuid,
  p_processing_order_id uuid default null,
  p_evidence_reference text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.processing_orders;
  v_event public.service_events;
  v_record public.manual_service_records;
  v_rate public.service_rate_catalog;
  v_tariff public.tariff_versions;
  v_total numeric(16,2);
  v_agreement public.agreements;
begin
  perform private.require_role(
    'system_admin', 'warehouse_manager', 'processing_supervisor', 'finance_officer'
  );
  if p_service_code not in ('PROCESSING', 'HULLING', 'CLEANING', 'TRANSPORT', 'OTHER', 'LABOUR', 'LOADING', 'UNLOADING', 'WEIGHING', 'BAG_PRINTING', 'PACKING', 'VACUUM_PACKING', 'CONTAINER_HANDLING', 'GENERATOR', 'CERTIFICATION') then
    raise exception 'Choose a supported manual service.';
  end if;
  if p_service_date > current_date then raise exception 'Service date cannot be in the future.'; end if;
  if char_length(btrim(coalesce(p_description, ''))) < 3 then raise exception 'Service description is required.'; end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity::text='NaN' then raise exception 'Quantity must be positive.'; end if;
  if nullif(btrim(p_unit_label), '') is null then raise exception 'Service unit is required.'; end if;
  if p_approved_by = (select auth.uid()) then raise exception 'The recorder cannot approve the same service.'; end if;

  if not exists (
    select 1 from public.clients client
    join public.profiles recorder on recorder.id = (select auth.uid())
    where client.id = p_client_id and client.active
      and client.organization_id = recorder.organization_id
  ) then
    raise exception 'Choose an active client in your organization.';
  end if;

  perform 1
  from public.profiles profile
  join public.profiles recorder on recorder.id = (select auth.uid())
  where profile.id = p_approved_by and profile.active
    and profile.organization_id = recorder.organization_id
    and profile.role in ('system_admin', 'warehouse_manager', 'finance_officer');
  if not found then raise exception 'Choose an active independent approver.'; end if;

  if p_processing_order_id is not null then
    select a.* into v_agreement from public.processing_orders p
      join public.coffee_lots l on l.id=p.lot_id
      join public.warehouse_receipts r on r.id=l.receipt_id
      join public.agreements a on a.id=r.agreement_id
      where p.id=p_processing_order_id and p.client_id=p_client_id;
  else
    select * into v_agreement from public.agreements
      where client_id=p_client_id and status in ('ACTIVE','EXPIRED')
      and effective_from<=p_service_date and (effective_to is null or effective_to>=p_service_date)
      order by effective_from desc,created_at desc limit 1;
  end if;
  if v_agreement.id is null then raise exception 'Choose a service date covered by the client agreement.'; end if;
  select rate.* into v_rate
  from public.service_rate_catalog rate
  join public.tariff_versions tariff on tariff.id = rate.tariff_version_id
  where tariff.version_code = v_agreement.tariff_version
    and rate.service_code = p_service_code
    and lower(rate.unit_label) = lower(btrim(p_unit_label))
    and rate.active and tariff.active
    and p_service_date >= rate.effective_from
    and (rate.effective_to is null or p_service_date <= rate.effective_to)
    and p_service_date >= tariff.effective_from

    and tariff.verified_by_1 is not null
    and tariff.verified_by_2 is not null
    and tariff.verified_by_1 <> tariff.verified_by_2
  order by rate.effective_from desc
  limit 1;
  if not found then
    raise exception 'No independently verified catalog rate exists for this service, unit, and date.';
  end if;
  select * into v_tariff
  from public.tariff_versions
  where id = v_rate.tariff_version_id;
  if abs(coalesce(p_unit_price, -1) - v_rate.unit_price) > 0.001 then
    raise exception 'The entered rate does not match the approved catalog rate of ETB %.', v_rate.unit_price;
  end if;

  if p_processing_order_id is not null then
    select processing.* into v_order from public.processing_orders processing
    where processing.id = p_processing_order_id and processing.client_id = p_client_id;
    if not found then raise exception 'Processing order does not belong to the selected client.'; end if;
    if v_order.status <> 'POSTED' then raise exception 'Only a completed processing order can be charged.'; end if;
  elsif p_service_code in ('PROCESSING', 'HULLING', 'CLEANING') then
    raise exception 'Processing, hulling, and cleaning services require a completed processing order.';
  end if;

  v_total := round(p_quantity * v_rate.unit_price, 2);
  insert into public.service_events (
    client_id, lot_id, service_type, description, quantity, unit_price,
    total_amount, reference_id, status, service_date, unit_label, reference_type, tariff_version
  ) values (
    p_client_id, case when p_processing_order_id is null then null else v_order.lot_id end,
    p_service_code, btrim(p_description), p_quantity, v_rate.unit_price, v_total,
    p_processing_order_id, 'UNBILLED', p_service_date, v_rate.unit_label,
    case when p_processing_order_id is null then 'MANUAL_SERVICE' else 'PROCESSING_ORDER' end, v_tariff.version_code
  ) returning * into v_event;

  insert into public.manual_service_records (
    service_number, client_id, processing_order_id, service_code, service_date,
    description, quantity, unit_label, unit_price, total_amount, approved_by,
    evidence_reference, note, service_event_id, service_rate_id, recorded_by
  ) values (
    'SVC-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'), p_client_id,
    p_processing_order_id, p_service_code, p_service_date, btrim(p_description),
    p_quantity, v_rate.unit_label, v_rate.unit_price, v_total, p_approved_by,
    nullif(btrim(p_evidence_reference), ''), nullif(btrim(p_note), ''),
    v_event.id, v_rate.id, (select auth.uid())
  ) returning * into v_record;

  perform private.record_audit(
    'MANUAL_SERVICE_RECORDED', 'MANUAL_SERVICE', v_record.id,
    jsonb_build_object(
      'service_number', v_record.service_number,
      'service_event_id', v_event.id,
      'service_code', p_service_code,
      'processing_order_id', p_processing_order_id,
      'service_rate_id', v_rate.id,
      'tariff_version', v_tariff.version_code,
      'unit_price', v_rate.unit_price,
      'total_amount', v_total,
      'approved_by', p_approved_by,
      'automatic', false
    )
  );
  return jsonb_build_object(
    'id', v_record.id,
    'service_number', v_record.service_number,
    'service_event_id', v_event.id,
    'service_rate_id', v_rate.id,
    'total_amount', v_total
  );
end;
$$;


create or replace function private.enforce_service_pricing_before_invoice()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'PREPARED' and old.status is distinct from 'PREPARED' then
    if old.service_type = 'STORAGE' then
      if not exists (
        select 1
        from public.storage_billing_runs run
        where run.id = old.reference_id
          and run.total_amount = old.total_amount
          and exists (
            select 1 from public.storage_billing_run_days day where day.run_id = run.id
          )
          and abs((
            select coalesce(sum(day.amount_etb), 0)
            from public.storage_billing_run_days day where day.run_id = run.id
          ) - run.total_amount) <= 0.01
      ) then
        raise exception 'Storage service lacks matching daily billing evidence.';
      end if;
    elsif old.service_type in ('PROCESSING', 'HULLING', 'CLEANING', 'TRANSPORT', 'OTHER', 'LABOUR', 'LOADING', 'UNLOADING', 'WEIGHING', 'BAG_PRINTING', 'PACKING', 'VACUUM_PACKING', 'CONTAINER_HANDLING', 'GENERATOR', 'CERTIFICATION') then
      if not exists (
        select 1
        from public.manual_service_records record
        join public.service_rate_catalog rate on rate.id = record.service_rate_id
        join public.tariff_versions tariff on tariff.id = rate.tariff_version_id
        where record.service_event_id = old.id
          and record.unit_price = rate.unit_price
          and tariff.active
          and tariff.verified_by_1 is not null
          and tariff.verified_by_2 is not null
          and tariff.verified_by_1 <> tariff.verified_by_2
      ) then
        raise exception 'Manual service lacks an independently verified catalog rate.';
      end if;
    else
      raise exception 'The % service rate is not yet approved for invoice preparation.', old.service_type;
    end if;
  end if;
  return new;
end;
$$;


create or replace function public.create_invoice_draft_from_services(
  p_service_event_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice_id uuid;
  v_invoice_number text;
  v_client_id uuid;
  v_client_count integer;
  v_tariff_version text;
  v_subtotal numeric(16,2);
  v_lines jsonb;
  v_count integer;
begin
  perform private.require_role('system_admin', 'finance_officer');
  if coalesce(cardinality(p_service_event_ids), 0) = 0 then
    raise exception 'Select at least one unbilled service.';
  end if;

  perform 1 from public.service_events
  where id = any(p_service_event_ids)
  for update;

  select count(*), count(distinct service.client_id), min(service.client_id::text)::uuid,
    round(sum(service.total_amount), 2),
    jsonb_agg(jsonb_build_object(
      'service_event_id', service.id,
      'service_type', service.service_type,
      'description', service.description,
      'quantity', service.quantity,
      'rate_etb', service.unit_price,
      'amount_etb', service.total_amount,
      'reference_id', service.reference_id,
      'reference_type', service.reference_type,
      'tariff_version', service.tariff_version
    ) order by service.service_date, service.created_at)
  into v_count, v_client_count, v_client_id, v_subtotal, v_lines
  from public.service_events service
  where service.id = any(p_service_event_ids)
    and service.status = 'UNBILLED'
    and service.invoice_id is null;

  if v_count <> cardinality(p_service_event_ids) then
    raise exception 'Every selected service must still be unbilled and outside another invoice draft.';
  end if;
  if v_client_count <> 1 then
    raise exception 'Prepare one client invoice at a time.';
  end if;

  select min(coalesce(s.tariff_version,r.tariff_version)), count(distinct coalesce(s.tariff_version,r.tariff_version))
    into v_tariff_version,v_client_count
    from public.service_events s left join public.storage_billing_runs r on r.id=s.reference_id
    where s.id=any(p_service_event_ids);
  if v_tariff_version is null or v_client_count<>1 then
    raise exception 'Select charges from one agreement price version per invoice.';
  end if;
  v_invoice_number := 'DRF-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
  insert into public.invoices (
    invoice_number, client_id, tariff_version, line_snapshot,
    subtotal_etb, tax_etb, status, created_by
  ) values (
    v_invoice_number, v_client_id, v_tariff_version, v_lines,
    v_subtotal, 0, 'DRAFT', (select auth.uid())
  ) returning id into v_invoice_id;

  update public.service_events
  set invoice_id = v_invoice_id, status = 'PREPARED'
  where id = any(p_service_event_ids);

  perform private.record_audit(
    'INVOICE_DRAFT_PREPARED', 'INVOICE', v_invoice_id,
    jsonb_build_object(
      'invoice_number', v_invoice_number,
      'client_id', v_client_id,
      'service_event_ids', p_service_event_ids,
      'subtotal_etb', v_subtotal,
      'tax_etb', 0
    )
  );
  return jsonb_build_object(
    'id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'client_id', v_client_id,
    'subtotal_etb', v_subtotal,
    'status', 'DRAFT'
  );
end;
$$;


-- Changing prices creates a new version; existing signed agreements keep theirs.
create or replace function public.create_billing_price_version(
 p_source_id uuid,p_code text,p_effective_from date,p_storage_prices jsonb,p_services jsonb,p_tax_rate numeric default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_line record; v_source public.tariff_versions;
begin
 perform private.require_role('system_admin','finance_officer');
 if nullif(btrim(p_code),'') is null or p_effective_from is null or p_effective_from < current_date then
   raise exception 'Enter a version name and an effective date of today or later.';
 end if;
 if jsonb_typeof(p_storage_prices)<>'object' or jsonb_typeof(p_services)<>'array' then raise exception 'Invalid price list.'; end if;
 select * into v_source from public.tariff_versions where id=p_source_id and active;
 if not found then raise exception 'Choose an active price version to copy.'; end if;
 insert into public.tariff_versions(version_code,effective_from,active,description,invoice_tax_rate,service_rate_draft)
 values(btrim(p_code),p_effective_from,false,'New agreements from '||p_effective_from,p_tax_rate,p_services)
 returning id into v_id;
 insert into public.tariff_line_items(tariff_version_id,category,age_start_days,age_end_days,daily_rate_per_unit,certified,source_clause,source_pdf_page)
 select v_id,category,age_start_days,age_end_days,
   coalesce((p_storage_prices->>id::text)::numeric,daily_rate_per_unit),certified,source_clause,source_pdf_page
 from public.tariff_line_items where tariff_version_id=p_source_id;
 for v_line in select * from jsonb_to_recordset(p_services) as x(service_code text,description text,unit_label text,unit_price numeric)
 loop
   if v_line.service_code not in ('PROCESSING', 'HULLING', 'CLEANING', 'TRANSPORT', 'OTHER', 'LABOUR', 'LOADING', 'UNLOADING', 'WEIGHING', 'BAG_PRINTING', 'PACKING', 'VACUUM_PACKING', 'CONTAINER_HANDLING', 'GENERATOR', 'CERTIFICATION') or nullif(btrim(v_line.description),'') is null
     or nullif(btrim(v_line.unit_label),'') is null or v_line.unit_price is null or v_line.unit_price < 0
     or v_line.unit_price::text='NaN' then raise exception 'Each service needs its code, description, unit and nonnegative price.'; end if;
 end loop;
 if exists(select 1 from jsonb_to_recordset(p_services) as x(service_code text,unit_label text)
    group by service_code,lower(unit_label) having count(*)>1) then raise exception 'A service/unit can appear only once in a price version.'; end if;
 perform private.record_audit('PRICE_VERSION_DRAFT','TARIFF',v_id,jsonb_build_object('source',p_source_id,'code',p_code));
 return v_id;
end; $$;
revoke all on function public.create_billing_price_version(uuid,text,date,jsonb,jsonb,numeric) from public,anon;
grant execute on function public.create_billing_price_version(uuid,text,date,jsonb,jsonb,numeric) to authenticated;

create or replace function public.verify_tariff_version(p_tariff_version_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v public.tariff_versions; u uuid := (select auth.uid());
begin
 perform private.require_role('system_admin','finance_officer','warehouse_manager');
 select * into v from public.tariff_versions where id=p_tariff_version_id for update;
 if not found then raise exception 'Price version not found.'; end if;
 if v.verified_by_2 is not null then return 'ALREADY_VERIFIED'; end if;
 if v.verified_by_1 is null then
   update public.tariff_versions set verified_by_1=u where id=v.id;
   perform private.record_audit('VERIFY_TARIFF','TARIFF',v.id,jsonb_build_object('stage','FIRST_REVIEW'));
   return 'PARTIALLY_VERIFIED';
 end if;
 if v.verified_by_1=u then raise exception 'A second employee must verify this price version.'; end if;
 update public.tariff_versions set verified_by_2=u,active=true where id=v.id;
 insert into public.service_rate_catalog(tariff_version_id,service_code,description,unit_label,unit_price,effective_from,verified_by_1,verified_by_2)
 select v.id,x.service_code,x.description,x.unit_label,x.unit_price,v.effective_from,v.verified_by_1,u
 from jsonb_to_recordset(v.service_rate_draft) as x(service_code text,description text,unit_label text,unit_price numeric);
 perform private.record_audit('VERIFY_TARIFF','TARIFF',v.id,jsonb_build_object('stage','ACTIVE','new_agreements_only',true));
 return 'FULLY_VERIFIED';
end; $$;

-- New agreements default to the latest active version applicable to their start date.
create or replace function private.default_agreement_prices()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 select version_code into new.tariff_version from public.tariff_versions
 where active and effective_from<=new.effective_from and (effective_to is null or effective_to>=new.effective_from)
 order by effective_from desc,created_at desc limit 1;
 if new.tariff_version is null then raise exception 'No active price version covers the agreement start date.'; end if;
 return new;
end; $$;
revoke all on function private.default_agreement_prices() from public,anon,authenticated;
create trigger agreement_default_prices before insert on public.agreements
for each row execute function private.default_agreement_prices();

create or replace function public.issue_prepared_invoice(p_invoice_id uuid,p_due_on date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.invoices; t public.tariff_versions; total numeric;
begin
 perform private.require_role('system_admin','finance_officer');
 select i.* into v from public.invoices i join public.clients c on c.id=i.client_id
 join public.profiles p on p.id=(select auth.uid()) and p.organization_id=c.organization_id
 where i.id=p_invoice_id for update of i;
 if not found then raise exception 'Invoice not found.'; end if;
 if v.status<>'DRAFT' then return jsonb_build_object('id',v.id,'status',v.status); end if;
 select * into t from public.tariff_versions where version_code=v.tariff_version;
 if t.invoice_tax_rate is null or t.verified_by_2 is null then
   raise exception 'Finance must configure and verify the tax rate for this price version before issuing invoices.';
 end if;
 if p_due_on is null or p_due_on<current_date then raise exception 'Due date must be today or later.'; end if;
 select sum((line->>'amount_etb')::numeric) into total from jsonb_array_elements(v.line_snapshot) line;
 if total is null or total<>v.subtotal_etb then raise exception 'Invoice lines do not reconcile.'; end if;
 update public.invoices set status='ISSUED',issued_on=current_date,due_on=p_due_on,
   tax_etb=round(subtotal_etb*t.invoice_tax_rate,2) where id=v.id;
 update public.service_events set status='INVOICED' where invoice_id=v.id;
 update public.storage_billing_runs set status='INVOICED' where id in (
   select reference_id from public.service_events where invoice_id=v.id and service_type='STORAGE');
 perform private.record_audit('INVOICE_ISSUED','INVOICE',v.id,jsonb_build_object('tax_rate',t.invoice_tax_rate,'due_on',p_due_on));
 return jsonb_build_object('id',v.id,'status','ISSUED');
end; $$;
revoke all on function public.issue_prepared_invoice(uuid,date) from public,anon;
grant execute on function public.issue_prepared_invoice(uuid,date) to authenticated;

create or replace function public.billing_rent_overview()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_today date := (now() at time zone 'Africa/Addis_Ababa')::date; r record;
  q jsonb; daily jsonb; amount numeric; err text; first_paid integer; result jsonb := '[]'::jsonb; next_day date;
begin
 perform private.require_role('system_admin','warehouse_manager','finance_officer','auditor','viewer');
 for r in
   select l.id as lot_id,l.lot_number,l.client_id,l.quantity_kg,l.bag_count,l.parent_lot_id,l.lot_category,
     rent.id as rent_id,rent.storage_category,rent.charge_start_on,rent.category_start_on,rent.billed_through_on,
     rent.tariff_version,rent.bag_weight_kg,t.id as tariff_id,rent.inherited_from_id
   from public.coffee_lots l join public.clients c on c.id=l.client_id
   join public.profiles p on p.id=(select auth.uid()) and p.organization_id=c.organization_id
   left join public.storage_rent_records rent on rent.lot_id=l.id and rent.status='ACTIVE'
   left join public.tariff_versions t on t.version_code=rent.tariff_version
   where l.ownership_type='CLIENT' and (l.quantity_kg>0 or rent.id is not null)
   order by l.lot_number
 loop
   amount:=0; daily:=null; err:=null; first_paid:=null;
   next_day:=coalesce(r.billed_through_on+1,r.charge_start_on);
   if r.rent_id is not null then
     begin
       if next_day<=v_today-1 then
         q:=public.quote_storage_billing(r.client_id,r.lot_id,r.storage_category,next_day,v_today-1,false,r.tariff_version);
         amount:=(q->>'amount')::numeric;
       end if;
       q:=public.quote_storage_billing(r.client_id,r.lot_id,r.storage_category,v_today,v_today,false,r.tariff_version);
       daily:=q->'rows'->0;
       select min(age_start_days) into first_paid from public.tariff_line_items
       where tariff_version_id=r.tariff_id and category=r.storage_category and daily_rate_per_unit>0;
     exception when others then err:=sqlerrm; amount:=null;
     end;
   else
     err:='Choose the storage category to start rent tracking.';
   end if;
   result:=result||jsonb_build_array(jsonb_build_object(
     'lotId',r.lot_id,'lotNumber',r.lot_number,'clientId',r.client_id,'quantityKg',r.quantity_kg,
     'bags',r.bag_count,'parentLotId',r.parent_lot_id,'rentId',r.rent_id,'category',r.storage_category,
     'categoryStart',r.category_start_on,'tariffVersion',r.tariff_version,'bagWeightKg',r.bag_weight_kg,
     'billedThrough',r.billed_through_on,'nextUnbilled',next_day,'accrued',amount,'today',daily,
     'freeUntil',case when first_paid>1 then r.category_start_on+first_paid-2 else null end,
     'inherited',r.inherited_from_id is not null,'error',err));
 end loop;
 return result;
end; $$;
revoke all on function public.billing_rent_overview() from public,anon;
grant execute on function public.billing_rent_overview() to authenticated;
notify pgrst,'reload schema';
-- Free-day units are evidence, but are not chargeable bag-days.
create or replace function private.enforce_storage_invoice_evidence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_day_count integer;
  v_billable_units numeric;
  v_total numeric;
begin
  if new.status = 'INVOICED' then
    select count(*), coalesce(sum(day.billable_units) filter (where day.rate_etb > 0 and day.billable_units > 0), 0), coalesce(sum(day.amount_etb), 0)
    into v_day_count, v_billable_units, v_total
    from public.storage_billing_run_days day
    where day.run_id = new.id;

    if v_day_count = 0 then
      raise exception 'Storage billing cannot be invoiced without daily calculation evidence.';
    end if;
    if abs(v_billable_units - new.billable_bag_days) > 0.001
      or abs(v_total - new.total_amount) > 0.01 then
      raise exception 'Storage billing daily evidence does not match the run totals.';
    end if;
  end if;
  return new;
end;
$$;
