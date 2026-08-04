-- Migration: 20260805000000_warehouse_controls_and_billing.sql
-- Purpose: Storage loss, bag controls, generator recovery, tariffs, storage billing, ECS transfer & ownership transfer RPCs

-- 1. Tables for Warehouse Controls
create table if not exists public.storage_losses (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.coffee_lots(id),
  measured_balance_kg numeric(16,3) not null check (measured_balance_kg > 0),
  loss_kg numeric(16,3) not null check (loss_kg > 0 and loss_kg <= measured_balance_kg),
  loss_percent numeric(6,3) not null check (loss_percent >= 0),
  evidence_attached boolean not null default false,
  manager_approved_by uuid not null references public.profiles(id),
  exception_approved_by uuid references public.profiles(id),
  wet_coffee_joint_approved boolean not null default false,
  status text not null default 'POSTED' check (status in ('POSTED', 'REVERSED')),
  prepared_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (manager_approved_by <> prepared_by)
);

create table if not exists public.bag_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  lot_id uuid references public.coffee_lots(id),
  movement_type text not null check (movement_type in ('RECEIPT', 'ISSUE', 'RETURN', 'DAMAGE')),
  bag_count integer not null check (bag_count <> 0),
  reference text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.bag_printing_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  client_id uuid not null references public.clients(id),
  lot_id uuid references public.coffee_lots(id),
  quantity integer not null check (quantity >= 50),
  unit_rate numeric(10,2) not null check (unit_rate > 0),
  total_amount numeric(16,2) not null check (total_amount > 0),
  status text not null default 'APPROVED' check (status in ('DRAFT', 'APPROVED', 'INVOICED')),
  prepared_by uuid not null references public.profiles(id),
  approved_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (approved_by <> prepared_by)
);

create table if not exists public.generator_usage_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique,
  client_id uuid not null references public.clients(id),
  lot_id uuid references public.coffee_lots(id),
  diesel_litres numeric(10,2) not null check (diesel_litres > 0),
  unit_cost numeric(10,2) not null check (unit_cost > 0),
  total_cost numeric(16,2) not null check (total_cost > 0),
  status text not null default 'APPROVED' check (status in ('PENDING', 'APPROVED', 'INVOICED')),
  prepared_by uuid not null references public.profiles(id),
  approved_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (approved_by <> prepared_by)
);

-- 2. Tables for Tariffs & Storage Billing
create table if not exists public.tariff_versions (
  id uuid primary key default gen_random_uuid(),
  version_code text not null unique,
  description text,
  effective_from date not null,
  effective_to date,
  active boolean not null default true,
  verified_by_1 uuid references public.profiles(id),
  verified_by_2 uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.tariff_line_items (
  id uuid primary key default gen_random_uuid(),
  tariff_version_id uuid not null references public.tariff_versions(id) on delete cascade,
  category text not null check (category in ('NO_PROCESSING', 'WAITING_PROCESSING', 'PROCESSED_EXPORT', 'GRADE_IMPROVEMENT', 'REJECT', 'EMPTY_BAGS')),
  age_start_days integer not null check (age_start_days >= 0),
  age_end_days integer,
  daily_rate_per_unit numeric(10,2) not null check (daily_rate_per_unit >= 0),
  certified boolean not null default false
);

create table if not exists public.storage_billing_runs (
  id uuid primary key default gen_random_uuid(),
  run_number text not null unique,
  client_id uuid not null references public.clients(id),
  lot_id uuid not null references public.coffee_lots(id),
  category text not null check (category in ('NO_PROCESSING', 'WAITING_PROCESSING', 'PROCESSED_EXPORT', 'GRADE_IMPROVEMENT', 'REJECT', 'EMPTY_BAGS')),
  period_start date not null,
  period_end date not null,
  tariff_version text not null,
  billable_bag_days numeric(16,2) not null check (billable_bag_days >= 0),
  total_amount numeric(16,2) not null check (total_amount >= 0),
  duplicate_key text not null unique,
  status text not null default 'POSTED' check (status in ('POSTED', 'INVOICED')),
  run_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.service_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  lot_id uuid references public.coffee_lots(id),
  service_type text not null check (service_type in ('STORAGE', 'BAG_PRINTING', 'GENERATOR', 'LABOUR', 'HULLING', 'CLEANING')),
  description text not null,
  quantity numeric(16,3) not null check (quantity > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  total_amount numeric(16,2) not null check (total_amount >= 0),
  reference_id uuid,
  invoice_id uuid references public.invoices(id),
  status text not null default 'UNBILLED' check (status in ('UNBILLED', 'INVOICED')),
  created_at timestamptz not null default now()
);

-- Enable RLS on all newly created tables
alter table public.storage_losses enable row level security;
alter table public.bag_inventory_movements enable row level security;
alter table public.bag_printing_orders enable row level security;
alter table public.generator_usage_requests enable row level security;
alter table public.tariff_versions enable row level security;
alter table public.tariff_line_items enable row level security;
alter table public.storage_billing_runs enable row level security;
alter table public.service_events enable row level security;

-- Grand basic read/write policy for authenticated staff
create policy "Staff access storage_losses" on public.storage_losses for all to authenticated using (true) with check (true);
create policy "Staff access bag_inventory_movements" on public.bag_inventory_movements for all to authenticated using (true) with check (true);
create policy "Staff access bag_printing_orders" on public.bag_printing_orders for all to authenticated using (true) with check (true);
create policy "Staff access generator_usage_requests" on public.generator_usage_requests for all to authenticated using (true) with check (true);
create policy "Staff access tariff_versions" on public.tariff_versions for all to authenticated using (true) with check (true);
create policy "Staff access tariff_line_items" on public.tariff_line_items for all to authenticated using (true) with check (true);
create policy "Staff access storage_billing_runs" on public.storage_billing_runs for all to authenticated using (true) with check (true);
create policy "Staff access service_events" on public.service_events for all to authenticated using (true) with check (true);

-- Seed initial standard tariff if not existing
insert into public.tariff_versions (version_code, description, effective_from, active)
values ('TARIFF-2026-V1', 'Standard Hayked Coffee Warehouse Operational Tariff 2026', '2026-01-01', true)
on conflict (version_code) do nothing;

-- 3. Database RPC Functions

-- A. Storage Loss RPC
create or replace function public.post_storage_loss(
  p_lot_id uuid,
  p_loss_kg numeric,
  p_evidence_attached boolean,
  p_manager_approved_by uuid,
  p_exception_approved_by uuid default null,
  p_wet_coffee_joint_approved boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_lot public.coffee_lots;
  v_percent numeric;
  v_above_limit boolean;
  v_loss_id uuid;
begin
  v_user_id := (select auth.uid());
  perform private.require_role('system_admin', 'warehouse_manager');
  
  if p_manager_approved_by = v_user_id then
    raise exception 'Maker-checker policy violation: Manager approval cannot be self-issued.';
  end if;

  select * into v_lot from public.coffee_lots where id = p_lot_id;
  if not found then raise exception 'Coffee lot not found.'; end if;
  if p_loss_kg <= 0 or p_loss_kg > v_lot.quantity_kg then
    raise exception 'Loss must be positive and cannot exceed current lot quantity.';
  end if;
  if not p_evidence_attached then
    raise exception 'Measurement evidence must be attached.';
  end if;

  v_percent := (p_loss_kg / v_lot.quantity_kg) * 100.0;
  v_above_limit := v_percent > 1.5001;

  if v_above_limit and p_exception_approved_by is null then
    raise exception 'Loss above 1.5%% requires independent exception approval.';
  end if;

  insert into public.storage_losses (
    lot_id, measured_balance_kg, loss_kg, loss_percent, evidence_attached,
    manager_approved_by, exception_approved_by, wet_coffee_joint_approved,
    prepared_by
  ) values (
    p_lot_id, v_lot.quantity_kg, p_loss_kg, round(v_percent, 3), p_evidence_attached,
    p_manager_approved_by, p_exception_approved_by, p_wet_coffee_joint_approved,
    v_user_id
  ) returning id into v_loss_id;

  -- Create negative stock movement
  insert into public.stock_movements (
    lot_id, movement_type, quantity_kg, bag_delta, reference_id, occurred_at
  ) values (
    p_lot_id, 'ADJUSTMENT', -p_loss_kg, 0, v_loss_id, now()
  );

  -- Update lot balance
  update public.coffee_lots
  set quantity_kg = quantity_kg - p_loss_kg
  where id = p_lot_id;

  perform private.record_audit('POST_STORAGE_LOSS', 'coffee_lots', p_lot_id, jsonb_build_object('loss_kg', p_loss_kg, 'loss_percent', v_percent));
  return v_loss_id;
end;
$$;

-- B. Bag Printing Order RPC
create or replace function public.post_bag_printing_order(
  p_client_id uuid,
  p_lot_id uuid,
  p_quantity integer,
  p_approved_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_unit_rate numeric;
  v_total numeric;
  v_order_number text;
  v_order_id uuid;
begin
  v_user_id := (select auth.uid());
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer');

  if p_approved_by = v_user_id then
    raise exception 'Maker-checker policy violation: Order approval cannot be self-issued.';
  end if;
  if p_quantity < 50 then
    raise exception 'Minimum order quantity for bag printing is 50 bags.';
  end if;

  if p_quantity >= 160 then v_unit_rate := 43.48;
  elsif p_quantity >= 100 then v_unit_rate := 55.65;
  else v_unit_rate := 69.57;
  end if;

  v_total := round(p_quantity * v_unit_rate, 2);
  v_order_number := 'BPO-' || to_char(now(), 'YYYYMMDD') || '-' || floor(random() * 8999 + 1000)::text;

  insert into public.bag_printing_orders (
    order_number, client_id, lot_id, quantity, unit_rate, total_amount, prepared_by, approved_by
  ) values (
    v_order_number, p_client_id, p_lot_id, p_quantity, v_unit_rate, v_total, v_user_id, p_approved_by
  ) returning id into v_order_id;

  -- Register service event for billing
  insert into public.service_events (
    client_id, lot_id, service_type, description, quantity, unit_price, total_amount, reference_id
  ) values (
    p_client_id, p_lot_id, 'BAG_PRINTING', 'Custom Bag Printing (' || p_quantity || ' bags)', p_quantity, v_unit_rate, v_total, v_order_id
  );

  return v_order_id;
end;
$$;

-- C. Generator Recovery Request RPC
create or replace function public.post_generator_request(
  p_client_id uuid,
  p_lot_id uuid,
  p_diesel_litres numeric,
  p_unit_cost numeric,
  p_approved_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_total numeric;
  v_req_number text;
  v_req_id uuid;
begin
  v_user_id := (select auth.uid());
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');

  if p_approved_by = v_user_id then
    raise exception 'Maker-checker policy violation: Request approval cannot be self-issued.';
  end if;
  if p_diesel_litres <= 0 or p_unit_cost <= 0 then
    raise exception 'Diesel litres and unit cost must be positive values.';
  end if;

  v_total := round(p_diesel_litres * p_unit_cost, 2);
  v_req_number := 'GEN-' || to_char(now(), 'YYYYMMDD') || '-' || floor(random() * 8999 + 1000)::text;

  insert into public.generator_usage_requests (
    request_number, client_id, lot_id, diesel_litres, unit_cost, total_cost, prepared_by, approved_by
  ) values (
    v_req_number, p_client_id, p_lot_id, p_diesel_litres, p_unit_cost, v_total, v_user_id, p_approved_by
  ) returning id into v_req_id;

  insert into public.service_events (
    client_id, lot_id, service_type, description, quantity, unit_price, total_amount, reference_id
  ) values (
    p_client_id, p_lot_id, 'GENERATOR', 'Generator Diesel Fuel Recovery (' || p_diesel_litres || ' L)', p_diesel_litres, p_unit_cost, v_total, v_req_id
  );

  return v_req_id;
end;
$$;

-- D. Storage Billing Calculation & Run Persistence RPC
create or replace function public.calculate_and_save_storage_billing(
  p_client_id uuid,
  p_lot_id uuid,
  p_category text,
  p_period_start date,
  p_period_end date,
  p_tariff_version text default 'TARIFF-2026-V1',
  p_billable_bag_days numeric default 0,
  p_total_amount numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_dup_key text;
  v_run_number text;
  v_run_id uuid;
begin
  v_user_id := (select auth.uid());
  perform private.require_role('system_admin', 'finance_officer', 'warehouse_manager');

  v_dup_key := p_client_id::text || '|' || p_lot_id::text || '|' || p_category || '|' || p_period_start::text || '|' || p_period_end::text || '|' || p_tariff_version;

  if exists (select 1 from public.storage_billing_runs where duplicate_key = v_dup_key) then
    raise exception 'A billing run for this lot and date range has already been executed.';
  end if;

  v_run_number := 'SBR-' || to_char(now(), 'YYYYMMDD') || '-' || floor(random() * 8999 + 1000)::text;

  insert into public.storage_billing_runs (
    run_number, client_id, lot_id, category, period_start, period_end,
    tariff_version, billable_bag_days, total_amount, duplicate_key, run_by
  ) values (
    v_run_number, p_client_id, p_lot_id, p_category, p_period_start, p_period_end,
    p_tariff_version, p_billable_bag_days, p_total_amount, v_dup_key, v_user_id
  ) returning id into v_run_id;

  insert into public.service_events (
    client_id, lot_id, service_type, description, quantity, unit_price, total_amount, reference_id
  ) values (
    p_client_id, p_lot_id, 'STORAGE', 'Warehouse Storage Charges (' || p_period_start || ' to ' || p_period_end || ')',
    p_billable_bag_days, case when p_billable_bag_days > 0 then round(p_total_amount / p_billable_bag_days, 2) else 0 end,
    p_total_amount, v_run_id
  );

  return v_run_id;
end;
$$;

-- E. ECS Transfer (Dispatch & Receive) RPCs
create or replace function public.post_ecs_transfer(
  p_lot_id uuid,
  p_destination_warehouse_id uuid,
  p_sent_kg numeric,
  p_vehicle_plate text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_lot public.coffee_lots;
  v_transfer_number text;
  v_transfer_id uuid;
begin
  v_user_id := (select auth.uid());
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer');

  select * into v_lot from public.coffee_lots where id = p_lot_id;
  if not found then raise exception 'Source coffee lot not found.'; end if;
  if v_lot.warehouse_id = p_destination_warehouse_id then
    raise exception 'Source and destination warehouses must be different.';
  end if;
  if p_sent_kg <= 0 or p_sent_kg > v_lot.quantity_kg then
    raise exception 'Transfer quantity must be positive and cannot exceed lot quantity.';
  end if;

  v_transfer_number := 'ECS-' || to_char(now(), 'YYYYMMDD') || '-' || floor(random() * 8999 + 1000)::text;

  insert into public.ecs_transfers (
    transfer_number, lot_id, client_id, source_warehouse_id, destination_warehouse_id,
    sent_kg, status, sent_at, prepared_by
  ) values (
    v_transfer_number, p_lot_id, v_lot.client_id, v_lot.warehouse_id, p_destination_warehouse_id,
    p_sent_kg, 'IN_TRANSIT', now(), v_user_id
  ) returning id into v_transfer_id;

  -- Create negative stock movement at source
  insert into public.stock_movements (
    lot_id, movement_type, quantity_kg, bag_delta, reference_id, occurred_at
  ) values (
    p_lot_id, 'DISPATCH', -p_sent_kg, -ceil(p_sent_kg / 60.0)::integer, v_transfer_id, now()
  );

  update public.coffee_lots
  set quantity_kg = quantity_kg - p_sent_kg,
      bag_count = greatest(0, bag_count - ceil(p_sent_kg / 60.0)::integer)
  where id = p_lot_id;

  return v_transfer_id;
end;
$$;

create or replace function public.receive_ecs_transfer(
  p_transfer_id uuid,
  p_received_kg numeric,
  p_destination_section text default 'A-01 Arrival',
  p_variance_approved_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_transfer public.ecs_transfers;
  v_source_lot public.coffee_lots;
  v_new_lot_number text;
  v_new_lot_id uuid;
  v_variance numeric;
begin
  v_user_id := (select auth.uid());
  perform private.require_role('system_admin', 'warehouse_manager');

  select * into v_transfer from public.ecs_transfers where id = p_transfer_id;
  if not found then raise exception 'ECS Transfer record not found.'; end if;
  if v_transfer.status <> 'IN_TRANSIT' then
    raise exception 'Transfer has already been processed or reversed.';
  end if;

  v_variance := abs(p_received_kg - v_transfer.sent_kg);
  if v_variance > 0.01 and p_variance_approved_by is null then
    raise exception 'Receiving weight variance exceeds 0.01 kg limit; independent variance approval required.';
  end if;

  select * into v_source_lot from public.coffee_lots where id = v_transfer.lot_id;

  v_new_lot_number := v_source_lot.lot_number || '-ECS';

  -- Create new lot at destination warehouse
  insert into public.coffee_lots (
    lot_number, receipt_id, client_id, warehouse_id, coffee_type,
    bag_count, quantity_kg, section, status
  ) values (
    v_new_lot_number, v_source_lot.receipt_id, v_transfer.client_id, v_transfer.destination_warehouse_id,
    v_source_lot.coffee_type, ceil(p_received_kg / 60.0)::integer, p_received_kg, p_destination_section, 'ACTIVE'
  ) returning id into v_new_lot_id;

  -- Positive stock movement at destination
  insert into public.stock_movements (
    lot_id, movement_type, quantity_kg, bag_delta, reference_id, occurred_at
  ) values (
    v_new_lot_id, 'RECEIPT', p_received_kg, ceil(p_received_kg / 60.0)::integer, p_transfer_id, now()
  );

  update public.ecs_transfers
  set received_kg = p_received_kg,
      status = 'RECEIVED',
      received_at = now(),
      variance_approved_by = p_variance_approved_by
  where id = p_transfer_id;

  return v_new_lot_id;
end;
$$;

-- F. Ownership Transfer RPC
create or replace function public.post_ownership_transfer(
  p_source_lot_id uuid,
  p_destination_client_id uuid,
  p_quantity_kg numeric,
  p_signed_instruction_path text,
  p_hayked_approved_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_source_lot public.coffee_lots;
  v_dest_client public.clients;
  v_transfer_number text;
  v_child_lot_number text;
  v_child_lot_id uuid;
  v_transfer_id uuid;
  v_bags integer;
begin
  v_user_id := (select auth.uid());
  perform private.require_role('system_admin', 'warehouse_manager');

  if p_hayked_approved_by = v_user_id then
    raise exception 'Maker-checker policy violation: Transfer approval cannot be self-issued.';
  end if;

  select * into v_source_lot from public.coffee_lots where id = p_source_lot_id;
  if not found then raise exception 'Source coffee lot not found.'; end if;
  if v_source_lot.client_id = p_destination_client_id then
    raise exception 'Source and destination clients must be different.';
  end if;
  if p_quantity_kg <= 0 or p_quantity_kg > v_source_lot.quantity_kg then
    raise exception 'Transfer quantity must be positive and cannot exceed source lot balance.';
  end if;

  select * into v_dest_client from public.clients where id = p_destination_client_id;
  if not found or not v_dest_client.active then
    raise exception 'Destination client is not active.';
  end if;

  v_bags := ceil(p_quantity_kg / 60.0)::integer;
  v_transfer_number := 'OWN-' || to_char(now(), 'YYYYMMDD') || '-' || floor(random() * 8999 + 1000)::text;
  v_child_lot_number := v_source_lot.lot_number || '-TRF';

  -- Create child lot owned by destination client
  insert into public.coffee_lots (
    lot_number, receipt_id, client_id, warehouse_id, coffee_type,
    bag_count, quantity_kg, section, status
  ) values (
    v_child_lot_number, v_source_lot.receipt_id, p_destination_client_id, v_source_lot.warehouse_id,
    v_source_lot.coffee_type, v_bags, p_quantity_kg, v_source_lot.section, 'ACTIVE'
  ) returning id into v_child_lot_id;

  insert into public.ownership_transfers (
    transfer_number, source_lot_id, child_lot_id, source_client_id, destination_client_id,
    quantity_kg, signed_instruction_path, source_approved_at, destination_accepted_at,
    hayked_approved_by, status, posted_at
  ) values (
    v_transfer_number, p_source_lot_id, v_child_lot_id, v_source_lot.client_id, p_destination_client_id,
    p_quantity_kg, p_signed_instruction_path, now(), now(),
    p_hayked_approved_by, 'POSTED', now()
  ) returning id into v_transfer_id;

  -- Record negative movement on source lot
  insert into public.stock_movements (
    lot_id, movement_type, quantity_kg, bag_delta, reference_id, occurred_at
  ) values (
    p_source_lot_id, 'ADJUSTMENT', -p_quantity_kg, -v_bags, v_transfer_id, now()
  );

  -- Record positive movement on child lot
  insert into public.stock_movements (
    lot_id, movement_type, quantity_kg, bag_delta, reference_id, occurred_at
  ) values (
    v_child_lot_id, 'RECEIPT', p_quantity_kg, v_bags, v_transfer_id, now()
  );

  -- Update source lot balance
  update public.coffee_lots
  set quantity_kg = quantity_kg - p_quantity_kg,
      bag_count = greatest(0, bag_count - v_bags)
  where id = p_source_lot_id;

  return v_transfer_id;
end;
$$;

-- Grant execution to authenticated users
grant execute on function public.post_storage_loss to authenticated;
grant execute on function public.post_bag_printing_order to authenticated;
grant execute on function public.post_generator_request to authenticated;
grant execute on function public.calculate_and_save_storage_billing to authenticated;
grant execute on function public.post_ecs_transfer to authenticated;
grant execute on function public.receive_ecs_transfer to authenticated;
grant execute on function public.post_ownership_transfer to authenticated;
