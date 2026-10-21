-- Empty client-owned bags are independent of coffee lots and bag-printing orders.
-- Historical bag_inventory_movements and posted storage charges are untouched.
create table public.empty_bag_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  client_id uuid not null references public.clients(id),
  event_type text not null check (event_type in (
    'RECEIPT', 'ISSUE', 'RETURN', 'TRANSFER', 'RECLASSIFY', 'ADJUST_IN', 'ADJUST_OUT'
  )),
  bag_type text not null check (length(btrim(bag_type)) between 1 and 80),
  quantity integer not null check (quantity > 0),
  business_date date not null,
  document_reference text not null check (length(btrim(document_reference)) between 1 and 120),
  source_warehouse_id uuid references public.warehouses(id),
  source_location text,
  source_condition text check (source_condition in ('USABLE', 'HELD', 'DAMAGED')),
  destination_warehouse_id uuid references public.warehouses(id),
  destination_location text,
  destination_condition text check (destination_condition in ('USABLE', 'HELD', 'DAMAGED')),
  reason text,
  approved_by uuid references public.profiles(id),
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (organization_id, client_id, event_type, document_reference)
);

create table public.empty_bag_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.empty_bag_events(id),
  organization_id uuid not null references public.organizations(id),
  client_id uuid not null references public.clients(id),
  warehouse_id uuid not null references public.warehouses(id),
  location_code text not null check (length(btrim(location_code)) between 1 and 80),
  bag_type text not null,
  condition text not null check (condition in ('USABLE', 'HELD', 'DAMAGED')),
  business_date date not null,
  quantity_delta integer not null check (quantity_delta <> 0),
  created_at timestamptz not null default now(),
  unique (event_id, warehouse_id, location_code, condition)
);

create table public.empty_bag_change_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  client_id uuid not null references public.clients(id),
  event_type text not null check (event_type in ('RECLASSIFY', 'ADJUST_IN', 'ADJUST_OUT')),
  bag_type text not null,
  quantity integer not null check (quantity > 0),
  business_date date not null,
  document_reference text not null,
  source_warehouse_id uuid references public.warehouses(id),
  source_location text,
  source_condition text,
  destination_warehouse_id uuid references public.warehouses(id),
  destination_location text,
  destination_condition text,
  reason text not null check (length(btrim(reason)) >= 5),
  requested_by uuid not null references public.profiles(id),
  status text not null default 'PENDING' check (status in ('PENDING', 'POSTED', 'REJECTED')),
  decided_by uuid references public.profiles(id),
  decision_note text,
  event_id uuid references public.empty_bag_events(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (organization_id, client_id, event_type, document_reference)
);

create index empty_bag_ledger_balance_idx on public.empty_bag_ledger_entries
  (organization_id, client_id, bag_type, warehouse_id, location_code, condition, business_date);
create index empty_bag_ledger_date_idx on public.empty_bag_ledger_entries
  (organization_id, client_id, business_date);

alter table public.empty_bag_events enable row level security;
alter table public.empty_bag_ledger_entries enable row level security;
alter table public.empty_bag_change_requests enable row level security;
grant execute on function private.current_organization_id() to authenticated;
revoke all on public.empty_bag_events, public.empty_bag_ledger_entries, public.empty_bag_change_requests from public, anon, authenticated;
grant select on public.empty_bag_events, public.empty_bag_ledger_entries, public.empty_bag_change_requests to authenticated;

create policy empty_bag_events_staff_read on public.empty_bag_events
  for select to authenticated using (
    organization_id = (select private.current_organization_id())
    and (select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'finance_officer', 'auditor', 'viewer'))
  );
create policy empty_bag_ledger_staff_read on public.empty_bag_ledger_entries
  for select to authenticated using (
    organization_id = (select private.current_organization_id())
    and (select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'finance_officer', 'auditor', 'viewer'))
  );
create policy empty_bag_change_staff_read on public.empty_bag_change_requests
  for select to authenticated using (
    organization_id = (select private.current_organization_id())
    and (select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'finance_officer', 'auditor', 'viewer'))
  );

create trigger empty_bag_events_immutable before update or delete on public.empty_bag_events
  for each row execute function private.prevent_mutation();
create trigger empty_bag_ledger_immutable before update or delete on public.empty_bag_ledger_entries
  for each row execute function private.prevent_mutation();

create view public.empty_bag_balances with (security_invoker = true) as
select organization_id, client_id, warehouse_id, location_code, bag_type, condition,
  sum(quantity_delta)::integer as bag_count
from public.empty_bag_ledger_entries
group by organization_id, client_id, warehouse_id, location_code, bag_type, condition
having sum(quantity_delta) <> 0;
revoke all on public.empty_bag_balances from public, anon, authenticated;
grant select on public.empty_bag_balances to authenticated;

create function public.post_empty_bag_event(
  p_client_id uuid,
  p_event_type text,
  p_bag_type text,
  p_quantity integer,
  p_business_date date,
  p_document_reference text,
  p_source_warehouse_id uuid default null,
  p_source_location text default null,
  p_source_condition text default null,
  p_destination_warehouse_id uuid default null,
  p_destination_location text default null,
  p_destination_condition text default null,
  p_reason text default null,
  p_approved_by uuid default null,
  p_change_request_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_org uuid := (select private.current_organization_id());
  v_event_id uuid;
  v_available integer;
  v_request public.empty_bag_change_requests;
  v_recorded_by uuid := v_actor;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer');
  if v_org is null or not exists (
    select 1 from public.clients where id = p_client_id and organization_id = v_org and active
  ) then
    raise exception 'Select an active client in your organization.';
  end if;
  if p_event_type is null or p_event_type not in ('RECEIPT', 'ISSUE', 'RETURN', 'TRANSFER', 'RECLASSIFY', 'ADJUST_IN', 'ADJUST_OUT')
    or p_quantity is null or p_quantity <= 0
    or p_business_date is null or p_business_date > (now() at time zone 'Africa/Addis_Ababa')::date
    or length(btrim(coalesce(p_bag_type, ''))) not between 1 and 80
    or length(btrim(coalesce(p_document_reference, ''))) not between 1 and 120 then
    raise exception 'Enter a valid movement type, positive bag count, business date, bag type and document reference.';
  end if;
  if p_source_warehouse_id is not null and not exists (
    select 1 from public.warehouses where id = p_source_warehouse_id and organization_id = v_org and active
  ) then raise exception 'Select an active source warehouse in your organization.'; end if;
  if p_destination_warehouse_id is not null and not exists (
    select 1 from public.warehouses where id = p_destination_warehouse_id and organization_id = v_org and active
  ) then raise exception 'Select an active destination warehouse in your organization.'; end if;
  if p_event_type in ('ISSUE', 'TRANSFER', 'RECLASSIFY', 'ADJUST_OUT') and (
    p_source_warehouse_id is null or length(btrim(coalesce(p_source_location, ''))) not between 1 and 80
    or p_source_condition is null or p_source_condition not in ('USABLE', 'HELD', 'DAMAGED')
  ) then raise exception 'Choose the source warehouse, location and condition.'; end if;
  if p_event_type in ('RECEIPT', 'RETURN', 'TRANSFER', 'RECLASSIFY', 'ADJUST_IN') and (
    p_destination_warehouse_id is null or length(btrim(coalesce(p_destination_location, ''))) not between 1 and 80
    or p_destination_condition is null or p_destination_condition not in ('USABLE', 'HELD', 'DAMAGED')
  ) then raise exception 'Choose the destination warehouse, location and condition.'; end if;
  if p_event_type in ('RECEIPT', 'RETURN', 'ADJUST_IN') and p_source_warehouse_id is not null
    or p_event_type in ('ISSUE', 'ADJUST_OUT') and p_destination_warehouse_id is not null then
    raise exception 'This movement has only one storage location.';
  end if;
  if p_event_type = 'TRANSFER' and (
    p_source_condition is distinct from p_destination_condition
    or (p_source_warehouse_id, upper(btrim(p_source_location)))
       is not distinct from (p_destination_warehouse_id, upper(btrim(p_destination_location)))
  ) then raise exception 'A transfer needs a different location and keeps the same bag condition.'; end if;
  if p_event_type = 'RECLASSIFY' and (
    (p_source_warehouse_id, upper(btrim(p_source_location)))
       is distinct from (p_destination_warehouse_id, upper(btrim(p_destination_location)))
    or p_source_condition is not distinct from p_destination_condition
  ) then raise exception 'A condition change must stay in one location and change the condition.'; end if;
  if p_event_type in ('ADJUST_IN', 'ADJUST_OUT', 'RECLASSIFY') then
    perform private.require_role('system_admin', 'warehouse_manager');
    if length(btrim(coalesce(p_reason, ''))) < 5 or p_change_request_id is null
      or p_approved_by is distinct from v_actor then
      raise exception 'Count or condition changes require a pending request reviewed by a different manager.';
    end if;
    select * into v_request from public.empty_bag_change_requests
    where id = p_change_request_id and organization_id = v_org for update;
    if not found or v_request.status <> 'PENDING' or v_request.requested_by = v_actor
      or (v_request.client_id, v_request.event_type, v_request.bag_type,
          v_request.quantity, v_request.business_date, v_request.document_reference,
          v_request.source_warehouse_id, v_request.source_location, v_request.source_condition,
          v_request.destination_warehouse_id, v_request.destination_location,
          v_request.destination_condition, v_request.reason)
        is distinct from
         (p_client_id, p_event_type, upper(btrim(p_bag_type)), p_quantity, p_business_date,
          upper(btrim(p_document_reference)), p_source_warehouse_id,
          nullif(upper(btrim(p_source_location)), ''), p_source_condition,
          p_destination_warehouse_id, nullif(upper(btrim(p_destination_location)), ''),
          p_destination_condition, btrim(p_reason)) then
      raise exception 'This change request is missing, changed, already decided, or belongs to the reviewer.';
    end if;
    v_recorded_by := v_request.requested_by;
  elsif p_approved_by is not null or p_change_request_id is not null then
    raise exception 'Approval is only used for a pending count or condition change.';
  end if;

  -- Serialize movements per client so two issues cannot both spend the same bags.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_client_id::text, 0));
  if p_business_date < coalesce((
    select max(business_date) from public.empty_bag_events
    where organization_id = v_org and client_id = p_client_id and bag_type = upper(btrim(p_bag_type))
  ), p_business_date) then
    raise exception 'Post movements in business-date order; use a current count adjustment to correct older records.';
  end if;
  if p_event_type in ('ISSUE', 'TRANSFER', 'RECLASSIFY', 'ADJUST_OUT') then
    select coalesce(sum(quantity_delta), 0)::integer into v_available
    from public.empty_bag_ledger_entries
    where organization_id = v_org and client_id = p_client_id
      and bag_type = upper(btrim(p_bag_type)) and warehouse_id = p_source_warehouse_id
      and location_code = upper(btrim(p_source_location)) and condition = p_source_condition;
    if v_available < p_quantity then
      raise exception 'Only % bags are available at the selected location and condition.', v_available;
    end if;
  end if;

  insert into public.empty_bag_events (
    organization_id, client_id, event_type, bag_type, quantity, business_date, document_reference,
    source_warehouse_id, source_location, source_condition,
    destination_warehouse_id, destination_location, destination_condition,
    reason, approved_by, recorded_by
  ) values (
    v_org, p_client_id, p_event_type, upper(btrim(p_bag_type)), p_quantity, p_business_date, upper(btrim(p_document_reference)),
    p_source_warehouse_id, nullif(upper(btrim(p_source_location)), ''), p_source_condition,
    p_destination_warehouse_id, nullif(upper(btrim(p_destination_location)), ''), p_destination_condition,
    nullif(btrim(p_reason), ''), p_approved_by, v_recorded_by
  ) returning id into v_event_id;

  if p_event_type in ('ISSUE', 'TRANSFER', 'RECLASSIFY', 'ADJUST_OUT') then
    insert into public.empty_bag_ledger_entries (
      event_id, organization_id, client_id, warehouse_id, location_code, bag_type, condition,
      business_date, quantity_delta
    ) values (
      v_event_id, v_org, p_client_id, p_source_warehouse_id, upper(btrim(p_source_location)),
      upper(btrim(p_bag_type)), p_source_condition, p_business_date, -p_quantity
    );
  end if;
  if p_event_type in ('RECEIPT', 'RETURN', 'TRANSFER', 'RECLASSIFY', 'ADJUST_IN') then
    insert into public.empty_bag_ledger_entries (
      event_id, organization_id, client_id, warehouse_id, location_code, bag_type, condition,
      business_date, quantity_delta
    ) values (
      v_event_id, v_org, p_client_id, p_destination_warehouse_id, upper(btrim(p_destination_location)),
      upper(btrim(p_bag_type)), p_destination_condition, p_business_date, p_quantity
    );
  end if;
  if p_change_request_id is not null then
    update public.empty_bag_change_requests set status = 'POSTED',
      decided_by = v_actor, decided_at = now(), event_id = v_event_id
    where id = p_change_request_id;
  end if;
  perform private.record_audit('EMPTY_BAG_MOVEMENT_POSTED', 'EMPTY_BAG_EVENT', v_event_id,
    jsonb_build_object('type', p_event_type, 'client_id', p_client_id,
      'quantity', p_quantity, 'reference', upper(btrim(p_document_reference))));
  return v_event_id;
end;
$$;
revoke all on function public.post_empty_bag_event(
  uuid, text, text, integer, date, text, uuid, text, text, uuid, text, text, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.post_empty_bag_event(
  uuid, text, text, integer, date, text, uuid, text, text, uuid, text, text, text, uuid, uuid
) to authenticated;

create function public.request_empty_bag_change(
  p_client_id uuid,
  p_event_type text,
  p_bag_type text,
  p_quantity integer,
  p_business_date date,
  p_document_reference text,
  p_source_warehouse_id uuid default null,
  p_source_location text default null,
  p_source_condition text default null,
  p_destination_warehouse_id uuid default null,
  p_destination_location text default null,
  p_destination_condition text default null,
  p_reason text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := (select private.current_organization_id());
  v_id uuid;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer');
  if p_event_type is null or p_event_type not in ('RECLASSIFY', 'ADJUST_IN', 'ADJUST_OUT')
    or p_quantity is null or p_quantity <= 0
    or p_business_date is null or p_business_date > (now() at time zone 'Africa/Addis_Ababa')::date
    or length(btrim(coalesce(p_bag_type, ''))) not between 1 and 80
    or length(btrim(coalesce(p_document_reference, ''))) not between 1 and 120
    or length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Provide a valid count or condition change, quantity, date, reference and reason.';
  end if;
  if not exists (select 1 from public.clients
      where id = p_client_id and organization_id = v_org and active) then
    raise exception 'Select an active client in your organization.';
  end if;
  if p_source_warehouse_id is not null and not exists (select 1 from public.warehouses
      where id = p_source_warehouse_id and organization_id = v_org and active) then
    raise exception 'Choose an active source warehouse in your organization.';
  end if;
  if p_destination_warehouse_id is not null and not exists (select 1 from public.warehouses
      where id = p_destination_warehouse_id and organization_id = v_org and active) then
    raise exception 'Choose an active destination warehouse in your organization.';
  end if;
  if p_event_type in ('ADJUST_OUT', 'RECLASSIFY') and (
    p_source_warehouse_id is null or length(btrim(coalesce(p_source_location, ''))) not between 1 and 80
    or p_source_condition is null or p_source_condition not in ('USABLE', 'HELD', 'DAMAGED')
  ) then raise exception 'Choose a valid source balance.'; end if;
  if p_event_type in ('ADJUST_IN', 'RECLASSIFY') and (
    p_destination_warehouse_id is null or length(btrim(coalesce(p_destination_location, ''))) not between 1 and 80
    or p_destination_condition is null or p_destination_condition not in ('USABLE', 'HELD', 'DAMAGED')
  ) then raise exception 'Choose a valid destination balance.'; end if;
  if p_event_type = 'RECLASSIFY' and (
    (p_source_warehouse_id, upper(btrim(p_source_location)))
      is distinct from (p_destination_warehouse_id, upper(btrim(p_destination_location)))
    or p_source_condition is not distinct from p_destination_condition
  ) then raise exception 'A condition change must stay in one location and change the condition.'; end if;
  if p_event_type = 'ADJUST_OUT' and p_destination_warehouse_id is not null
    or p_event_type = 'ADJUST_IN' and p_source_warehouse_id is not null then
    raise exception 'A count adjustment has one storage location.';
  end if;

  insert into public.empty_bag_change_requests (
    organization_id, client_id, event_type, bag_type, quantity, business_date, document_reference,
    source_warehouse_id, source_location, source_condition,
    destination_warehouse_id, destination_location, destination_condition,
    reason, requested_by
  ) values (
    v_org, p_client_id, p_event_type, upper(btrim(p_bag_type)), p_quantity,
    p_business_date, upper(btrim(p_document_reference)),
    p_source_warehouse_id, nullif(upper(btrim(p_source_location)), ''), p_source_condition,
    p_destination_warehouse_id, nullif(upper(btrim(p_destination_location)), ''), p_destination_condition,
    btrim(p_reason), (select auth.uid())
  ) returning id into v_id;
  perform private.record_audit('EMPTY_BAG_CHANGE_REQUESTED', 'EMPTY_BAG_CHANGE_REQUEST', v_id,
    jsonb_build_object('client_id', p_client_id, 'type', p_event_type, 'quantity', p_quantity));
  return v_id;
end;
$$;
revoke all on function public.request_empty_bag_change(
  uuid, text, text, integer, date, text, uuid, text, text, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.request_empty_bag_change(
  uuid, text, text, integer, date, text, uuid, text, text, uuid, text, text, text
) to authenticated;

create function public.decide_empty_bag_change(
  p_request_id uuid,
  p_approve boolean,
  p_decision_note text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_request public.empty_bag_change_requests;
  v_actor uuid := (select auth.uid());
  v_event_id uuid;
begin
  perform private.require_role('system_admin', 'warehouse_manager');
  select * into v_request from public.empty_bag_change_requests
  where id = p_request_id and organization_id = (select private.current_organization_id()) for update;
  if not found or v_request.status <> 'PENDING' or v_request.requested_by = v_actor then
    raise exception 'Only a different manager can decide a pending bag change.';
  end if;
  if p_approve is null then raise exception 'Choose approve or reject.'; end if;
  if not p_approve then
    if length(btrim(coalesce(p_decision_note, ''))) < 5 then
      raise exception 'Record a reason for rejecting the change.';
    end if;
    update public.empty_bag_change_requests set status = 'REJECTED',
      decided_by = v_actor, decided_at = now(), decision_note = btrim(p_decision_note)
    where id = p_request_id;
    perform private.record_audit('EMPTY_BAG_CHANGE_REJECTED', 'EMPTY_BAG_CHANGE_REQUEST', p_request_id,
      jsonb_build_object('reason', btrim(p_decision_note)));
    return null;
  end if;

  v_event_id := public.post_empty_bag_event(
    v_request.client_id, v_request.event_type, v_request.bag_type, v_request.quantity,
    v_request.business_date, v_request.document_reference, v_request.source_warehouse_id,
    v_request.source_location, v_request.source_condition, v_request.destination_warehouse_id,
    v_request.destination_location, v_request.destination_condition, v_request.reason,
    v_actor, v_request.id
  );
  return v_event_id;
end;
$$;
revoke all on function public.decide_empty_bag_change(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.decide_empty_bag_change(uuid, boolean, text)
  to authenticated;

create function public.empty_bag_daily_statement(
  p_client_id uuid,
  p_from date,
  p_to date
)
returns table (
  business_date date,
  opening_bags integer,
  movement_bags integer,
  closing_bags integer,
  document_references text[]
)
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := (select private.current_organization_id());
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'finance_officer', 'auditor', 'viewer');
  if not exists (select 1 from public.clients where id = p_client_id and organization_id = v_org) then
    raise exception 'The client does not belong to your organization.';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to > (now() at time zone 'Africa/Addis_Ababa')::date
    or p_to - p_from > 365 then
    raise exception 'Choose a valid custody statement of at most 366 completed or current days.';
  end if;
  return query
  with days as (
    select day::date as d from pg_catalog.generate_series(p_from, p_to, interval '1 day') day
  )
  select days.d,
    coalesce(sum(entry.quantity_delta) filter (where entry.business_date < days.d), 0)::integer,
    coalesce(sum(entry.quantity_delta) filter (where entry.business_date = days.d), 0)::integer,
    coalesce(sum(entry.quantity_delta), 0)::integer,
    coalesce(array_agg(distinct event.document_reference)
      filter (where entry.business_date = days.d), '{}'::text[])
  from days
  left join public.empty_bag_ledger_entries entry
    on entry.organization_id = v_org and entry.client_id = p_client_id
      and entry.business_date <= days.d
  left join public.empty_bag_events event on event.id = entry.event_id
  group by days.d
  order by days.d;
end;
$$;
revoke all on function public.empty_bag_daily_statement(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.empty_bag_daily_statement(uuid, date, date)
  to authenticated;

-- Prevent the legacy coffee-lot route from quoting or posting Article 16 bag rent.
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
  if p_category = 'EMPTY_BAGS' then
    raise exception 'Use the separate empty-bag custody ledger for Article 16 storage. Coffee-lot bags are not a valid billing source.';
  end if;
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
  v_billing_basis := 'EQUIVALENT_BAG_FROM_KG';

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
    b.closing_kg / v_bag_weight_kg as units
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

create function private.reject_legacy_empty_bag_rent()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_table_name = 'storage_rent_records' then
    if new.storage_category = 'EMPTY_BAGS' then
      raise exception 'Use the separate empty-bag custody ledger for Article 16 storage.';
    end if;
  elsif tg_table_name = 'storage_billing_runs' then
    if new.category = 'EMPTY_BAGS' then
      raise exception 'Use the separate empty-bag custody ledger for Article 16 storage.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.reject_legacy_empty_bag_rent() from public, anon, authenticated;
create trigger storage_rent_no_new_coffee_lot_empty_bags
  before insert on public.storage_rent_records
  for each row execute function private.reject_legacy_empty_bag_rent();
create trigger storage_runs_no_new_coffee_lot_empty_bags
  before insert on public.storage_billing_runs
  for each row execute function private.reject_legacy_empty_bag_rent();
