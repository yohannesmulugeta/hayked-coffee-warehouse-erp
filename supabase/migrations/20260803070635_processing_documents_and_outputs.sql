create table public.processing_request_lines (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.processing_requests(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  lot_id uuid not null references public.coffee_lots(id),
  requested_preparation_type text not null,
  grade text not null,
  requested_bags integer not null check (requested_bags > 0),
  requested_kg numeric(16,3) not null check (requested_kg > 0),
  certifications text[] not null default '{}',
  special_instruction text,
  remark text,
  created_at timestamptz not null default now(),
  unique (request_id, line_number),
  check (certifications <@ array['Organic', 'RFA', 'C.A.F.E', 'Non-certified', 'Fairtrade', 'Other']::text[])
);

create table public.processing_order_inputs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.processing_orders(id) on delete cascade,
  request_line_id uuid references public.processing_request_lines(id),
  lot_id uuid not null references public.coffee_lots(id),
  input_bags integer not null default 0 check (input_bags >= 0),
  input_kg numeric(16,3) not null check (input_kg > 0),
  created_at timestamptz not null default now(),
  unique (order_id, lot_id)
);

create table public.processing_intakes (
  id uuid primary key default gen_random_uuid(),
  intake_number text not null unique,
  order_id uuid not null unique references public.processing_orders(id),
  intake_at timestamptz not null,
  input_bags integer not null check (input_bags > 0),
  input_kg numeric(16,3) not null check (input_kg > 0),
  scale_reference text not null,
  warehouse_issue_reference text not null,
  machine_line text not null,
  shift_name text not null,
  received_by uuid not null references public.profiles(id),
  client_monitor_present boolean not null default false,
  client_monitor_name text,
  intake_condition text not null,
  evidence_path text,
  created_at timestamptz not null default now(),
  check (not client_monitor_present or nullif(btrim(client_monitor_name), '') is not null)
);

create table public.processing_outputs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.processing_orders(id),
  line_number integer not null check (line_number > 0),
  category text not null check (category in ('ACCEPTED_CLIENT_COFFEE', 'CLIENT_REJECT', 'HAYKED_BYPRODUCT', 'REWORK', 'PROCESS_LOSS')),
  owner_type text not null check (owner_type in ('CLIENT', 'HAYKED', 'NONE')),
  coffee_type text check (coffee_type in ('WASHED', 'UNWASHED_UG')),
  grade text,
  preparation text,
  bag_count integer not null default 0 check (bag_count >= 0),
  bag_weight_kg numeric(8,3) check (bag_weight_kg is null or bag_weight_kg > 0),
  quantity_kg numeric(16,3) not null check (quantity_kg > 0),
  warehouse_section text,
  certifications text[] not null default '{}',
  weighing_reference text,
  evidence_path text,
  reason text,
  child_lot_id uuid unique references public.coffee_lots(id),
  created_at timestamptz not null default now(),
  unique (order_id, line_number),
  check (category <> 'PROCESS_LOSS' or (owner_type = 'NONE' and child_lot_id is null and bag_count = 0)),
  check (category = 'PROCESS_LOSS' or (owner_type <> 'NONE' and coffee_type is not null and warehouse_section is not null))
);

alter table public.processing_orders add column completion_number text unique;

insert into public.processing_request_lines (
  request_id, line_number, lot_id, requested_preparation_type, grade,
  requested_bags, requested_kg, certifications, special_instruction, remark
)
select id, 1, lot_id, requested_preparation_type, grade, requested_bags,
  requested_kg, certifications, notes, 'Backfilled from legacy request header'
from public.processing_requests
where lot_id is not null
on conflict (request_id, line_number) do nothing;

insert into public.processing_order_inputs (order_id, request_line_id, lot_id, input_bags, input_kg)
select processing.id, line.id, processing.lot_id,
  coalesce(line.requested_bags, 0), processing.input_kg
from public.processing_orders processing
left join public.processing_request_lines line
  on line.request_id = processing.request_id and line.line_number = 1
on conflict (order_id, lot_id) do nothing;

create unique index stock_movements_processing_input_once_idx
  on public.stock_movements (reference_id, lot_id)
  where reference_type = 'PROCESSING_ORDER' and movement_type = 'PROCESS_INPUT';

alter table public.processing_request_lines enable row level security;
alter table public.processing_order_inputs enable row level security;
alter table public.processing_intakes enable row level security;
alter table public.processing_outputs enable row level security;

create policy staff_read on public.processing_request_lines for select to authenticated
using ((select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'finance_officer', 'auditor', 'viewer')));
create policy staff_read on public.processing_order_inputs for select to authenticated
using ((select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'finance_officer', 'auditor', 'viewer')));
create policy staff_read on public.processing_intakes for select to authenticated
using ((select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'finance_officer', 'auditor', 'viewer')));
create policy staff_read on public.processing_outputs for select to authenticated
using ((select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'finance_officer', 'auditor', 'viewer')));

revoke all on public.processing_request_lines, public.processing_order_inputs, public.processing_intakes, public.processing_outputs from public, anon, authenticated;
grant select on public.processing_request_lines, public.processing_order_inputs, public.processing_intakes, public.processing_outputs to authenticated;

create or replace function public.next_erp_number(
  document_type text,
  warehouse_code text default 'GEL',
  calendar_year integer default extract(year from current_date)::integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization public.organizations;
  warehouse public.warehouses;
  next_value bigint;
  prefix text;
  sequence_scope text;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'finance_officer');
  if document_type not in ('GRN', 'PROCESSING_REQUEST', 'PROCESSING_ORDER', 'PROCESSING_COMPLETION', 'DISPATCH', 'INVOICE', 'PAYMENT', 'DOCUMENT') then
    raise exception 'Unsupported document number type';
  end if;
  if calendar_year < 2000 or calendar_year > 2200 then raise exception 'Invalid document year'; end if;

  select o.* into organization
  from public.organizations o
  join public.profiles p on p.organization_id = o.id
  where p.id = (select auth.uid());
  if not found then raise exception 'User organization not found'; end if;

  select w.* into warehouse
  from public.warehouses w
  where w.organization_id = organization.id and w.code = warehouse_code and w.active;
  if not found then raise exception 'Active warehouse not found'; end if;

  sequence_scope := organization.id || '|' || warehouse.id || '|' || document_type || '|' || calendar_year;
  insert into public.number_sequences (
    scope_key, organization_id, warehouse_id, document_type, calendar_year, last_value
  ) values (
    sequence_scope, organization.id, warehouse.id, document_type, calendar_year, 1
  )
  on conflict (scope_key) do update
    set last_value = public.number_sequences.last_value + 1, updated_at = now()
  returning last_value into next_value;

  prefix := case document_type
    when 'PROCESSING_REQUEST' then 'PR'
    when 'PROCESSING_ORDER' then 'PO'
    when 'PROCESSING_COMPLETION' then 'PC'
    when 'PAYMENT' then 'PAY'
    when 'DOCUMENT' then 'DOC'
    else document_type
  end;
  return prefix || '-' || warehouse.code || '-' || calendar_year || '-' || lpad(next_value::text, 4, '0');
end;
$$;

create or replace function public.create_processing_request(p_header jsonb, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.processing_requests;
  primary_lot public.coffee_lots;
  line jsonb;
  line_lot public.coffee_lots;
  line_number integer := 0;
  requested_bags integer := 0;
  requested_kg numeric := 0;
  request_number text;
  request_year integer;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'At least one processing request line is required'; end if;
  if nullif(btrim(p_header ->> 'noteNumber'), '') is null then raise exception 'External paper note number is required'; end if;
  if nullif(btrim(p_header ->> 'requestDate'), '') is null then raise exception 'Request date is required'; end if;
  if nullif(btrim(p_header ->> 'requester'), '') is null or nullif(btrim(p_header ->> 'approver'), '') is null then raise exception 'Requester and approver are required'; end if;
  if lower(btrim(p_header ->> 'requester')) = lower(btrim(p_header ->> 'approver')) then raise exception 'Approver cannot be the same as requester'; end if;
  request_year := extract(year from (p_header ->> 'requestDate')::date)::integer;
  request_number := public.next_erp_number('PROCESSING_REQUEST', 'GEL', request_year);

  for line in select value from jsonb_array_elements(p_lines)
  loop
    line_number := line_number + 1;
    select * into line_lot from public.coffee_lots where id = (line ->> 'lotId')::uuid for update;
    if not found or line_lot.client_id <> (p_header ->> 'clientId')::uuid then raise exception 'Every source lot must belong to the selected client'; end if;
    if (line ->> 'requestedBags')::integer <= 0 or (line ->> 'requestedKg')::numeric <= 0 then raise exception 'Requested bags and kilograms must be positive'; end if;
    if (line ->> 'requestedKg')::numeric > line_lot.quantity_kg then raise exception 'Requested kilograms exceed a source lot balance'; end if;
    if line_number = 1 then primary_lot := line_lot; end if;
    requested_bags := requested_bags + (line ->> 'requestedBags')::integer;
    requested_kg := requested_kg + (line ->> 'requestedKg')::numeric;
  end loop;

  insert into public.processing_requests (
    request_number, request_note_number, request_date, client_name, client_id,
    lot_reference, warehouse_receipt_id, lot_id, coffee_type, requested_preparation_type,
    grade, requested_bags, requested_kg, certifications, other_certification,
    requester_name, checker_name, approver_name, notes, scanned_document_attached, created_by
  ) values (
    request_number, btrim(p_header ->> 'noteNumber'), (p_header ->> 'requestDate')::date,
    p_header ->> 'clientName', (p_header ->> 'clientId')::uuid,
    primary_lot.lot_number, primary_lot.receipt_id, primary_lot.id, primary_lot.coffee_type,
    p_lines -> 0 ->> 'preparationType', coalesce(p_lines -> 0 ->> 'grade', '-'), requested_bags, requested_kg,
    array(select jsonb_array_elements_text(coalesce(p_header -> 'certifications', '[]'::jsonb))),
    nullif(btrim(p_header ->> 'otherCertification'), ''), p_header ->> 'requester', p_header ->> 'checker',
    p_header ->> 'approver', nullif(btrim(p_header ->> 'notes'), ''),
    coalesce((p_header ->> 'scannedDocumentAttached')::boolean, false), (select auth.uid())
  ) returning * into request;

  line_number := 0;
  for line in select value from jsonb_array_elements(p_lines)
  loop
    line_number := line_number + 1;
    insert into public.processing_request_lines (
      request_id, line_number, lot_id, requested_preparation_type, grade,
      requested_bags, requested_kg, certifications, special_instruction, remark
    ) values (
      request.id, line_number, (line ->> 'lotId')::uuid, line ->> 'preparationType',
      coalesce(line ->> 'grade', '-'), (line ->> 'requestedBags')::integer,
      (line ->> 'requestedKg')::numeric,
      array(select jsonb_array_elements_text(coalesce(line -> 'certifications', '[]'::jsonb))),
      nullif(btrim(line ->> 'specialInstruction'), ''), nullif(btrim(line ->> 'remark'), '')
    );
  end loop;
  perform private.record_audit('PROCESSING_REQUEST_CREATED', 'PROCESSING_REQUEST', request.id,
    jsonb_build_object('request_number', request_number, 'line_count', line_number, 'requested_kg', requested_kg));
  return jsonb_build_object('id', request.id, 'request_number', request_number, 'line_count', line_number);
end;
$$;

create or replace function public.queue_processing_request(request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.processing_requests;
  primary_line public.processing_request_lines;
  new_order public.processing_orders;
  next_position integer;
  order_number text;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  select * into request from public.processing_requests where id = queue_processing_request.request_id for update;
  if not found or request.status <> 'APPROVED' then raise exception 'Only approved requests can enter the queue'; end if;
  if request.queued_order_id is not null then raise exception 'This request is already queued'; end if;
  select * into primary_line from public.processing_request_lines where processing_request_lines.request_id = request.id order by line_number limit 1;
  if not found then raise exception 'The request must contain at least one source line'; end if;
  select coalesce(max(queue_position), 0) + 1 into next_position from public.processing_orders where status in ('QUEUED', 'BLOCKED', 'IN_PROCESS');
  order_number := public.next_erp_number('PROCESSING_ORDER', 'GEL', extract(year from request.request_date)::integer);
  insert into public.processing_orders (
    order_number, request_id, lot_id, client_id, queue_position, input_kg,
    allowance_percent, status, prepared_by
  ) values (
    order_number, request.id, primary_line.lot_id, request.client_id, next_position,
    (select sum(requested_kg) from public.processing_request_lines where processing_request_lines.request_id = request.id),
    case when request.coffee_type = 'WASHED' then 22.5 else 2.5 end, 'QUEUED', request.created_by
  ) returning * into new_order;
  insert into public.processing_order_inputs (order_id, request_line_id, lot_id, input_bags, input_kg)
    select new_order.id, id, lot_id, requested_bags, requested_kg
    from public.processing_request_lines where processing_request_lines.request_id = request.id;
  update public.processing_requests set queued_order_id = new_order.id where id = request.id;
  update public.coffee_lots set status = 'WAITING_PROCESSING'
    where id in (select lot_id from public.processing_order_inputs where order_id = new_order.id);
  perform private.record_audit('PROCESSING_QUEUED', 'PROCESSING_ORDER', new_order.id,
    jsonb_build_object('request_id', request.id, 'order_number', order_number, 'queue_position', next_position));
  return jsonb_build_object('id', new_order.id, 'order_number', order_number, 'queue_position', next_position);
end;
$$;

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
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  select * into processing from public.processing_orders where id = p_order_id for update;
  if not found then raise exception 'Processing order not found'; end if;
  select * into existing_intake from public.processing_intakes where order_id = processing.id;
  if processing.status = 'IN_PROCESS' and found then
    return jsonb_build_object('id', processing.id, 'status', 'IN_PROCESS', 'intake_number', existing_intake.intake_number, 'duplicate', true);
  end if;
  if processing.status <> 'QUEUED' then raise exception 'Only a queued order can start'; end if;
  if nullif(btrim(p_intake ->> 'scaleReference'), '') is null or nullif(btrim(p_intake ->> 'warehouseIssueReference'), '') is null then
    raise exception 'Scale and warehouse issue references are required';
  end if;
  if abs((p_intake ->> 'inputKg')::numeric - processing.input_kg) > 0.01 then raise exception 'Intake kilograms must equal the processing order input'; end if;

  for input in select * from public.processing_order_inputs where order_id = processing.id order by created_at
  loop
    select * into lot from public.coffee_lots where id = input.lot_id for update;
    if lot.quantity_kg < input.input_kg or lot.bag_count < input.input_bags then raise exception 'Insufficient unreserved source-lot stock'; end if;
    insert into public.stock_movements (
      lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta,
      reference_type, reference_id, reason, posted_by
    ) values (
      lot.id, lot.warehouse_id, lot.client_id, 'PROCESS_INPUT', -input.input_kg, -input.input_bags,
      'PROCESSING_ORDER', processing.id, 'Processing intake issued', (select auth.uid())
    );
    update public.coffee_lots set quantity_kg = quantity_kg - input.input_kg,
      bag_count = greatest(0, bag_count - input.input_bags), status = 'IN_PROCESS' where id = lot.id;
  end loop;

  insert into public.processing_intakes (
    intake_number, order_id, intake_at, input_bags, input_kg, scale_reference,
    warehouse_issue_reference, machine_line, shift_name, received_by,
    client_monitor_present, client_monitor_name, intake_condition, evidence_path
  ) values (
    processing.order_number || '-INT', processing.id, (p_intake ->> 'intakeAt')::timestamptz,
    (p_intake ->> 'inputBags')::integer, (p_intake ->> 'inputKg')::numeric,
    p_intake ->> 'scaleReference', p_intake ->> 'warehouseIssueReference',
    p_intake ->> 'machineLine', p_intake ->> 'shiftName', (select auth.uid()),
    coalesce((p_intake ->> 'clientMonitorPresent')::boolean, false),
    nullif(btrim(p_intake ->> 'clientMonitorName'), ''), p_intake ->> 'intakeCondition',
    nullif(btrim(p_intake ->> 'evidencePath'), '')
  ) returning * into intake;
  update public.processing_orders set status = 'IN_PROCESS', started_at = intake.intake_at where id = processing.id;
  perform private.record_audit('PROCESSING_STARTED', 'PROCESSING_ORDER', processing.id,
    jsonb_build_object('input_kg', processing.input_kg, 'intake_number', intake.intake_number));
  return jsonb_build_object('id', processing.id, 'status', 'IN_PROCESS', 'intake_number', intake.intake_number);
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
  processing public.processing_orders;
  parent_lot public.coffee_lots;
  child_lot public.coffee_lots;
  line jsonb;
  line_number integer := 0;
  output_kg numeric := 0;
  accepted_kg numeric := 0;
  reject_kg numeric := 0;
  byproduct_kg numeric := 0;
  rework_kg numeric := 0;
  loss_kg numeric := 0;
  allowance_kg numeric := 0;
  completion_ref text;
  category text;
  owner_type text;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  select * into processing from public.processing_orders where id = p_order_id for update;
  if not found then raise exception 'Processing order not found'; end if;
  if processing.status = 'POSTED' then return jsonb_build_object('id', processing.id, 'status', 'POSTED', 'completion_number', processing.completion_number, 'duplicate', true); end if;
  if processing.status <> 'IN_PROCESS' then raise exception 'Only an active order can be completed'; end if;
  if processing.prepared_by = (select auth.uid()) then raise exception 'The order preparer cannot approve completion'; end if;
  if jsonb_typeof(p_output_lines) <> 'array' or jsonb_array_length(p_output_lines) = 0 then raise exception 'At least one processing output line is required'; end if;

  for line in select value from jsonb_array_elements(p_output_lines)
  loop
    category := line ->> 'category';
    if category not in ('ACCEPTED_CLIENT_COFFEE', 'CLIENT_REJECT', 'HAYKED_BYPRODUCT', 'REWORK', 'PROCESS_LOSS') then raise exception 'Unsupported processing output category'; end if;
    if (line ->> 'quantityKg')::numeric <= 0 then raise exception 'Every processing output quantity must be positive'; end if;
    output_kg := output_kg + (line ->> 'quantityKg')::numeric;
    accepted_kg := accepted_kg + case when category = 'ACCEPTED_CLIENT_COFFEE' then (line ->> 'quantityKg')::numeric else 0 end;
    reject_kg := reject_kg + case when category = 'CLIENT_REJECT' then (line ->> 'quantityKg')::numeric else 0 end;
    byproduct_kg := byproduct_kg + case when category = 'HAYKED_BYPRODUCT' then (line ->> 'quantityKg')::numeric else 0 end;
    rework_kg := rework_kg + case when category = 'REWORK' then (line ->> 'quantityKg')::numeric else 0 end;
    loss_kg := loss_kg + case when category = 'PROCESS_LOSS' then (line ->> 'quantityKg')::numeric else 0 end;
  end loop;
  if abs(processing.input_kg - output_kg) > 0.01 then raise exception 'Processing outputs must reconcile to input within 0.01 kg'; end if;
  if loss_kg > 0 and nullif(btrim(p_loss_reason), '') is null then raise exception 'Process loss requires a reason'; end if;
  allowance_kg := case when processing.allowance_percent = 22.5 then byproduct_kg + loss_kg else loss_kg end;
  if allowance_kg > processing.input_kg * processing.allowance_percent / 100 and (not p_exception_approved or nullif(btrim(p_loss_evidence), '') is null) then
    raise exception 'Above-allowance completion requires independent approval and evidence';
  end if;
  if processing.allowance_percent = 2.5 and byproduct_kg > 0 and (not p_exception_approved or nullif(btrim(p_loss_evidence), '') is null) then
    raise exception 'Unwashed byproduct requires an approved rule and evidence';
  end if;

  select * into parent_lot from public.coffee_lots where id = processing.lot_id;
  completion_ref := public.next_erp_number('PROCESSING_COMPLETION', 'GEL', extract(year from current_date)::integer);
  for line in select value from jsonb_array_elements(p_output_lines)
  loop
    line_number := line_number + 1;
    category := line ->> 'category';
    owner_type := case when category = 'HAYKED_BYPRODUCT' then 'HAYKED' when category = 'PROCESS_LOSS' then 'NONE' else 'CLIENT' end;
    child_lot := null;
    if category <> 'PROCESS_LOSS' then
      insert into public.coffee_lots (
        lot_number, warehouse_id, client_id, parent_lot_id, coffee_type, ownership_type,
        bag_count, quantity_kg, section, status
      ) values (
        completion_ref || '-O' || lpad(line_number::text, 2, '0'), parent_lot.warehouse_id,
        processing.client_id, parent_lot.id,
        coalesce(line ->> 'coffeeType', parent_lot.coffee_type), owner_type,
        coalesce((line ->> 'bagCount')::integer, 0), (line ->> 'quantityKg')::numeric,
        line ->> 'warehouseSection', 'PROCESSED'
      ) returning * into child_lot;
      insert into public.stock_movements (
        lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta,
        reference_type, reference_id, reason, posted_by
      ) values (
        child_lot.id, child_lot.warehouse_id,
        case when owner_type = 'CLIENT' then processing.client_id else null end,
        'PROCESS_OUTPUT', child_lot.quantity_kg, child_lot.bag_count,
        'PROCESSING_ORDER', processing.id, replace(category, '_', ' '), (select auth.uid())
      );
    end if;
    insert into public.processing_outputs (
      order_id, line_number, category, owner_type, coffee_type, grade, preparation,
      bag_count, bag_weight_kg, quantity_kg, warehouse_section, certifications,
      weighing_reference, evidence_path, reason, child_lot_id
    ) values (
      processing.id, line_number, category, owner_type,
      case when category = 'PROCESS_LOSS' then null else coalesce(line ->> 'coffeeType', parent_lot.coffee_type) end,
      nullif(btrim(line ->> 'grade'), ''), nullif(btrim(line ->> 'preparation'), ''),
      case when category = 'PROCESS_LOSS' then 0 else coalesce((line ->> 'bagCount')::integer, 0) end,
      case when category = 'PROCESS_LOSS' then null else nullif(line ->> 'bagWeightKg', '')::numeric end,
      (line ->> 'quantityKg')::numeric,
      case when category = 'PROCESS_LOSS' then null else line ->> 'warehouseSection' end,
      array(select jsonb_array_elements_text(coalesce(line -> 'certifications', '[]'::jsonb))),
      nullif(btrim(line ->> 'weighingReference'), ''), nullif(btrim(line ->> 'evidencePath'), ''),
      case when category = 'PROCESS_LOSS' then p_loss_reason else nullif(btrim(line ->> 'reason'), '') end,
      child_lot.id
    );
  end loop;

  update public.coffee_lots set status = case when quantity_kg <= 0.01 then 'CLOSED' else 'ARRIVAL_IN_STORAGE' end
    where id in (select lot_id from public.processing_order_inputs where order_id = processing.id);
  update public.processing_orders set
    completion_number = completion_ref,
    accepted_client_kg = accepted_kg + rework_kg, client_reject_kg = reject_kg,
    hayked_byproduct_kg = byproduct_kg, process_loss_kg = loss_kg,
    exception_evidence_path = p_loss_evidence, status = 'POSTED',
    approved_by = (select auth.uid()), completed_at = now()
  where id = processing.id;
  perform private.record_audit('PROCESSING_COMPLETED', 'PROCESSING_ORDER', processing.id,
    jsonb_build_object('completion_number', completion_ref, 'accepted_kg', accepted_kg,
      'reject_kg', reject_kg, 'byproduct_kg', byproduct_kg, 'rework_kg', rework_kg,
      'loss_kg', loss_kg, 'output_lines', line_number));
  return jsonb_build_object('id', processing.id, 'status', 'POSTED', 'completion_number', completion_ref, 'output_lines', line_number);
end;
$$;

revoke all on function public.create_processing_request(jsonb, jsonb) from public, anon;
revoke all on function public.start_processing_order_with_intake(uuid, jsonb) from public, anon;
revoke all on function public.complete_processing_order_v2(uuid, jsonb, text, text, boolean) from public, anon;
revoke execute on function public.start_processing_order(uuid) from authenticated;
revoke execute on function public.complete_processing_order(uuid, numeric, numeric, numeric, numeric, text) from authenticated;
grant execute on function public.create_processing_request(jsonb, jsonb) to authenticated;
grant execute on function public.start_processing_order_with_intake(uuid, jsonb) to authenticated;
grant execute on function public.complete_processing_order_v2(uuid, jsonb, text, text, boolean) to authenticated;
