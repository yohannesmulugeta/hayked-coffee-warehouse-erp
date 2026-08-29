-- Make client setup atomic and storage billing tariff-authoritative.

alter table public.storage_billing_runs
  add column if not exists certified boolean not null default false;

create or replace function private.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id from public.profiles where id = (select auth.uid())
$$;

revoke all on function private.current_organization_id() from public, anon, authenticated;
alter table public.audit_events alter column organization_id set default private.current_organization_id();

create table if not exists public.storage_billing_run_days (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.storage_billing_runs(id),
  charge_date date not null,
  opening_bags numeric(16,3) not null,
  movement_bags numeric(16,3) not null,
  closing_bags numeric(16,3) not null,
  age_day integer not null check (age_day > 0),
  rate_etb numeric(10,2) not null check (rate_etb >= 0),
  billable_units numeric(16,3) not null check (billable_units >= 0),
  amount_etb numeric(16,2) not null check (amount_etb >= 0),
  movement_references text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (run_id, charge_date)
);

create index if not exists storage_billing_run_days_run_date_idx
  on public.storage_billing_run_days (run_id, charge_date);

alter table public.storage_billing_run_days enable row level security;

create policy staff_read_storage_billing_run_days
  on public.storage_billing_run_days for select to authenticated
  using ((select private.has_role('system_admin', 'warehouse_manager', 'finance_officer', 'auditor', 'viewer')));

revoke all on public.storage_billing_run_days from public, anon, authenticated;
grant select on public.storage_billing_run_days to authenticated;

drop trigger if exists storage_billing_run_days_immutable on public.storage_billing_run_days;
create trigger storage_billing_run_days_immutable
  before update or delete on public.storage_billing_run_days
  for each row execute function private.prevent_mutation();

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
        and rate.certified = p_certified
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
    select
      days.charge_date,
      coalesce(sum(movement.bag_delta), 0)::numeric as movement_bags,
      coalesce(array_agg(distinct movement.reference_type || ':' || left(movement.reference_id::text, 8))
        filter (where movement.id is not null), '{}')::text[] as movement_references
    from days
    left join public.stock_movements movement
      on movement.lot_id = p_lot_id and movement.occurred_at::date = days.charge_date
    group by days.charge_date
  ),
  balances as (
    select
      daily.*,
      coalesce(sum(daily.movement_bags) over (
        order by daily.charge_date rows between unbounded preceding and 1 preceding
      ), 0)::numeric as opening_bags,
      sum(daily.movement_bags) over (order by daily.charge_date)::numeric as closing_bags
    from daily
  )
  select
    balance.charge_date,
    balance.opening_bags,
    balance.movement_bags,
    balance.closing_bags,
    ((balance.charge_date - v_received_date) + 1)::integer as age_day,
    rate.daily_rate_per_unit::numeric as rate_etb,
    (case when p_category = 'EMPTY_BAGS' then balance.closing_bags / 50 else balance.closing_bags end)::numeric as billable_units,
    round((case when p_category = 'EMPTY_BAGS' then balance.closing_bags / 50 else balance.closing_bags end) * rate.daily_rate_per_unit, 2)::numeric as amount_etb,
    balance.movement_references
  from balances balance
  join lateral (
    select line.daily_rate_per_unit
    from public.tariff_line_items line
    where line.tariff_version_id = v_tariff_id
      and line.category = p_category
      and line.certified = p_certified
      and ((balance.charge_date - v_received_date) + 1) >= line.age_start_days
      and (line.age_end_days is null or ((balance.charge_date - v_received_date) + 1) <= line.age_end_days)
    order by line.age_start_days desc
    limit 1
  ) rate on true
  where balance.charge_date >= p_period_start
  order by balance.charge_date;
end;
$$;

revoke all on function private.storage_billing_daily_rows(uuid, uuid, text, date, date, boolean, text)
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
    'duplicateKey', p_client_id::text || '|' || p_lot_id::text || '|' || p_category || '|' || p_period_start::text || '|' || p_period_end::text || '|' || p_tariff_version,
    'billableBagDays', coalesce(sum(row.billable_units) filter (where row.rate_etb > 0 and row.closing_bags > 0), 0),
    'amount', coalesce(sum(row.amount_etb) filter (where row.rate_etb > 0 and row.closing_bags > 0), 0),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'date', row.charge_date,
      'openingBags', row.opening_bags,
      'movementBags', row.movement_bags,
      'closingBags', row.closing_bags,
      'ageDay', row.age_day,
      'rate', row.rate_etb,
      'units', row.billable_units,
      'amount', row.amount_etb,
      'references', row.movement_references
    ) order by row.charge_date), '[]'::jsonb)
  )
  into v_result
  from private.storage_billing_daily_rows(
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

  select
    coalesce(sum(row.billable_units) filter (where row.rate_etb > 0 and row.closing_bags > 0), 0),
    coalesce(sum(row.amount_etb) filter (where row.rate_etb > 0 and row.closing_bags > 0), 0)
  into v_billable_units, v_total
  from private.storage_billing_daily_rows(
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
    age_day, rate_etb, billable_units, amount_etb, movement_references
  )
  select
    v_run_id, row.charge_date, row.opening_bags, row.movement_bags, row.closing_bags,
    row.age_day, row.rate_etb, row.billable_units, row.amount_etb, row.movement_references
  from private.storage_billing_daily_rows(
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
    jsonb_build_object('run_number', v_run_number, 'tariff_version', p_tariff_version, 'total_amount', v_total));

  return v_run_id;
end;
$$;

create or replace function public.create_client_setup(
  p_client jsonb,
  p_agreement jsonb default null,
  p_representatives jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_organization_id uuid;
  v_client_id uuid;
  v_agreement_id uuid;
  v_representative jsonb;
  v_representative_count integer := 0;
  v_code text := trim(coalesce(p_client ->> 'code', ''));
  v_legal_name text := trim(coalesce(p_client ->> 'legalName', ''));
  v_effective_from date;
  v_effective_to date;
  v_valid_from date;
  v_valid_to date;
begin
  perform private.require_role('system_admin', 'warehouse_manager');
  if v_code = '' or v_legal_name = '' then
    raise exception 'Client code and legal name are required.';
  end if;

  select id into v_organization_id from public.organizations where code = 'HAYKED';
  if v_organization_id is null then raise exception 'Hayked organization setup is missing.'; end if;
  if exists (select 1 from public.clients where organization_id = v_organization_id and lower(code) = lower(v_code)) then
    raise exception 'Client code % already exists.', v_code;
  end if;

  insert into public.clients (organization_id, code, legal_name, tin, phone, email, active, created_by)
  values (
    v_organization_id, v_code, v_legal_name,
    nullif(trim(p_client ->> 'tin'), ''), nullif(trim(p_client ->> 'phone'), ''),
    nullif(trim(p_client ->> 'email'), ''), true, v_user_id
  ) returning id into v_client_id;

  if p_agreement is not null and trim(coalesce(p_agreement ->> 'agreementNumber', '')) <> '' then
    v_effective_from := (p_agreement ->> 'effectiveFrom')::date;
    v_effective_to := nullif(p_agreement ->> 'effectiveTo', '')::date;
    if v_effective_to is not null and v_effective_to < v_effective_from then
      raise exception 'Agreement expiry cannot be before its effective date.';
    end if;
    insert into public.agreements (
      client_id, agreement_number, effective_from, effective_to, status,
      default_bag_weight_kg, tariff_version, created_by
    ) values (
      v_client_id, trim(p_agreement ->> 'agreementNumber'), v_effective_from, v_effective_to,
      coalesce(nullif(p_agreement ->> 'status', ''), 'DRAFT'),
      coalesce((p_agreement ->> 'defaultBagWeightKg')::numeric, 60),
      trim(p_agreement ->> 'tariffVersion'), v_user_id
    ) returning id into v_agreement_id;
  end if;

  if jsonb_typeof(coalesce(p_representatives, '[]'::jsonb)) <> 'array' then
    raise exception 'Representatives must be supplied as a list.';
  end if;
  for v_representative in select value from jsonb_array_elements(coalesce(p_representatives, '[]'::jsonb))
  loop
    if trim(coalesce(v_representative ->> 'fullName', '')) = '' or trim(coalesce(v_representative ->> 'identityNumber', '')) = '' then
      raise exception 'Every representative needs a full name and identity number.';
    end if;
    v_valid_from := (v_representative ->> 'validFrom')::date;
    v_valid_to := nullif(v_representative ->> 'validTo', '')::date;
    if v_valid_to is not null and v_valid_to < v_valid_from then
      raise exception 'Representative authorization expiry cannot be before its start date.';
    end if;
    insert into public.authorized_representatives (
      client_id, full_name, identity_number, phone, valid_from, valid_to, active
    ) values (
      v_client_id, trim(v_representative ->> 'fullName'), trim(v_representative ->> 'identityNumber'),
      nullif(trim(v_representative ->> 'phone'), ''), v_valid_from, v_valid_to,
      coalesce((v_representative ->> 'active')::boolean, true)
    );
    v_representative_count := v_representative_count + 1;
  end loop;

  insert into public.audit_events (actor_id, action, reference_type, reference_id, event_data)
  values (v_user_id, 'CLIENT_SETUP_CREATED', 'CLIENT', v_client_id,
    jsonb_build_object('client_code', v_code, 'agreement_id', v_agreement_id, 'representative_count', v_representative_count));

  return jsonb_build_object(
    'clientId', v_client_id,
    'agreementId', v_agreement_id,
    'representativeCount', v_representative_count
  );
end;
$$;

revoke all on function public.quote_storage_billing(uuid, uuid, text, date, date, boolean, text)
  from public, anon;
revoke all on function public.calculate_and_save_storage_billing_v2(uuid, uuid, text, date, date, boolean, text)
  from public, anon;
revoke all on function public.create_client_setup(jsonb, jsonb, jsonb)
  from public, anon;
revoke execute on function public.calculate_and_save_storage_billing(uuid, uuid, text, date, date, text, numeric, numeric)
  from public, anon, authenticated;

grant execute on function public.quote_storage_billing(uuid, uuid, text, date, date, boolean, text)
  to authenticated;
grant execute on function public.calculate_and_save_storage_billing_v2(uuid, uuid, text, date, date, boolean, text)
  to authenticated;
grant execute on function public.create_client_setup(jsonb, jsonb, jsonb)
  to authenticated;
