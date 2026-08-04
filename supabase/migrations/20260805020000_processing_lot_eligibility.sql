-- Migration: 20260805020000_processing_lot_eligibility.sql
-- Purpose: Explicit lot_category classification, RPC for eligible processing lots, and strict positive allowlist validation rules

-- 1. Add lot_category and source_processing_order_id to coffee_lots
alter table public.coffee_lots
  add column if not exists lot_category text check (lot_category in ('ARRIVAL', 'ACCEPTED_PROCESSED', 'CLIENT_REJECT', 'HAYKED_BYPRODUCT', 'OTHER')),
  add column if not exists source_processing_order_id uuid references public.processing_orders(id);

create index if not exists coffee_lots_client_category_idx on public.coffee_lots (client_id, lot_category, status);

-- 2. Backfill existing lot records based on reliable source evidence
-- A. Arrival lots (created from GRN)
update public.coffee_lots
set lot_category = 'ARRIVAL'
where lot_category is null and receipt_id is not null;

-- B. Hayked-owned byproduct lots
update public.coffee_lots
set lot_category = 'HAYKED_BYPRODUCT'
where lot_category is null and ownership_type = 'HAYKED';

-- C. Lots created from processing outputs
update public.coffee_lots lot
set lot_category = case 
      when po.category = 'ACCEPTED_CLIENT_COFFEE' then 'ACCEPTED_PROCESSED'
      when po.category = 'CLIENT_REJECT' then 'CLIENT_REJECT'
      when po.category = 'HAYKED_BYPRODUCT' then 'HAYKED_BYPRODUCT'
      else 'OTHER'
    end,
    source_processing_order_id = po.order_id
from public.processing_outputs po
where lot.id = po.child_lot_id and lot.lot_category is null;

-- Default remaining unclassified legacy records to OTHER
update public.coffee_lots
set lot_category = 'OTHER'
where lot_category is null;

-- Set default for new rows
alter table public.coffee_lots
  alter column lot_category set default 'ARRIVAL';

-- 3. Function to query eligible processing lots for a given client (STRICT POSITIVE ALLOWLIST)
create or replace function public.list_eligible_processing_lots(
  p_client_id uuid
)
returns table (
  lot_id uuid,
  lot_number text,
  client_id uuid,
  lot_category text,
  coffee_type text,
  grade text,
  section text,
  bag_count integer,
  quantity_kg numeric(16,3),
  reserved_kg numeric(16,3),
  available_kg numeric(16,3),
  available_bags integer,
  receipt_id uuid,
  parent_lot_id uuid,
  source_processing_order_id uuid,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'finance_officer', 'auditor', 'viewer');

  return query
  with active_reservations as (
    select
      sr.lot_id as res_lot_id,
      coalesce(sum(sr.reserved_kg), 0) as total_reserved_kg,
      coalesce(sum(sr.reserved_bags), 0) as total_reserved_bags
    from public.stock_reservations sr
    where sr.status = 'ACTIVE'
    group by sr.lot_id
  )
  select
    cl.id as lot_id,
    cl.lot_number,
    cl.client_id,
    cl.lot_category,
    cl.coffee_type,
    coalesce(wr.grade, 'Standard') as grade,
    cl.section,
    cl.bag_count,
    cl.quantity_kg,
    coalesce(ar.total_reserved_kg, 0) as reserved_kg,
    greatest(0, cl.quantity_kg - coalesce(ar.total_reserved_kg, 0)) as available_kg,
    greatest(0, cl.bag_count - coalesce(ar.total_reserved_bags, 0)) as available_bags,
    cl.receipt_id,
    cl.parent_lot_id,
    cl.source_processing_order_id,
    cl.status,
    cl.created_at
  from public.coffee_lots cl
  left join public.warehouse_receipts wr on wr.id = cl.receipt_id
  left join active_reservations ar on ar.res_lot_id = cl.id
  where cl.client_id = p_client_id
    and cl.ownership_type = 'CLIENT'
    and cl.lot_category in ('ARRIVAL', 'CLIENT_REJECT', 'ACCEPTED_PROCESSED')
    and cl.quantity_kg > 0
    and cl.status not in ('REVERSED', 'CLOSED', 'DISPATCHED')
  order by cl.created_at desc;
end;
$$;

-- 4. RPC to validate source lot eligibility (STRICT POSITIVE ALLOWLIST)
create or replace function public.validate_processing_source_lot(
  p_lot_id uuid,
  p_client_id uuid,
  p_requested_kg numeric
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot public.coffee_lots;
  v_reserved_kg numeric;
  v_available_kg numeric;
begin
  select * into v_lot from public.coffee_lots where id = p_lot_id;
  if not found then
    raise exception 'Selected source coffee lot does not exist.';
  end if;

  if v_lot.client_id <> p_client_id then
    raise exception 'Source coffee lot does not belong to the selected client.';
  end if;

  if v_lot.ownership_type <> 'CLIENT' then
    raise exception 'Hayked-owned byproduct lots cannot be used as client processing inputs.';
  end if;

  -- STRICT POSITIVE ALLOWLIST: ONLY ARRIVAL, CLIENT_REJECT, ACCEPTED_PROCESSED
  if v_lot.lot_category is null or v_lot.lot_category not in ('ARRIVAL', 'CLIENT_REJECT', 'ACCEPTED_PROCESSED') then
    raise exception 'Ineligible source lot category: %', coalesce(v_lot.lot_category, 'NULL');
  end if;

  if v_lot.status in ('REVERSED', 'CLOSED', 'DISPATCHED') then
    raise exception 'Source lot is % and cannot be processed.', v_lot.status;
  end if;

  select coalesce(sum(reserved_kg), 0) into v_reserved_kg
  from public.stock_reservations
  where lot_id = p_lot_id and status = 'ACTIVE';

  v_available_kg := v_lot.quantity_kg - v_reserved_kg;

  if p_requested_kg <= 0 or p_requested_kg > v_available_kg then
    raise exception 'Requested quantity (%.2f kg) exceeds available stock (%.2f kg).', p_requested_kg, v_available_kg;
  end if;

  return true;
end;
$$;

-- 5. Update complete_processing_order_v2 to assign explicit lot_category to outputs
create or replace function public.complete_processing_order_v2(
  p_order_id uuid,
  p_outputs jsonb,
  p_reconciliation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  processing public.processing_orders;
  request public.processing_requests;
  primary_lot public.coffee_lots;
  output record;
  output_line public.processing_outputs;
  child_lot public.coffee_lots;
  new_lot_number text;
  line_index integer := 0;
  total_accepted numeric := 0;
  total_rejects numeric := 0;
  total_byproduct numeric := 0;
  total_loss numeric := 0;
  total_output numeric := 0;
  completion_number text;
  v_category text;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');

  select * into processing from public.processing_orders where id = p_order_id for update;
  if not found then raise exception 'Processing order not found.'; end if;

  if processing.status = 'POSTED' then
    select completion_number into completion_number from public.processing_orders where id = p_order_id;
    return jsonb_build_object('id', p_order_id, 'completion_number', completion_number, 'already_posted', true);
  end if;

  if processing.status not in ('QUEUED', 'BLOCKED', 'IN_PROCESS') then
    raise exception 'Processing order is in status % and cannot be completed.', processing.status;
  end if;

  select * into request from public.processing_requests where id = processing.request_id;
  select * into primary_lot from public.coffee_lots where id = processing.lot_id;

  completion_number := public.next_erp_number('PROCESSING_ORDER', 'GEL', extract(year from now())::integer);

  -- Process output lines
  for output in select * from jsonb_to_recordset(p_outputs) as x(
    category text, ownerType text, coffeeType text, grade text, preparation text,
    bagCount integer, bagWeightKg numeric, quantityKg numeric, warehouseSection text,
    certifications text[], weighingReference text, evidencePath text, reason text
  )
  loop
    line_index := line_index + 1;
    v_category := output.category;

    if output.category = 'ACCEPTED_CLIENT_COFFEE' then total_accepted := total_accepted + output.quantityKg;
    elsif output.category = 'CLIENT_REJECT' then total_rejects := total_rejects + output.quantityKg;
    elsif output.category = 'HAYKED_BYPRODUCT' then total_byproduct := total_byproduct + output.quantityKg;
    elsif output.category = 'PROCESS_LOSS' then total_loss := total_loss + output.quantityKg;
    end if;
    total_output := total_output + output.quantityKg;

    if output.category <> 'PROCESS_LOSS' then
      new_lot_number := primary_lot.lot_number || '-' || case 
        when output.category = 'ACCEPTED_CLIENT_COFFEE' then 'AC'
        when output.category = 'CLIENT_REJECT' then 'RJ'
        else 'BP'
      end || '-' || line_index::text;

      insert into public.coffee_lots (
        lot_number, warehouse_id, client_id, receipt_id, parent_lot_id, source_processing_order_id,
        coffee_type, ownership_type, lot_category, bag_count, quantity_kg, section, status
      ) values (
        new_lot_number, primary_lot.warehouse_id,
        case when output.category = 'HAYKED_BYPRODUCT' then (select id from public.clients where code = 'CL-HAYKED' limit 1) else primary_lot.client_id end,
        primary_lot.receipt_id, primary_lot.id, p_order_id,
        output.coffeeType, case when output.category = 'HAYKED_BYPRODUCT' then 'HAYKED' else 'CLIENT' end,
        case 
          when output.category = 'ACCEPTED_CLIENT_COFFEE' then 'ACCEPTED_PROCESSED'
          when output.category = 'CLIENT_REJECT' then 'CLIENT_REJECT'
          when output.category = 'HAYKED_BYPRODUCT' then 'HAYKED_BYPRODUCT'
          else 'OTHER'
        end,
        output.bagCount, output.quantityKg, output.warehouseSection, 'PROCESSED'
      ) returning * into child_lot;

      insert into public.stock_movements (
        lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta,
        reference_type, reference_id, posted_by
      ) values (
        child_lot.id, primary_lot.warehouse_id, child_lot.client_id, 'PROCESS_OUTPUT',
        output.quantityKg, output.bagCount, 'PROCESSING_ORDER', p_order_id, (select auth.uid())
      );
    end if;
  end loop;

  -- Verify mass balance tolerance
  if abs(processing.input_kg - total_output) > 0.01 then
    raise exception 'Mass balance mismatch: Input % kg vs Total Outputs % kg exceeds 0.01 kg tolerance.', processing.input_kg, total_output;
  end if;

  -- Create negative movement for input lot
  insert into public.stock_movements (
    lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta,
    reference_type, reference_id, posted_by
  ) values (
    primary_lot.id, primary_lot.warehouse_id, primary_lot.client_id, 'PROCESS_INPUT',
    -processing.input_kg, -primary_lot.bag_count, 'PROCESSING_ORDER', p_order_id, (select auth.uid())
  );

  update public.coffee_lots
  set quantity_kg = greatest(0, quantity_kg - processing.input_kg),
      status = 'PROCESSED'
  where id = primary_lot.id;

  update public.processing_orders
  set status = 'POSTED',
      completion_number = completion_number,
      accepted_client_kg = total_accepted,
      client_reject_kg = total_rejects,
      hayked_byproduct_kg = total_byproduct,
      process_loss_kg = total_loss
  where id = p_order_id;

  perform private.record_audit('PROCESSING_ORDER_COMPLETED', 'PROCESSING_ORDER', p_order_id,
    jsonb_build_object('completion_number', completion_number, 'input_kg', processing.input_kg, 'output_kg', total_output));

  return jsonb_build_object('id', p_order_id, 'completion_number', completion_number, 'posted', true);
end;
$$;

grant execute on function public.list_eligible_processing_lots to authenticated;
grant execute on function public.validate_processing_source_lot to authenticated;
