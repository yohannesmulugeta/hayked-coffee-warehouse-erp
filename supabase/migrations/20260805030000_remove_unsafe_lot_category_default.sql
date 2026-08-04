-- Migration: 20260805030000_remove_unsafe_lot_category_default.sql
-- Purpose: Remove unsafe lot_category default, enforce explicit category assignment on all lot creation RPCs,
-- and embed strict positive allowlisting directly inside the authoritative processing-start database transaction.

-- 1. Remove unsafe default from coffee_lots
alter table public.coffee_lots
  alter column lot_category drop default;

-- 2. Update transition_grn RPC to explicitly assign 'ARRIVAL' category when posting a GRN
create or replace function public.transition_grn(
  receipt_id uuid,
  target_status text,
  lot_number text default null,
  reversal_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  receipt public.warehouse_receipts;
  lot public.coffee_lots;
  original_movement public.stock_movements;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer');
  select * into receipt from public.warehouse_receipts where id = receipt_id for update;
  if not found then raise exception 'Warehouse receipt not found'; end if;

  if receipt.status = 'DRAFT' and target_status = 'SUBMITTED' then
    update public.warehouse_receipts set status = 'SUBMITTED' where id = receipt_id;
  elsif receipt.status = 'SUBMITTED' and target_status = 'APPROVED' then
    perform private.require_role('system_admin', 'warehouse_manager');
    if receipt.prepared_by = (select auth.uid()) then raise exception 'The preparer cannot approve the same GRN'; end if;
    update public.warehouse_receipts set status = 'APPROVED', approved_by = (select auth.uid()) where id = receipt_id;
  elsif receipt.status = 'APPROVED' and target_status = 'POSTED' then
    if nullif(btrim(lot_number), '') is null then raise exception 'Lot number is required for posting'; end if;

    -- Explicit assignment of 'ARRIVAL' category upon GRN posting
    insert into public.coffee_lots (
      lot_number, warehouse_id, client_id, receipt_id, coffee_type, ownership_type, lot_category, bag_count, quantity_kg, section, status
    ) values (
      lot_number, receipt.warehouse_id, receipt.client_id, receipt.id, receipt.coffee_type, 'CLIENT', 'ARRIVAL',
      receipt.bag_count, receipt.net_weight_kg, receipt.section, 'ARRIVAL_IN_STORAGE'
    ) returning * into lot;

    insert into public.stock_movements (
      lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta,
      reference_type, reference_id, reason, posted_by
    ) values (
      lot.id, receipt.warehouse_id, receipt.client_id, 'RECEIPT', receipt.net_weight_kg,
      receipt.bag_count, 'WAREHOUSE_RECEIPT', receipt.id, 'GRN posted', (select auth.uid())
    );
    update public.warehouse_receipts set status = 'POSTED', posted_at = now() where id = receipt_id;
  elsif receipt.status = 'POSTED' and target_status = 'REVERSED' then
    perform private.require_role('system_admin', 'warehouse_manager');
    if nullif(btrim(reversal_reason), '') is null then raise exception 'A reversal reason is required'; end if;
    select l.* into lot from public.coffee_lots l where l.receipt_id = receipt.id for update;
    select m.* into original_movement from public.stock_movements m
      where m.reference_type = 'WAREHOUSE_RECEIPT' and m.reference_id = receipt.id and m.movement_type = 'RECEIPT';
    if lot.id is null or original_movement.id is null then raise exception 'Posted GRN ledger records are missing'; end if;
    if (select count(*) from public.stock_movements m where m.lot_id = lot.id) <> 1 then
      raise exception 'This GRN has downstream stock activity and cannot be reversed directly';
    end if;
    insert into public.stock_movements (
      lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta,
      reference_type, reference_id, reverses_movement_id, reason, posted_by
    ) values (
      lot.id, lot.warehouse_id, lot.client_id, 'REVERSAL', -original_movement.quantity_kg,
      -original_movement.bag_delta, 'WAREHOUSE_RECEIPT', receipt.id, original_movement.id,
      reversal_reason, (select auth.uid())
    );
    update public.coffee_lots set bag_count = 0, quantity_kg = 0, status = 'REVERSED' where id = lot.id;
    update public.warehouse_receipts set status = 'REVERSED' where id = receipt.id;
  else
    raise exception 'Invalid status transition from % to %', receipt.status, target_status;
  end if;

  perform private.record_audit('GRN_TRANSITION', 'WAREHOUSE_RECEIPT', receipt.id,
    jsonb_build_object('target_status', target_status, 'lot_number', lot_number));
  return jsonb_build_object('id', receipt.id, 'status', target_status, 'lot_number', lot_number);
end;
$$;

-- 3. Update processing-start transaction to enforce strict positive allowlist inside database row lock
create or replace function public.start_processing_order_with_intake(p_order_id uuid, p_intake jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  processing public.processing_orders;
  existing_intake public.processing_intakes;
  input public.processing_order_inputs;
  lot public.coffee_lots;
  intake public.processing_intakes;
  v_reserved_kg numeric := 0;
  v_available_kg numeric := 0;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');

  -- 1. Lock the processing order
  select * into processing from public.processing_orders where id = p_order_id for update;
  if not found then raise exception 'Processing order not found.'; end if;

  if processing.status = 'IN_PROCESS' then
    select * into intake from public.processing_intakes where order_id = p_order_id;
    return jsonb_build_object('id', p_order_id, 'intake_number', intake.intake_number, 'already_started', true);
  end if;

  if processing.status <> 'QUEUED' then
    raise exception 'Processing order is in status % and cannot be started.', processing.status;
  end if;

  -- 2. Lock each source lot row and enforce strict positive allowlisting
  for input in select * from public.processing_order_inputs where order_id = p_order_id for update
  loop
    select * into lot from public.coffee_lots where id = input.lot_id for update;
    if not found then
      raise exception 'Source coffee lot % not found.', input.lot_id;
    end if;

    -- Confirm client ownership
    if lot.client_id <> processing.client_id then
      raise exception 'Source coffee lot % does not belong to the processing client.', lot.lot_number;
    end if;

    if lot.ownership_type <> 'CLIENT' then
      raise exception 'Hayked-owned byproduct lots cannot be used as processing inputs.';
    end if;

    -- STRICT POSITIVE ALLOWLIST: ONLY ARRIVAL, CLIENT_REJECT, ACCEPTED_PROCESSED
    if lot.lot_category is null or lot.lot_category not in ('ARRIVAL', 'CLIENT_REJECT', 'ACCEPTED_PROCESSED') then
      raise exception 'Ineligible source lot category: %. Processing input must be ARRIVAL, CLIENT_REJECT, or ACCEPTED_PROCESSED.', coalesce(lot.lot_category, 'NULL');
    end if;

    -- Confirm operational availability
    if lot.status in ('REVERSED', 'CLOSED', 'DISPATCHED') then
      raise exception 'Source lot % is in status % and cannot be processed.', lot.lot_number, lot.status;
    end if;

    -- Calculate active reservations and available stock
    select coalesce(sum(reserved_kg), 0) into v_reserved_kg
    from public.stock_reservations
    where lot_id = lot.id and status = 'ACTIVE';

    v_available_kg := lot.quantity_kg - v_reserved_kg;

    if input.input_kg <= 0 or input.input_kg > v_available_kg then
      raise exception 'Requested input (%.2f kg) for lot % exceeds available balance (%.2f kg).', input.input_kg, lot.lot_number, v_available_kg;
    end if;
  end loop;

  -- Insert intake record
  insert into public.processing_intakes (
    intake_number, order_id, intake_at, input_bags, input_kg, scale_reference,
    warehouse_issue_reference, machine_line, shift_name, received_by, client_monitor_present,
    client_monitor_name, intake_condition, evidence_path
  ) values (
    public.next_erp_number('PROCESSING_INTAKE', 'GEL', extract(year from now())::integer),
    p_order_id, (p_intake ->> 'intakeAt')::timestamptz, (p_intake ->> 'inputBags')::integer,
    (p_intake ->> 'inputKg')::numeric, p_intake ->> 'scaleReference',
    p_intake ->> 'warehouseIssueReference', p_intake ->> 'machineLine', p_intake ->> 'shiftName',
    (select auth.uid()), coalesce((p_intake ->> 'clientMonitorPresent')::boolean, false),
    nullif(btrim(p_intake ->> 'clientMonitorName'), ''), p_intake ->> 'intakeCondition',
    nullif(btrim(p_intake ->> 'evidencePath'), '')
  ) returning * into intake;

  -- Create single PROCESS_INPUT stock movement per input lot
  for input in select * from public.processing_order_inputs where order_id = p_order_id
  loop
    select * into lot from public.coffee_lots where id = input.lot_id;
    insert into public.stock_movements (
      lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta,
      reference_type, reference_id, posted_by
    ) values (
      input.lot_id, lot.warehouse_id, processing.client_id, 'PROCESS_INPUT',
      -input.input_kg, -input.input_bags, 'PROCESSING_ORDER', p_order_id, (select auth.uid())
    );
    update public.coffee_lots set status = 'IN_PROCESS' where id = input.lot_id;
  end loop;

  update public.processing_orders set status = 'IN_PROCESS', started_at = now() where id = p_order_id;

  perform private.record_audit('PROCESSING_STARTED', 'PROCESSING_ORDER', p_order_id,
    jsonb_build_object('intake_number', intake.intake_number, 'input_kg', processing.input_kg));

  return jsonb_build_object('id', p_order_id, 'intake_number', intake.intake_number, 'started', true);
end;
$$;
