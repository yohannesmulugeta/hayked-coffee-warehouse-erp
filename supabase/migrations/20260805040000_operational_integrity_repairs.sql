-- Forward-only repairs for stock integrity, approval controls, and finance posting.

-- GRN reversal writes REVERSED to its lot, so the lot constraint must permit it.
alter table public.coffee_lots drop constraint if exists coffee_lots_status_check;
alter table public.coffee_lots add constraint coffee_lots_status_check check (
  status in (
    'ARRIVAL_IN_STORAGE', 'WAITING_PROCESSING', 'IN_PROCESS', 'PROCESSED',
    'AWAITING_DISPATCH', 'IN_TRANSIT', 'DISPATCHED', 'CLOSED', 'REVERSED'
  )
);

-- Hayked-owned processing outputs still require a ledger client foreign key.
insert into public.clients (organization_id, code, legal_name, active)
select id, 'CL-HAYKED', 'Hayked General Trading PLC', true
from public.organizations
where code = 'HAYKED'
on conflict (organization_id, code) do update set active = true;

-- Transaction tables are readable by staff but writable only through audited RPCs.
drop policy if exists "Staff access storage_losses" on public.storage_losses;
drop policy if exists "Staff access bag_inventory_movements" on public.bag_inventory_movements;
drop policy if exists "Staff access bag_printing_orders" on public.bag_printing_orders;
drop policy if exists "Staff access generator_usage_requests" on public.generator_usage_requests;
drop policy if exists "Staff access tariff_versions" on public.tariff_versions;
drop policy if exists "Staff access tariff_line_items" on public.tariff_line_items;
drop policy if exists "Staff access storage_billing_runs" on public.storage_billing_runs;
drop policy if exists "Staff access service_events" on public.service_events;
drop policy if exists "Staff access machine_schedules" on public.machine_schedules;

create policy role_read_storage_losses on public.storage_losses for select to authenticated
using ((select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'finance_officer', 'auditor', 'viewer')));
create policy role_read_bag_inventory_movements on public.bag_inventory_movements for select to authenticated
using ((select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'finance_officer', 'auditor', 'viewer')));
create policy role_read_bag_printing_orders on public.bag_printing_orders for select to authenticated
using ((select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'finance_officer', 'auditor', 'viewer')));
create policy role_read_generator_usage_requests on public.generator_usage_requests for select to authenticated
using ((select private.has_role('system_admin', 'warehouse_manager', 'processing_supervisor', 'finance_officer', 'auditor', 'viewer')));
create policy role_read_tariff_versions on public.tariff_versions for select to authenticated
using ((select private.has_role('system_admin', 'warehouse_manager', 'finance_officer', 'auditor', 'viewer')));
create policy role_read_tariff_line_items on public.tariff_line_items for select to authenticated
using ((select private.has_role('system_admin', 'warehouse_manager', 'finance_officer', 'auditor', 'viewer')));
create policy role_read_storage_billing_runs on public.storage_billing_runs for select to authenticated
using ((select private.has_role('system_admin', 'warehouse_manager', 'finance_officer', 'auditor', 'viewer')));
create policy role_read_service_events on public.service_events for select to authenticated
using ((select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'finance_officer', 'auditor', 'viewer')));
create policy role_read_machine_schedules on public.machine_schedules for select to authenticated
using ((select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'auditor', 'viewer')));

revoke insert, update, delete on public.storage_losses, public.bag_inventory_movements,
  public.bag_printing_orders, public.generator_usage_requests, public.tariff_versions,
  public.tariff_line_items, public.storage_billing_runs, public.service_events,
  public.machine_schedules from authenticated;
grant select on public.storage_losses, public.bag_inventory_movements,
  public.bag_printing_orders, public.generator_usage_requests, public.tariff_versions,
  public.tariff_line_items, public.storage_billing_runs, public.service_events,
  public.machine_schedules to authenticated;

-- An imported tariff is never billable until two independent staff verify it.
update public.tariff_versions
set active = false
where verified_by_1 is null or verified_by_2 is null or verified_by_1 = verified_by_2;

create or replace function private.require_independent_profile(
  p_profile_id uuid,
  variadic p_roles text[]
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  if p_profile_id is null or p_profile_id = (select auth.uid()) then
    raise exception 'Independent approval by another active user is required.';
  end if;
  select * into v_profile from public.profiles where id = p_profile_id and active;
  if not found or v_profile.role <> all(p_roles) then
    raise exception 'The selected approver is not active or does not have the required role.';
  end if;
end;
$$;
revoke all on function private.require_independent_profile(uuid, text[]) from public, anon;
grant execute on function private.require_independent_profile(uuid, text[]) to authenticated;

-- The later three-argument overload bypassed intake and output persistence.
drop function if exists public.complete_processing_order_v2(uuid, jsonb, jsonb);

create or replace function public.start_processing_order_with_intake(p_order_id uuid, p_intake jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_processing public.processing_orders;
  v_existing_intake public.processing_intakes;
  v_input public.processing_order_inputs;
  v_lot public.coffee_lots;
  v_intake public.processing_intakes;
  v_reserved_kg numeric;
  v_reserved_bags integer;
  v_total_kg numeric;
  v_total_bags integer;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  if jsonb_typeof(p_intake) <> 'object' then raise exception 'Processing intake is required.'; end if;

  select * into v_processing from public.processing_orders where id = p_order_id for update;
  if not found then raise exception 'Processing order not found.'; end if;
  select * into v_existing_intake from public.processing_intakes where order_id = p_order_id;
  if v_processing.status = 'IN_PROCESS' and found then
    return jsonb_build_object('id', p_order_id, 'status', 'IN_PROCESS', 'intake_number', v_existing_intake.intake_number, 'duplicate', true);
  end if;
  if v_processing.status <> 'QUEUED' then raise exception 'Only a queued order can start.'; end if;
  if v_existing_intake.id is not null then raise exception 'Processing intake already exists for this order.'; end if;

  if nullif(btrim(p_intake ->> 'intakeAt'), '') is null
    or nullif(btrim(p_intake ->> 'scaleReference'), '') is null
    or nullif(btrim(p_intake ->> 'warehouseIssueReference'), '') is null
    or nullif(btrim(p_intake ->> 'machineLine'), '') is null
    or nullif(btrim(p_intake ->> 'shiftName'), '') is null
    or nullif(btrim(p_intake ->> 'intakeCondition'), '') is null then
    raise exception 'Intake date, scale, warehouse issue, machine, shift, and condition are required.';
  end if;

  select coalesce(sum(input_kg), 0), coalesce(sum(input_bags), 0)
  into v_total_kg, v_total_bags
  from public.processing_order_inputs where order_id = p_order_id;
  if v_total_kg <= 0 or v_total_bags <= 0 then raise exception 'Processing order has no valid input lines.'; end if;
  if abs(v_total_kg - v_processing.input_kg) > 0.01
    or abs((p_intake ->> 'inputKg')::numeric - v_total_kg) > 0.01
    or (p_intake ->> 'inputBags')::integer <> v_total_bags then
    raise exception 'Intake bags and kilograms must equal the queued order inputs.';
  end if;

  for v_input in
    select * from public.processing_order_inputs where order_id = p_order_id order by lot_id
  loop
    select * into v_lot from public.coffee_lots where id = v_input.lot_id for update;
    if not found then raise exception 'Source coffee lot % not found.', v_input.lot_id; end if;
    if v_lot.client_id <> v_processing.client_id or v_lot.ownership_type <> 'CLIENT' then
      raise exception 'Every processing source must be client-owned stock for the processing client.';
    end if;
    if v_lot.lot_category is null or v_lot.lot_category not in ('ARRIVAL', 'CLIENT_REJECT', 'ACCEPTED_PROCESSED') then
      raise exception 'Ineligible source lot category: %. Processing input must be ARRIVAL, CLIENT_REJECT, or ACCEPTED_PROCESSED.', coalesce(v_lot.lot_category, 'NULL');
    end if;
    if v_lot.status not in ('ARRIVAL_IN_STORAGE', 'WAITING_PROCESSING', 'PROCESSED', 'AWAITING_DISPATCH') then
      raise exception 'Source lot % is in status % and cannot be processed.', v_lot.lot_number, v_lot.status;
    end if;
    select coalesce(sum(reserved_kg), 0), coalesce(sum(reserved_bags), 0)
    into v_reserved_kg, v_reserved_bags
    from public.stock_reservations where lot_id = v_lot.id and status = 'ACTIVE';
    if v_input.input_kg <= 0 or v_input.input_bags <= 0
      or v_input.input_kg > v_lot.quantity_kg - v_reserved_kg
      or v_input.input_bags > v_lot.bag_count - v_reserved_bags then
      raise exception 'Requested processing input for lot % exceeds unreserved stock.', v_lot.lot_number;
    end if;

    insert into public.stock_movements (
      lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta,
      reference_type, reference_id, reason, posted_by
    ) values (
      v_lot.id, v_lot.warehouse_id, v_lot.client_id, 'PROCESS_INPUT',
      -v_input.input_kg, -v_input.input_bags, 'PROCESSING_ORDER', p_order_id,
      'Processing intake issued', (select auth.uid())
    );
    update public.coffee_lots
    set quantity_kg = quantity_kg - v_input.input_kg,
        bag_count = bag_count - v_input.input_bags,
        status = case when quantity_kg - v_input.input_kg <= 0.01 then 'CLOSED' else 'IN_PROCESS' end
    where id = v_lot.id;
  end loop;

  insert into public.processing_intakes (
    intake_number, order_id, intake_at, input_bags, input_kg, scale_reference,
    warehouse_issue_reference, machine_line, shift_name, received_by,
    client_monitor_present, client_monitor_name, intake_condition, evidence_path
  ) values (
    public.next_erp_number('PROCESSING_INTAKE', 'GEL', extract(year from (p_intake ->> 'intakeAt')::timestamptz)::integer),
    p_order_id, (p_intake ->> 'intakeAt')::timestamptz, v_total_bags, v_total_kg,
    btrim(p_intake ->> 'scaleReference'), btrim(p_intake ->> 'warehouseIssueReference'),
    btrim(p_intake ->> 'machineLine'), btrim(p_intake ->> 'shiftName'), (select auth.uid()),
    coalesce((p_intake ->> 'clientMonitorPresent')::boolean, false),
    nullif(btrim(p_intake ->> 'clientMonitorName'), ''), btrim(p_intake ->> 'intakeCondition'),
    nullif(btrim(p_intake ->> 'evidencePath'), '')
  ) returning * into v_intake;

  update public.processing_orders
  set status = 'IN_PROCESS', started_at = v_intake.intake_at
  where id = p_order_id;
  perform private.record_audit('PROCESSING_STARTED', 'PROCESSING_ORDER', p_order_id,
    jsonb_build_object('intake_number', v_intake.intake_number, 'input_kg', v_total_kg, 'input_bags', v_total_bags));
  return jsonb_build_object('id', p_order_id, 'status', 'IN_PROCESS', 'intake_number', v_intake.intake_number);
end;
$$;

create or replace function public.complete_processing_order_v2(
  p_order_id uuid,
  p_output_lines jsonb,
  p_loss_reason text default null,
  p_loss_evidence text default null,
  p_exception_approved boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_processing public.processing_orders;
  v_parent_lot public.coffee_lots;
  v_child_lot public.coffee_lots;
  v_hayked_client_id uuid;
  v_line jsonb;
  v_line_number integer := 0;
  v_output_kg numeric := 0;
  v_accepted_kg numeric := 0;
  v_reject_kg numeric := 0;
  v_byproduct_kg numeric := 0;
  v_rework_kg numeric := 0;
  v_loss_kg numeric := 0;
  v_allowance_kg numeric;
  v_completion_number text;
  v_category text;
  v_owner_type text;
  v_lot_category text;
  v_requires_exception boolean;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  select * into v_processing from public.processing_orders where id = p_order_id for update;
  if not found then raise exception 'Processing order not found.'; end if;
  if v_processing.status = 'POSTED' then
    return jsonb_build_object('id', p_order_id, 'status', 'POSTED', 'completion_number', v_processing.completion_number, 'duplicate', true);
  end if;
  if v_processing.status <> 'IN_PROCESS' then raise exception 'Only an active order can be completed.'; end if;
  if v_processing.prepared_by = (select auth.uid()) then raise exception 'The order preparer cannot approve completion.'; end if;
  if jsonb_typeof(p_output_lines) <> 'array' or jsonb_array_length(p_output_lines) = 0 then
    raise exception 'At least one processing output line is required.';
  end if;

  for v_line in select value from jsonb_array_elements(p_output_lines)
  loop
    v_category := v_line ->> 'category';
    if v_category not in ('ACCEPTED_CLIENT_COFFEE', 'CLIENT_REJECT', 'HAYKED_BYPRODUCT', 'REWORK', 'PROCESS_LOSS') then
      raise exception 'Unsupported processing output category.';
    end if;
    if nullif(v_line ->> 'quantityKg', '') is null or (v_line ->> 'quantityKg')::numeric <= 0 then
      raise exception 'Every processing output quantity must be positive.';
    end if;
    if v_category = 'PROCESS_LOSS' then
      if nullif(btrim(coalesce(v_line ->> 'reason', p_loss_reason)), '') is null then raise exception 'Process loss requires a reason.'; end if;
    else
      if coalesce((v_line ->> 'bagCount')::integer, 0) <= 0
        or nullif(btrim(v_line ->> 'warehouseSection'), '') is null
        or nullif(btrim(v_line ->> 'weighingReference'), '') is null then
        raise exception 'Every physical output requires positive bags, a warehouse section, and a weighing reference.';
      end if;
      if coalesce(nullif(v_line ->> 'coffeeType', ''), 'INVALID') not in ('WASHED', 'UNWASHED_UG') then
        raise exception 'Every physical output requires a valid coffee type.';
      end if;
    end if;
    v_output_kg := v_output_kg + (v_line ->> 'quantityKg')::numeric;
    v_accepted_kg := v_accepted_kg + case when v_category = 'ACCEPTED_CLIENT_COFFEE' then (v_line ->> 'quantityKg')::numeric else 0 end;
    v_reject_kg := v_reject_kg + case when v_category = 'CLIENT_REJECT' then (v_line ->> 'quantityKg')::numeric else 0 end;
    v_byproduct_kg := v_byproduct_kg + case when v_category = 'HAYKED_BYPRODUCT' then (v_line ->> 'quantityKg')::numeric else 0 end;
    v_rework_kg := v_rework_kg + case when v_category = 'REWORK' then (v_line ->> 'quantityKg')::numeric else 0 end;
    v_loss_kg := v_loss_kg + case when v_category = 'PROCESS_LOSS' then (v_line ->> 'quantityKg')::numeric else 0 end;
  end loop;

  if abs(v_processing.input_kg - v_output_kg) > 0.01 then
    raise exception 'Processing outputs must reconcile to input within 0.01 kg.';
  end if;
  v_allowance_kg := case when v_processing.allowance_percent = 22.5 then v_byproduct_kg + v_loss_kg else v_loss_kg end;
  v_requires_exception := v_allowance_kg > v_processing.input_kg * v_processing.allowance_percent / 100
    or (v_processing.allowance_percent = 2.5 and v_byproduct_kg > 0);
  if v_requires_exception and (
    not p_exception_approved
    or nullif(btrim(p_loss_evidence), '') is null
    or not exists (
      select 1 from public.approvals
      where request_type = 'PROCESSING_EXCEPTION' and reference_id = p_order_id
        and status = 'APPROVED' and requested_by <> decided_by
    )
  ) then
    raise exception 'Above-rule completion requires an approved independent PROCESSING_EXCEPTION record and evidence.';
  end if;

  select * into v_parent_lot from public.coffee_lots where id = v_processing.lot_id;
  if not found then raise exception 'Primary source lot not found.'; end if;
  select id into v_hayked_client_id from public.clients where code = 'CL-HAYKED' and active order by created_at limit 1;
  if v_byproduct_kg > 0 and v_hayked_client_id is null then raise exception 'Hayked internal ownership client is not configured.'; end if;

  v_completion_number := public.next_erp_number('PROCESSING_COMPLETION', 'GEL', extract(year from current_date)::integer);
  for v_line in select value from jsonb_array_elements(p_output_lines)
  loop
    v_line_number := v_line_number + 1;
    v_category := v_line ->> 'category';
    v_owner_type := case when v_category = 'HAYKED_BYPRODUCT' then 'HAYKED' when v_category = 'PROCESS_LOSS' then 'NONE' else 'CLIENT' end;
    v_lot_category := case
      when v_category = 'ACCEPTED_CLIENT_COFFEE' then 'ACCEPTED_PROCESSED'
      when v_category = 'CLIENT_REJECT' then 'CLIENT_REJECT'
      when v_category = 'HAYKED_BYPRODUCT' then 'HAYKED_BYPRODUCT'
      else 'OTHER'
    end;
    v_child_lot := null;
    if v_category <> 'PROCESS_LOSS' then
      insert into public.coffee_lots (
        lot_number, warehouse_id, client_id, receipt_id, parent_lot_id, source_processing_order_id,
        coffee_type, ownership_type, lot_category, bag_count, quantity_kg, section, status
      ) values (
        v_completion_number || '-O' || lpad(v_line_number::text, 2, '0'), v_parent_lot.warehouse_id,
        case when v_owner_type = 'HAYKED' then v_hayked_client_id else v_processing.client_id end,
        v_parent_lot.receipt_id, v_parent_lot.id, p_order_id, v_line ->> 'coffeeType',
        v_owner_type, v_lot_category, (v_line ->> 'bagCount')::integer,
        (v_line ->> 'quantityKg')::numeric, btrim(v_line ->> 'warehouseSection'), 'PROCESSED'
      ) returning * into v_child_lot;
      insert into public.stock_movements (
        lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta,
        reference_type, reference_id, reason, posted_by
      ) values (
        v_child_lot.id, v_child_lot.warehouse_id, v_child_lot.client_id, 'PROCESS_OUTPUT',
        v_child_lot.quantity_kg, v_child_lot.bag_count, 'PROCESSING_ORDER', p_order_id,
        replace(v_category, '_', ' '), (select auth.uid())
      );
    end if;
    insert into public.processing_outputs (
      order_id, line_number, category, owner_type, coffee_type, grade, preparation,
      bag_count, bag_weight_kg, quantity_kg, warehouse_section, certifications,
      weighing_reference, evidence_path, reason, child_lot_id
    ) values (
      p_order_id, v_line_number, v_category, v_owner_type,
      case when v_category = 'PROCESS_LOSS' then null else v_line ->> 'coffeeType' end,
      nullif(btrim(v_line ->> 'grade'), ''), nullif(btrim(v_line ->> 'preparation'), ''),
      case when v_category = 'PROCESS_LOSS' then 0 else (v_line ->> 'bagCount')::integer end,
      case when v_category = 'PROCESS_LOSS' then null else nullif(v_line ->> 'bagWeightKg', '')::numeric end,
      (v_line ->> 'quantityKg')::numeric,
      case when v_category = 'PROCESS_LOSS' then null else btrim(v_line ->> 'warehouseSection') end,
      array(select jsonb_array_elements_text(coalesce(v_line -> 'certifications', '[]'::jsonb))),
      nullif(btrim(v_line ->> 'weighingReference'), ''), nullif(btrim(v_line ->> 'evidencePath'), ''),
      case when v_category = 'PROCESS_LOSS' then coalesce(nullif(btrim(v_line ->> 'reason'), ''), p_loss_reason) else nullif(btrim(v_line ->> 'reason'), '') end,
      v_child_lot.id
    );
  end loop;

  update public.coffee_lots
  set status = case
    when quantity_kg <= 0.01 then 'CLOSED'
    when lot_category = 'ARRIVAL' then 'ARRIVAL_IN_STORAGE'
    else 'PROCESSED'
  end
  where id in (select lot_id from public.processing_order_inputs where order_id = p_order_id);
  update public.processing_orders set
    completion_number = v_completion_number, accepted_client_kg = v_accepted_kg + v_rework_kg,
    client_reject_kg = v_reject_kg, hayked_byproduct_kg = v_byproduct_kg,
    process_loss_kg = v_loss_kg, exception_evidence_path = nullif(btrim(p_loss_evidence), ''),
    status = 'POSTED', approved_by = (select auth.uid()), completed_at = now()
  where id = p_order_id;
  perform private.record_audit('PROCESSING_COMPLETED', 'PROCESSING_ORDER', p_order_id,
    jsonb_build_object('completion_number', v_completion_number, 'output_kg', v_output_kg, 'output_lines', v_line_number));
  return jsonb_build_object('id', p_order_id, 'status', 'POSTED', 'completion_number', v_completion_number, 'output_lines', v_line_number);
end;
$$;

-- Storage loss must lock and decrement the same lot row and write a complete ledger entry.
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
  v_user_id uuid := (select auth.uid());
  v_lot public.coffee_lots;
  v_percent numeric;
  v_loss_id uuid;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer');
  perform private.require_independent_profile(p_manager_approved_by, 'system_admin', 'warehouse_manager');
  select * into v_lot from public.coffee_lots where id = p_lot_id for update;
  if not found then raise exception 'Coffee lot not found.'; end if;
  if v_lot.status in ('CLOSED', 'DISPATCHED', 'REVERSED') then raise exception 'This coffee lot cannot receive a storage loss.'; end if;
  if p_loss_kg <= 0 or p_loss_kg > v_lot.quantity_kg then raise exception 'Loss must be positive and cannot exceed current lot quantity.'; end if;
  if not p_evidence_attached then raise exception 'Measurement evidence must be attached.'; end if;
  v_percent := p_loss_kg / v_lot.quantity_kg * 100;
  if v_percent > 1.5001 then
    perform private.require_independent_profile(p_exception_approved_by, 'system_admin', 'warehouse_manager');
    if p_exception_approved_by = p_manager_approved_by then raise exception 'Exception approval must be independent from manager approval.'; end if;
  end if;
  insert into public.storage_losses (
    lot_id, measured_balance_kg, loss_kg, loss_percent, evidence_attached,
    manager_approved_by, exception_approved_by, wet_coffee_joint_approved, prepared_by
  ) values (
    p_lot_id, v_lot.quantity_kg, p_loss_kg, round(v_percent, 3), true,
    p_manager_approved_by, p_exception_approved_by, p_wet_coffee_joint_approved, v_user_id
  ) returning id into v_loss_id;
  insert into public.stock_movements (
    lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta,
    reference_type, reference_id, reason, posted_by
  ) values (
    v_lot.id, v_lot.warehouse_id, v_lot.client_id, 'STORAGE_LOSS', -p_loss_kg, 0,
    'STORAGE_LOSS', v_loss_id, 'Measured storage loss', v_user_id
  );
  update public.coffee_lots
  set quantity_kg = quantity_kg - p_loss_kg,
      status = case when quantity_kg - p_loss_kg <= 0.01 then 'CLOSED' else status end
  where id = p_lot_id;
  perform private.record_audit('POST_STORAGE_LOSS', 'STORAGE_LOSS', v_loss_id,
    jsonb_build_object('lot_id', p_lot_id, 'loss_kg', p_loss_kg, 'loss_percent', round(v_percent, 3)));
  return v_loss_id;
end;
$$;

alter table public.ecs_transfers
  add column if not exists vehicle_plate text,
  add column if not exists sent_bags integer check (sent_bags is null or sent_bags > 0);

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
  v_user_id uuid := (select auth.uid());
  v_lot public.coffee_lots;
  v_transfer_id uuid;
  v_transfer_number text;
  v_sent_bags integer;
  v_reserved_kg numeric;
  v_reserved_bags integer;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer');
  if not exists (select 1 from public.warehouses where id = p_destination_warehouse_id and active) then
    raise exception 'Active destination warehouse not found.';
  end if;
  select * into v_lot from public.coffee_lots where id = p_lot_id for update;
  if not found then raise exception 'Source coffee lot not found.'; end if;
  if v_lot.warehouse_id = p_destination_warehouse_id then raise exception 'Source and destination warehouses must be different.'; end if;
  if v_lot.status in ('CLOSED', 'DISPATCHED', 'REVERSED', 'IN_TRANSIT') then raise exception 'Source coffee lot is not transferable.'; end if;
  if p_sent_kg <= 0 or p_sent_kg > v_lot.quantity_kg or v_lot.bag_count <= 0 then
    raise exception 'Transfer quantity must be positive and within the source lot balance.';
  end if;
  select coalesce(sum(reserved_kg), 0), coalesce(sum(reserved_bags), 0)
  into v_reserved_kg, v_reserved_bags
  from public.stock_reservations where lot_id = p_lot_id and status = 'ACTIVE';
  v_sent_bags := least(v_lot.bag_count, greatest(1, ceil(v_lot.bag_count * p_sent_kg / v_lot.quantity_kg)::integer));
  if p_sent_kg > v_lot.quantity_kg - v_reserved_kg or v_sent_bags > v_lot.bag_count - v_reserved_bags then
    raise exception 'Transfer quantity exceeds unreserved source stock.';
  end if;
  v_transfer_number := public.next_erp_number('ECS_TRANSFER', 'GEL', extract(year from current_date)::integer);
  insert into public.ecs_transfers (
    transfer_number, lot_id, client_id, source_warehouse_id, destination_warehouse_id,
    sent_kg, sent_bags, vehicle_plate, status, sent_at, prepared_by
  ) values (
    v_transfer_number, p_lot_id, v_lot.client_id, v_lot.warehouse_id, p_destination_warehouse_id,
    p_sent_kg, v_sent_bags, nullif(btrim(p_vehicle_plate), ''), 'IN_TRANSIT', now(), v_user_id
  ) returning id into v_transfer_id;
  insert into public.stock_movements (
    lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta,
    reference_type, reference_id, reason, posted_by
  ) values (
    v_lot.id, v_lot.warehouse_id, v_lot.client_id, 'ECS_SEND', -p_sent_kg, -v_sent_bags,
    'ECS_TRANSFER', v_transfer_id, 'ECS transfer sent', v_user_id
  );
  update public.coffee_lots
  set quantity_kg = quantity_kg - p_sent_kg,
      bag_count = bag_count - v_sent_bags,
      status = case when quantity_kg - p_sent_kg <= 0.01 then 'CLOSED' else status end
  where id = p_lot_id;
  perform private.record_audit('ECS_TRANSFER_SENT', 'ECS_TRANSFER', v_transfer_id,
    jsonb_build_object('lot_id', p_lot_id, 'sent_kg', p_sent_kg, 'sent_bags', v_sent_bags));
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
  v_user_id uuid := (select auth.uid());
  v_transfer public.ecs_transfers;
  v_source_lot public.coffee_lots;
  v_new_lot_id uuid;
  v_variance numeric;
  v_status text;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer');
  select * into v_transfer from public.ecs_transfers where id = p_transfer_id for update;
  if not found then raise exception 'ECS transfer not found.'; end if;
  if v_transfer.status <> 'IN_TRANSIT' then raise exception 'Only an in-transit ECS transfer can be received.'; end if;
  if p_received_kg <= 0 or nullif(btrim(p_destination_section), '') is null then
    raise exception 'Positive received kilograms and destination section are required.';
  end if;
  v_variance := abs(p_received_kg - v_transfer.sent_kg);
  if v_variance > 0.01 then
    perform private.require_independent_profile(p_variance_approved_by, 'system_admin', 'warehouse_manager');
  end if;
  select * into v_source_lot from public.coffee_lots where id = v_transfer.lot_id;
  if not found then raise exception 'ECS source lot not found.'; end if;
  v_status := case when v_source_lot.lot_category = 'ARRIVAL' then 'ARRIVAL_IN_STORAGE' else 'PROCESSED' end;
  insert into public.coffee_lots (
    lot_number, receipt_id, parent_lot_id, client_id, warehouse_id, coffee_type,
    ownership_type, lot_category, bag_count, quantity_kg, section, status
  ) values (
    v_transfer.transfer_number || '-RCV', v_source_lot.receipt_id, v_source_lot.id,
    v_transfer.client_id, v_transfer.destination_warehouse_id, v_source_lot.coffee_type,
    v_source_lot.ownership_type, v_source_lot.lot_category, v_transfer.sent_bags,
    p_received_kg, btrim(p_destination_section), v_status
  ) returning id into v_new_lot_id;
  insert into public.stock_movements (
    lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta,
    reference_type, reference_id, reason, posted_by
  ) values (
    v_new_lot_id, v_transfer.destination_warehouse_id, v_transfer.client_id,
    'ECS_RECEIVE', p_received_kg, v_transfer.sent_bags, 'ECS_TRANSFER', p_transfer_id,
    case when v_variance > 0.01 then 'ECS receipt with approved variance' else 'ECS transfer received' end,
    v_user_id
  );
  update public.ecs_transfers set received_kg = p_received_kg, status = 'RECEIVED',
    received_at = now(), variance_approved_by = p_variance_approved_by
  where id = p_transfer_id;
  perform private.record_audit('ECS_TRANSFER_RECEIVED', 'ECS_TRANSFER', p_transfer_id,
    jsonb_build_object('child_lot_id', v_new_lot_id, 'received_kg', p_received_kg, 'variance_kg', v_variance));
  return v_new_lot_id;
end;
$$;

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
  v_user_id uuid := (select auth.uid());
  v_source_lot public.coffee_lots;
  v_transfer_id uuid;
  v_transfer_number text;
  v_child_lot_id uuid;
  v_bags integer;
  v_reserved_kg numeric;
  v_reserved_bags integer;
  v_child_status text;
begin
  perform private.require_role('system_admin', 'warehouse_manager');
  perform private.require_independent_profile(p_hayked_approved_by, 'system_admin', 'warehouse_manager');
  if nullif(btrim(p_signed_instruction_path), '') is null then raise exception 'Signed ownership instruction is required.'; end if;
  if not exists (select 1 from public.clients where id = p_destination_client_id and active) then raise exception 'Active destination client not found.'; end if;
  select * into v_source_lot from public.coffee_lots where id = p_source_lot_id for update;
  if not found then raise exception 'Source coffee lot not found.'; end if;
  if v_source_lot.client_id = p_destination_client_id then raise exception 'Source and destination clients must be different.'; end if;
  if v_source_lot.ownership_type <> 'CLIENT' or v_source_lot.status in ('CLOSED', 'DISPATCHED', 'REVERSED', 'IN_TRANSIT') then
    raise exception 'Only available client-owned stock can be transferred.';
  end if;
  if p_quantity_kg <= 0 or p_quantity_kg > v_source_lot.quantity_kg or v_source_lot.bag_count <= 0 then
    raise exception 'Transfer quantity must be positive and within source stock.';
  end if;
  select coalesce(sum(reserved_kg), 0), coalesce(sum(reserved_bags), 0)
  into v_reserved_kg, v_reserved_bags
  from public.stock_reservations where lot_id = p_source_lot_id and status = 'ACTIVE';
  v_bags := least(v_source_lot.bag_count, greatest(1, ceil(v_source_lot.bag_count * p_quantity_kg / v_source_lot.quantity_kg)::integer));
  if p_quantity_kg > v_source_lot.quantity_kg - v_reserved_kg or v_bags > v_source_lot.bag_count - v_reserved_bags then
    raise exception 'Ownership transfer exceeds unreserved source stock.';
  end if;
  v_transfer_number := public.next_erp_number('OWNERSHIP_TRANSFER', 'GEL', extract(year from current_date)::integer);
  v_child_status := case when v_source_lot.lot_category = 'ARRIVAL' then 'ARRIVAL_IN_STORAGE' else 'PROCESSED' end;
  insert into public.coffee_lots (
    lot_number, receipt_id, parent_lot_id, client_id, warehouse_id, coffee_type,
    ownership_type, lot_category, bag_count, quantity_kg, section, status
  ) values (
    v_transfer_number || '-LOT', v_source_lot.receipt_id, v_source_lot.id,
    p_destination_client_id, v_source_lot.warehouse_id, v_source_lot.coffee_type,
    'CLIENT', v_source_lot.lot_category, v_bags, p_quantity_kg, v_source_lot.section, v_child_status
  ) returning id into v_child_lot_id;
  insert into public.ownership_transfers (
    transfer_number, source_lot_id, child_lot_id, source_client_id, destination_client_id,
    quantity_kg, signed_instruction_path, source_approved_at, destination_accepted_at,
    hayked_approved_by, status, posted_at
  ) values (
    v_transfer_number, p_source_lot_id, v_child_lot_id, v_source_lot.client_id,
    p_destination_client_id, p_quantity_kg, btrim(p_signed_instruction_path), now(), now(),
    p_hayked_approved_by, 'POSTED', now()
  ) returning id into v_transfer_id;
  insert into public.stock_movements (
    lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta,
    reference_type, reference_id, reason, posted_by
  ) values
    (p_source_lot_id, v_source_lot.warehouse_id, v_source_lot.client_id,
      'OWNERSHIP_OUT', -p_quantity_kg, -v_bags, 'OWNERSHIP_TRANSFER', v_transfer_id,
      'Ownership transferred out', v_user_id),
    (v_child_lot_id, v_source_lot.warehouse_id, p_destination_client_id,
      'OWNERSHIP_IN', p_quantity_kg, v_bags, 'OWNERSHIP_TRANSFER', v_transfer_id,
      'Ownership transferred in', v_user_id);
  update public.coffee_lots
  set quantity_kg = quantity_kg - p_quantity_kg,
      bag_count = bag_count - v_bags,
      status = case when quantity_kg - p_quantity_kg <= 0.01 then 'CLOSED' else status end
  where id = p_source_lot_id;
  perform private.record_audit('OWNERSHIP_TRANSFER_POSTED', 'OWNERSHIP_TRANSFER', v_transfer_id,
    jsonb_build_object('source_lot_id', p_source_lot_id, 'child_lot_id', v_child_lot_id, 'quantity_kg', p_quantity_kg));
  return v_transfer_id;
end;
$$;

-- Payment allocation is serialized per invoice and cannot exceed the balance.
create or replace function public.record_invoice_payment(
  invoice_id uuid,
  amount_etb numeric,
  bank_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_payment public.payments;
  v_paid_total numeric;
  v_reference text := nullif(btrim(bank_reference), '');
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'finance_officer');
  select * into v_invoice from public.invoices where id = invoice_id for update;
  if not found or v_invoice.status not in ('ISSUED', 'PARTIALLY_PAID') then raise exception 'Only an open issued invoice can receive payment.'; end if;
  if amount_etb <= 0 or v_reference is null then raise exception 'A positive amount and bank reference are required.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_invoice.client_id::text || '|' || lower(v_reference), 0));
  if exists (select 1 from public.payments p where p.client_id = v_invoice.client_id and lower(p.bank_reference) = lower(v_reference) and p.direction = 'PAYMENT') then
    raise exception 'This bank reference has already been recorded for the client.';
  end if;
  select coalesce(sum(case when direction = 'PAYMENT' then amount_etb else -amount_etb end), 0)
  into v_paid_total from public.payments where payments.invoice_id = v_invoice.id;
  if amount_etb > v_invoice.total_etb - v_paid_total then raise exception 'Payment exceeds the outstanding invoice balance.'; end if;
  insert into public.payments (payment_number, invoice_id, client_id, amount_etb, paid_at, bank_reference, recorded_by)
  values ('PAY-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'), v_invoice.id, v_invoice.client_id,
    amount_etb, now(), v_reference, (select auth.uid())) returning * into v_payment;
  v_paid_total := v_paid_total + amount_etb;
  update public.invoices
  set status = case when v_paid_total = total_etb then 'PAID' else 'PARTIALLY_PAID' end
  where id = v_invoice.id;
  perform private.record_audit('PAYMENT_RECORDED', 'INVOICE', v_invoice.id,
    jsonb_build_object('payment_id', v_payment.id, 'amount_etb', amount_etb, 'bank_reference', v_reference));
  return jsonb_build_object('id', v_payment.id, 'payment_number', v_payment.payment_number,
    'invoice_status', case when v_paid_total = v_invoice.total_etb then 'PAID' else 'PARTIALLY_PAID' end);
end;
$$;

create or replace function public.export_accounting_general_ledger(p_start_date date, p_end_date date)
returns table (
  account_code text,
  account_name text,
  debit_etb numeric(16,2),
  credit_etb numeric(16,2),
  entry_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role('system_admin', 'finance_officer');
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then raise exception 'A valid ledger date range is required.'; end if;
  return query
  with invoice_summary as (
    select coalesce(sum(i.total_etb), 0)::numeric(16,2) total_receivable,
      coalesce(sum(i.subtotal_etb), 0)::numeric(16,2) total_revenue,
      coalesce(sum(i.tax_etb), 0)::numeric(16,2) total_tax,
      count(*)::integer inv_count
    from public.invoices i
    where i.status in ('ISSUED', 'PARTIALLY_PAID', 'PAID') and i.issued_on between p_start_date and p_end_date
  ), payment_summary as (
    select coalesce(sum(case when p.direction = 'PAYMENT' then p.amount_etb else -p.amount_etb end), 0)::numeric(16,2) total_cash,
      count(*)::integer pay_count
    from public.payments p where p.paid_at::date between p_start_date and p_end_date
  )
  select '1100'::text, 'Accounts Receivable'::text, i.total_receivable, 0::numeric(16,2), i.inv_count from invoice_summary i
  union all select '4000', 'Warehouse Service Revenue', 0::numeric(16,2), i.total_revenue, i.inv_count from invoice_summary i
  union all select '2200', 'VAT / Tax Payable', 0::numeric(16,2), i.total_tax, i.inv_count from invoice_summary i
  union all select '1010', 'Bank / Cash Operations', p.total_cash, 0::numeric(16,2), p.pay_count from payment_summary p
  union all select '1100', 'Accounts Receivable (Settlements)', 0::numeric(16,2), p.total_cash, p.pay_count from payment_summary p;
end;
$$;

alter table public.dispatch_orders drop constraint if exists dispatch_orders_status_check;
alter table public.dispatch_orders add constraint dispatch_orders_status_check
check (status in ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'POSTED', 'REVERSED', 'CANCELLED'));

create or replace function public.create_dispatch_draft(p_header jsonb, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dispatch public.dispatch_orders;
  v_client public.clients;
  v_representative public.authorized_representatives;
  v_lot public.coffee_lots;
  v_line jsonb;
  v_line_no integer := 0;
  v_total_bags integer := 0;
  v_total_kg numeric := 0;
  v_reserved_bags integer;
  v_reserved_kg numeric;
  v_first_lot_id uuid;
  v_seen_lots uuid[] := array[]::uuid[];
  v_invoices_clear boolean;
  v_dispatch_number text;
  v_dispatch_date date;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer');
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'At least one dispatch line is required.'; end if;
  v_dispatch_date := (p_header ->> 'dispatchDate')::date;
  if v_dispatch_date is null then raise exception 'Dispatch date is required.'; end if;
  select * into v_client from public.clients where id = (p_header ->> 'clientId')::uuid and active;
  if not found then raise exception 'Active client not found.'; end if;
  select * into v_representative from public.authorized_representatives
  where id = (p_header ->> 'representativeId')::uuid and client_id = v_client.id and active
    and v_dispatch_date >= valid_from and (valid_to is null or v_dispatch_date <= valid_to);
  if not found then raise exception 'A representative valid on the dispatch date is required.'; end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_line_no := v_line_no + 1;
    if (v_line ->> 'lotId')::uuid = any(v_seen_lots) then raise exception 'A dispatch lot can only appear once.'; end if;
    v_seen_lots := array_append(v_seen_lots, (v_line ->> 'lotId')::uuid);
    select * into v_lot from public.coffee_lots where id = (v_line ->> 'lotId')::uuid for update;
    if not found or v_lot.client_id <> v_client.id or v_lot.ownership_type <> 'CLIENT'
      or v_lot.status in ('CLOSED', 'DISPATCHED', 'REVERSED', 'IN_PROCESS', 'IN_TRANSIT') then
      raise exception 'Every dispatch lot must be available client-owned stock.';
    end if;
    if (v_line ->> 'bagCount')::integer <= 0 or (v_line ->> 'quantityKg')::numeric <= 0 then
      raise exception 'Dispatch bags and kilograms must be positive.';
    end if;
    select coalesce(sum(reserved_bags), 0), coalesce(sum(reserved_kg), 0)
    into v_reserved_bags, v_reserved_kg
    from public.stock_reservations where lot_id = v_lot.id and status = 'ACTIVE';
    if v_lot.bag_count - v_reserved_bags < (v_line ->> 'bagCount')::integer
      or v_lot.quantity_kg - v_reserved_kg < (v_line ->> 'quantityKg')::numeric then
      raise exception 'Requested dispatch quantity exceeds unreserved stock.';
    end if;
    if v_line_no = 1 then v_first_lot_id := v_lot.id; end if;
    v_total_bags := v_total_bags + (v_line ->> 'bagCount')::integer;
    v_total_kg := v_total_kg + (v_line ->> 'quantityKg')::numeric;
  end loop;

  select not exists (
    select 1 from public.invoices
    where client_id = v_client.id and status in ('ISSUED', 'PARTIALLY_PAID')
  ) into v_invoices_clear;
  v_dispatch_number := replace(public.next_erp_number('DISPATCH', 'GEL', extract(year from v_dispatch_date)::integer), 'DISPATCH-', 'DSP-');
  insert into public.dispatch_orders (
    dispatch_number, lot_id, client_id, representative_id, quantity_kg, bag_count,
    invoices_paid, documents_ready, weighbridge_ready, legal_or_quality_hold,
    status, prepared_by, dispatch_date, dispatch_reason, destination,
    documents_reference, weighbridge_reference, notes
  ) values (
    v_dispatch_number, v_first_lot_id, v_client.id, v_representative.id, v_total_kg, v_total_bags,
    v_invoices_clear, nullif(btrim(p_header ->> 'documentsReference'), '') is not null,
    nullif(btrim(p_header ->> 'weighbridgeReference'), '') is not null, false,
    'DRAFT', (select auth.uid()), v_dispatch_date, coalesce(nullif(btrim(p_header ->> 'reason'), ''), 'Export'),
    nullif(btrim(p_header ->> 'destination'), ''), nullif(btrim(p_header ->> 'documentsReference'), ''),
    nullif(btrim(p_header ->> 'weighbridgeReference'), ''), nullif(btrim(p_header ->> 'notes'), '')
  ) returning * into v_dispatch;

  v_line_no := 0;
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_line_no := v_line_no + 1;
    insert into public.dispatch_lines (dispatch_id, line_number, lot_id, bag_count, quantity_kg)
    values (v_dispatch.id, v_line_no, (v_line ->> 'lotId')::uuid,
      (v_line ->> 'bagCount')::integer, (v_line ->> 'quantityKg')::numeric);
    insert into public.stock_reservations (dispatch_id, lot_id, reserved_bags, reserved_kg, created_by)
    values (v_dispatch.id, (v_line ->> 'lotId')::uuid,
      (v_line ->> 'bagCount')::integer, (v_line ->> 'quantityKg')::numeric, (select auth.uid()));
  end loop;
  if coalesce((p_header ->> 'creditAmount')::numeric, 0) > 0 then
    if nullif(btrim(p_header ->> 'creditReason'), '') is null
      or nullif(btrim(p_header ->> 'creditDocumentReference'), '') is null
      or (p_header ->> 'creditExpiry')::date < current_date then
      raise exception 'Credit override requires a future expiry, reason, and document reference.';
    end if;
    insert into public.credit_overrides (dispatch_id, amount_etb, expires_on, reason, document_reference, requested_by)
    values (v_dispatch.id, (p_header ->> 'creditAmount')::numeric, (p_header ->> 'creditExpiry')::date,
      btrim(p_header ->> 'creditReason'), btrim(p_header ->> 'creditDocumentReference'), (select auth.uid()));
  end if;
  perform private.record_audit('DISPATCH_DRAFT_CREATED', 'DISPATCH_ORDER', v_dispatch.id,
    jsonb_build_object('dispatch_number', v_dispatch_number, 'line_count', v_line_no, 'quantity_kg', v_total_kg));
  return jsonb_build_object('id', v_dispatch.id, 'dispatch_number', v_dispatch_number);
end;
$$;

create or replace function public.approve_dispatch(p_dispatch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dispatch public.dispatch_orders;
  v_line_count integer;
  v_reservation_count integer;
  v_invoices_clear boolean;
  v_credit_clear boolean;
begin
  perform private.require_role('system_admin', 'warehouse_manager');
  select * into v_dispatch from public.dispatch_orders where id = p_dispatch_id for update;
  if not found or v_dispatch.status <> 'AWAITING_APPROVAL' then raise exception 'Only a submitted dispatch can be approved.'; end if;
  if v_dispatch.prepared_by = (select auth.uid()) then raise exception 'The dispatch preparer cannot approve it.'; end if;
  if not exists (
    select 1 from public.agreements where client_id = v_dispatch.client_id and status = 'ACTIVE'
      and v_dispatch.dispatch_date >= effective_from
      and (effective_to is null or v_dispatch.dispatch_date <= effective_to)
  ) then raise exception 'An active agreement is required.'; end if;
  if not exists (
    select 1 from public.authorized_representatives
    where id = v_dispatch.representative_id and client_id = v_dispatch.client_id and active
      and v_dispatch.dispatch_date >= valid_from
      and (valid_to is null or v_dispatch.dispatch_date <= valid_to)
  ) then raise exception 'The selected representative is not valid for the dispatch date.'; end if;
  select count(*) into v_line_count from public.dispatch_lines where dispatch_id = p_dispatch_id;
  select count(*) into v_reservation_count from public.stock_reservations where dispatch_id = p_dispatch_id and status = 'ACTIVE';
  if v_line_count = 0 or v_reservation_count <> v_line_count then raise exception 'Every dispatch line requires an active reservation.'; end if;
  select not exists (
    select 1 from public.invoices where client_id = v_dispatch.client_id and status in ('ISSUED', 'PARTIALLY_PAID')
  ) into v_invoices_clear;
  select exists (
    select 1 from public.credit_overrides where dispatch_id = p_dispatch_id
      and status = 'APPROVED' and expires_on >= v_dispatch.dispatch_date
  ) into v_credit_clear;
  if not (v_invoices_clear or v_credit_clear) then raise exception 'Paid invoices or an unexpired approved credit override are required.'; end if;
  if not v_dispatch.documents_ready or nullif(btrim(v_dispatch.documents_reference), '') is null then raise exception 'Document references are incomplete.'; end if;
  if not v_dispatch.weighbridge_ready or nullif(btrim(v_dispatch.weighbridge_reference), '') is null then raise exception 'Weighbridge reference is incomplete.'; end if;
  if v_dispatch.legal_or_quality_hold then raise exception 'A legal or quality hold blocks release.'; end if;
  update public.dispatch_orders set status = 'APPROVED', approved_by = (select auth.uid()),
    invoices_paid = v_invoices_clear, credit_approved = v_credit_clear
  where id = p_dispatch_id;
  perform private.record_audit('DISPATCH_APPROVED', 'DISPATCH_ORDER', p_dispatch_id,
    jsonb_build_object('reservations', v_reservation_count, 'invoice_clear', v_invoices_clear, 'credit_clear', v_credit_clear));
  return jsonb_build_object('id', p_dispatch_id, 'status', 'APPROVED');
end;
$$;

create or replace function public.cancel_dispatch(p_dispatch_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dispatch public.dispatch_orders;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer');
  if nullif(btrim(p_reason), '') is null then raise exception 'Cancellation reason is required.'; end if;
  select * into v_dispatch from public.dispatch_orders where id = p_dispatch_id for update;
  if not found or v_dispatch.status not in ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED') then
    raise exception 'Only an unposted dispatch can be cancelled.';
  end if;
  update public.stock_reservations set status = 'RELEASED', released_at = now()
  where dispatch_id = p_dispatch_id and status = 'ACTIVE';
  update public.dispatch_orders set status = 'CANCELLED', notes = concat_ws(E'\n', notes, 'Cancelled: ' || btrim(p_reason))
  where id = p_dispatch_id;
  perform private.record_audit('DISPATCH_CANCELLED', 'DISPATCH_ORDER', p_dispatch_id,
    jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object('id', p_dispatch_id, 'status', 'CANCELLED');
end;
$$;

revoke all on function public.start_processing_order_with_intake(uuid, jsonb),
  public.complete_processing_order_v2(uuid, jsonb, text, text, boolean),
  public.post_storage_loss(uuid, numeric, boolean, uuid, uuid, boolean),
  public.post_ecs_transfer(uuid, uuid, numeric, text),
  public.receive_ecs_transfer(uuid, numeric, text, uuid),
  public.post_ownership_transfer(uuid, uuid, numeric, text, uuid),
  public.record_invoice_payment(uuid, numeric, text),
  public.export_accounting_general_ledger(date, date),
  public.create_dispatch_draft(jsonb, jsonb), public.approve_dispatch(uuid),
  public.cancel_dispatch(uuid, text) from public, anon;
grant execute on function public.start_processing_order_with_intake(uuid, jsonb),
  public.complete_processing_order_v2(uuid, jsonb, text, text, boolean),
  public.post_storage_loss(uuid, numeric, boolean, uuid, uuid, boolean),
  public.post_ecs_transfer(uuid, uuid, numeric, text),
  public.receive_ecs_transfer(uuid, numeric, text, uuid),
  public.post_ownership_transfer(uuid, uuid, numeric, text, uuid),
  public.record_invoice_payment(uuid, numeric, text),
  public.export_accounting_general_ledger(date, date),
  public.create_dispatch_draft(jsonb, jsonb), public.approve_dispatch(uuid),
  public.cancel_dispatch(uuid, text) to authenticated;
