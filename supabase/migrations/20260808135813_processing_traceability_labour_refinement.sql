-- Multi-source processing, full output lineage, shared stock reservations, and
-- warehouse labour cost/client charge separation for the local demo.

-- Generalize the existing dispatch reservation ledger instead of creating a
-- second availability calculation for processing.
alter table public.stock_reservations
  alter column dispatch_id drop not null,
  add column processing_order_id uuid references public.processing_orders(id) on delete cascade;

alter table public.stock_reservations
  add constraint stock_reservations_one_owner_check
  check (num_nonnulls(dispatch_id, processing_order_id) = 1);

create unique index stock_reservations_processing_order_lot_idx
  on public.stock_reservations (processing_order_id, lot_id)
  where processing_order_id is not null;

create index stock_reservations_active_lot_idx
  on public.stock_reservations (lot_id, status)
  where status = 'ACTIVE';

-- Every processing output is related to every contributing order input. This
-- is authoritative for multi-source lineage; coffee_lots.parent_lot_id remains
-- a legacy convenience only for true single-source output lots.
create table public.processing_output_sources (
  output_id uuid not null references public.processing_outputs(id) on delete cascade,
  input_id uuid not null references public.processing_order_inputs(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (output_id, input_id)
);

create index processing_output_sources_input_idx
  on public.processing_output_sources (input_id, output_id);

alter table public.processing_output_sources enable row level security;
create policy processing_output_sources_staff_read
  on public.processing_output_sources for select to authenticated
  using ((select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'finance_officer', 'auditor', 'viewer')));
revoke all on public.processing_output_sources from public, anon, authenticated;
grant select on public.processing_output_sources to authenticated;

insert into public.processing_output_sources (output_id, input_id)
select output.id, input.id
from public.processing_outputs output
join public.processing_order_inputs input on input.order_id = output.order_id
on conflict do nothing;

-- Versioned demo configuration. A labour record copies the active addition so
-- later configuration changes never rewrite historical client charges.
create table public.labour_charge_settings (
  id uuid primary key default gen_random_uuid(),
  fixed_addition_etb numeric(12,2) not null check (fixed_addition_etb >= 0),
  effective_from date not null,
  effective_to date,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create unique index labour_charge_settings_one_active_idx
  on public.labour_charge_settings (active) where active;

create table public.labour_records (
  id uuid primary key default gen_random_uuid(),
  labour_number text not null unique,
  work_date date not null,
  client_id uuid not null references public.clients(id),
  lot_id uuid references public.coffee_lots(id),
  processing_order_id uuid references public.processing_orders(id),
  dispatch_id uuid references public.dispatch_orders(id),
  activity text not null check (nullif(btrim(activity), '') is not null),
  quantity numeric(16,3) not null check (quantity > 0),
  unit_label text not null check (nullif(btrim(unit_label), '') is not null),
  internal_cost_etb numeric(16,2) not null check (internal_cost_etb >= 0),
  charge_addition_etb numeric(16,2) not null check (charge_addition_etb >= 0),
  client_charge_etb numeric(16,2) not null check (client_charge_etb >= 0),
  note text,
  external_reference text,
  service_event_id uuid unique references public.service_events(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (client_charge_etb = internal_cost_etb + charge_addition_etb)
);

create index labour_records_client_date_idx
  on public.labour_records (client_id, work_date desc, created_at desc);
create index labour_records_processing_order_idx
  on public.labour_records (processing_order_id) where processing_order_id is not null;

alter table public.labour_charge_settings enable row level security;
alter table public.labour_records enable row level security;
create policy labour_charge_settings_staff_read
  on public.labour_charge_settings for select to authenticated
  using ((select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'finance_officer', 'auditor', 'viewer')));
create policy labour_records_staff_read
  on public.labour_records for select to authenticated
  using ((select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'finance_officer', 'auditor', 'viewer')));
revoke all on public.labour_charge_settings, public.labour_records from public, anon, authenticated;
grant select on public.labour_charge_settings, public.labour_records to authenticated;

create unique index service_events_source_once_idx
  on public.service_events (service_type, reference_id)
  where reference_id is not null;

insert into public.labour_charge_settings (
  fixed_addition_etb, effective_from, active, created_by
)
select 10, current_date, true, profile.id
from public.profiles profile
where profile.active and profile.role = 'system_admin'
order by profile.created_at
limit 1;

-- The cached lot balance is allowed for fast operations, but quantity-changing
-- processing RPCs refuse to operate when it differs from the immutable ledger.
create or replace function private.assert_lot_reconciled(p_lot_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_lot public.coffee_lots;
  v_ledger_kg numeric;
  v_ledger_bags integer;
begin
  select * into v_lot from public.coffee_lots where id = p_lot_id;
  if not found then raise exception 'Source coffee lot not found.'; end if;
  select coalesce(sum(quantity_kg), 0), coalesce(sum(bag_delta), 0)
  into v_ledger_kg, v_ledger_bags
  from public.stock_movements where lot_id = p_lot_id;
  if abs(v_lot.quantity_kg - v_ledger_kg) > 0.001 or v_lot.bag_count <> v_ledger_bags then
    raise exception 'Lot % is blocked because its cached balance does not reconcile to the inventory ledger.', v_lot.lot_number;
  end if;
end;
$$;

-- Add only the document types required by this approved refinement.
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
  if document_type not in ('GRN', 'PROCESSING_REQUEST', 'PROCESSING_ORDER', 'PROCESSING_INTAKE', 'PROCESSING_COMPLETION', 'DISPATCH', 'INVOICE', 'PAYMENT', 'DOCUMENT', 'LABOUR') then
    raise exception 'Unsupported document number type';
  end if;
  if calendar_year < 2000 or calendar_year > 2200 then raise exception 'Invalid document year'; end if;

  select organization_row.* into organization
  from public.organizations organization_row
  join public.profiles profile on profile.organization_id = organization_row.id
  where profile.id = (select auth.uid());
  if not found then raise exception 'User organization not found'; end if;

  select warehouse_row.* into warehouse
  from public.warehouses warehouse_row
  where warehouse_row.organization_id = organization.id
    and warehouse_row.code = warehouse_code and warehouse_row.active;
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
    when 'PROCESSING_INTAKE' then 'PI'
    when 'PROCESSING_COMPLETION' then 'PC'
    when 'PAYMENT' then 'PAY'
    when 'DOCUMENT' then 'DOC'
    when 'LABOUR' then 'LAB'
    else document_type
  end;
  return prefix || '-' || warehouse.code || '-' || calendar_year || '-' || lpad(next_value::text, 4, '0');
end;
$$;

-- Search/pagination stays in PostgreSQL. The UI presents the existing internal
-- CLIENT_REJECT and ACCEPTED_PROCESSED values as Reject and Processed.
drop function if exists public.list_eligible_processing_lots(uuid);
create function public.list_eligible_processing_lots(
  p_client_id uuid,
  p_source_type text default null,
  p_search text default null,
  p_limit integer default 10
)
returns table (
  lot_id uuid,
  lot_number text,
  client_id uuid,
  client_name text,
  lot_category text,
  source_type text,
  source_document text,
  coffee_type text,
  origin text,
  grade text,
  crop_year integer,
  section text,
  bag_count integer,
  quantity_kg numeric(16,3),
  reserved_kg numeric(16,3),
  reserved_bags integer,
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
  if p_source_type is not null and p_source_type not in ('ARRIVAL', 'REJECT', 'PROCESSED') then
    raise exception 'Source type must be Arrival, Reject, or Processed.';
  end if;
  return query
  with active_reservations as (
    select reservation.lot_id,
      coalesce(sum(reservation.reserved_kg), 0)::numeric(16,3) total_reserved_kg,
      coalesce(sum(reservation.reserved_bags), 0)::integer total_reserved_bags
    from public.stock_reservations reservation
    where reservation.status = 'ACTIVE'
    group by reservation.lot_id
  )
  select lot.id, lot.lot_number, lot.client_id, client.legal_name,
    lot.lot_category,
    case lot.lot_category when 'ARRIVAL' then 'ARRIVAL' when 'CLIENT_REJECT' then 'REJECT' else 'PROCESSED' end,
    case when lot.lot_category = 'ARRIVAL' then receipt.receipt_number else source_order.order_number end,
    lot.coffee_type, receipt.origin,
    coalesce(output.grade, receipt.grade, 'Standard'), receipt.crop_year,
    lot.section, lot.bag_count, lot.quantity_kg,
    coalesce(reservation.total_reserved_kg, 0)::numeric(16,3),
    coalesce(reservation.total_reserved_bags, 0)::integer,
    greatest(0, lot.quantity_kg - coalesce(reservation.total_reserved_kg, 0))::numeric(16,3),
    greatest(0, lot.bag_count - coalesce(reservation.total_reserved_bags, 0))::integer,
    lot.receipt_id, lot.parent_lot_id, lot.source_processing_order_id, lot.status, lot.created_at
  from public.coffee_lots lot
  join public.clients client on client.id = lot.client_id
  left join public.warehouse_receipts receipt on receipt.id = lot.receipt_id
  left join public.processing_orders source_order on source_order.id = lot.source_processing_order_id
  left join public.processing_outputs output on output.child_lot_id = lot.id
  left join active_reservations reservation on reservation.lot_id = lot.id
  where lot.client_id = p_client_id
    and lot.ownership_type = 'CLIENT'
    and lot.lot_category in ('ARRIVAL', 'CLIENT_REJECT', 'ACCEPTED_PROCESSED')
    and (p_source_type is null or case lot.lot_category when 'ARRIVAL' then 'ARRIVAL' when 'CLIENT_REJECT' then 'REJECT' else 'PROCESSED' end = p_source_type)
    and lot.quantity_kg > 0
    and lot.quantity_kg - coalesce(reservation.total_reserved_kg, 0) > 0
    and lot.status not in ('REVERSED', 'CLOSED', 'DISPATCHED', 'IN_PROCESS', 'IN_TRANSIT')
    and (
      nullif(btrim(p_search), '') is null
      or lot.lot_number ilike '%' || btrim(p_search) || '%'
      or coalesce(receipt.receipt_number, '') ilike '%' || btrim(p_search) || '%'
      or coalesce(source_order.order_number, '') ilike '%' || btrim(p_search) || '%'
      or client.legal_name ilike '%' || btrim(p_search) || '%'
    )
  order by lot.created_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
end;
$$;

-- Request creation validates all selected lots against one client and one
-- coffee type, and respects every active dispatch/processing reservation.
create or replace function public.create_processing_request(p_header jsonb, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.processing_requests;
  v_primary_lot public.coffee_lots;
  v_line jsonb;
  v_line_lot public.coffee_lots;
  v_line_number integer := 0;
  v_requested_bags integer := 0;
  v_requested_kg numeric := 0;
  v_reserved_bags integer;
  v_reserved_kg numeric;
  v_request_number text;
  v_request_year integer;
  v_seen_lots uuid[] := array[]::uuid[];
  v_coffee_type text;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'At least one processing input lot is required.'; end if;
  if nullif(btrim(p_header ->> 'noteNumber'), '') is null then raise exception 'External paper note number is required.'; end if;
  if nullif(btrim(p_header ->> 'requestDate'), '') is null then raise exception 'Request date is required.'; end if;
  if nullif(btrim(p_header ->> 'requester'), '') is null or nullif(btrim(p_header ->> 'approver'), '') is null then raise exception 'Requester and approver are required.'; end if;
  if lower(btrim(p_header ->> 'requester')) = lower(btrim(p_header ->> 'approver')) then raise exception 'Approver cannot be the same as requester.'; end if;

  -- Deterministic row-lock order protects overlapping multi-lot requests.
  perform lot.id
  from public.coffee_lots lot
  where lot.id in (select (value ->> 'lotId')::uuid from jsonb_array_elements(p_lines))
  order by lot.id for update;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_line_number := v_line_number + 1;
    if (v_line ->> 'lotId')::uuid = any(v_seen_lots) then raise exception 'A processing input lot can only be added once.'; end if;
    v_seen_lots := array_append(v_seen_lots, (v_line ->> 'lotId')::uuid);
    select * into v_line_lot from public.coffee_lots where id = (v_line ->> 'lotId')::uuid;
    if not found then raise exception 'Selected source lot no longer exists.'; end if;
    perform private.assert_lot_reconciled(v_line_lot.id);
    if v_line_lot.client_id <> (p_header ->> 'clientId')::uuid or v_line_lot.ownership_type <> 'CLIENT' then
      raise exception 'Every source lot must belong to the selected client.';
    end if;
    if v_line_lot.lot_category not in ('ARRIVAL', 'CLIENT_REJECT', 'ACCEPTED_PROCESSED') then
      raise exception 'Only Arrival, Reject, or Processed lots can supply processing.';
    end if;
    if v_line_lot.status not in ('ARRIVAL_IN_STORAGE', 'WAITING_PROCESSING', 'PROCESSED', 'AWAITING_DISPATCH') then
      raise exception 'Source lot % is not available for processing.', v_line_lot.lot_number;
    end if;
    if v_coffee_type is null then v_coffee_type := v_line_lot.coffee_type;
    elsif v_coffee_type <> v_line_lot.coffee_type then
      raise exception 'Mixing washed and unwashed coffee requires warehouse confirmation and is currently blocked.';
    end if;
    select coalesce(sum(reserved_kg), 0), coalesce(sum(reserved_bags), 0)
    into v_reserved_kg, v_reserved_bags
    from public.stock_reservations where lot_id = v_line_lot.id and status = 'ACTIVE';
    if (v_line ->> 'requestedBags')::integer <= 0 or (v_line ->> 'requestedKg')::numeric <= 0 then
      raise exception 'Requested bags and kilograms must be positive.';
    end if;
    if (v_line ->> 'requestedKg')::numeric > v_line_lot.quantity_kg - v_reserved_kg
      or (v_line ->> 'requestedBags')::integer > v_line_lot.bag_count - v_reserved_bags then
      raise exception 'Requested quantity for lot % exceeds available unreserved stock.', v_line_lot.lot_number;
    end if;
    if v_line_number = 1 then v_primary_lot := v_line_lot; end if;
    v_requested_bags := v_requested_bags + (v_line ->> 'requestedBags')::integer;
    v_requested_kg := v_requested_kg + (v_line ->> 'requestedKg')::numeric;
  end loop;

  v_request_year := extract(year from (p_header ->> 'requestDate')::date)::integer;
  v_request_number := public.next_erp_number('PROCESSING_REQUEST', 'GEL', v_request_year);
  insert into public.processing_requests (
    request_number, request_note_number, request_date, client_name, client_id,
    lot_reference, warehouse_receipt_id, lot_id, coffee_type, requested_preparation_type,
    grade, requested_bags, requested_kg, certifications, other_certification,
    requester_name, checker_name, approver_name, notes, scanned_document_attached, created_by
  ) values (
    v_request_number, btrim(p_header ->> 'noteNumber'), (p_header ->> 'requestDate')::date,
    p_header ->> 'clientName', (p_header ->> 'clientId')::uuid,
    v_primary_lot.lot_number, v_primary_lot.receipt_id, v_primary_lot.id, v_primary_lot.coffee_type,
    p_lines -> 0 ->> 'preparationType', coalesce(p_lines -> 0 ->> 'grade', '-'), v_requested_bags, v_requested_kg,
    array(select jsonb_array_elements_text(coalesce(p_header -> 'certifications', '[]'::jsonb))),
    nullif(btrim(p_header ->> 'otherCertification'), ''), p_header ->> 'requester', p_header ->> 'checker',
    p_header ->> 'approver', nullif(btrim(p_header ->> 'notes'), ''),
    coalesce((p_header ->> 'scannedDocumentAttached')::boolean, false), (select auth.uid())
  ) returning * into v_request;

  v_line_number := 0;
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_line_number := v_line_number + 1;
    insert into public.processing_request_lines (
      request_id, line_number, lot_id, requested_preparation_type, grade,
      requested_bags, requested_kg, certifications, special_instruction, remark
    ) values (
      v_request.id, v_line_number, (v_line ->> 'lotId')::uuid, v_line ->> 'preparationType',
      coalesce(v_line ->> 'grade', '-'), (v_line ->> 'requestedBags')::integer,
      (v_line ->> 'requestedKg')::numeric,
      array(select jsonb_array_elements_text(coalesce(v_line -> 'certifications', '[]'::jsonb))),
      nullif(btrim(v_line ->> 'specialInstruction'), ''), nullif(btrim(v_line ->> 'remark'), '')
    );
  end loop;
  perform private.record_audit('PROCESSING_REQUEST_CREATED', 'PROCESSING_REQUEST', v_request.id,
    jsonb_build_object('request_number', v_request_number, 'line_count', v_line_number, 'requested_kg', v_requested_kg));
  return jsonb_build_object('id', v_request.id, 'request_number', v_request_number, 'line_count', v_line_number);
end;
$$;

-- Queueing is the confirmed reservation point. All source lots are locked and
-- allocated in one transaction; any failure rolls the entire order back.
create or replace function public.queue_processing_request(request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.processing_requests;
  v_primary_line public.processing_request_lines;
  v_line public.processing_request_lines;
  v_lot public.coffee_lots;
  v_new_order public.processing_orders;
  v_next_position integer;
  v_order_number text;
  v_reserved_kg numeric;
  v_reserved_bags integer;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  select * into v_request from public.processing_requests where id = queue_processing_request.request_id for update;
  if not found or v_request.status <> 'APPROVED' then raise exception 'Only approved requests can enter the queue.'; end if;
  if v_request.queued_order_id is not null then raise exception 'This request is already queued.'; end if;
  select * into v_primary_line from public.processing_request_lines where processing_request_lines.request_id = v_request.id order by line_number limit 1;
  if not found then raise exception 'The request must contain at least one source line.'; end if;

  for v_line in select * from public.processing_request_lines where processing_request_lines.request_id = v_request.id order by lot_id
  loop
    select * into v_lot from public.coffee_lots where id = v_line.lot_id for update;
    perform private.assert_lot_reconciled(v_lot.id);
    if v_lot.client_id <> v_request.client_id or v_lot.ownership_type <> 'CLIENT'
      or v_lot.lot_category not in ('ARRIVAL', 'CLIENT_REJECT', 'ACCEPTED_PROCESSED') then
      raise exception 'Every queued input must be eligible stock for the processing client.';
    end if;
    if v_lot.status not in ('ARRIVAL_IN_STORAGE', 'WAITING_PROCESSING', 'PROCESSED', 'AWAITING_DISPATCH') then
      raise exception 'Source lot % cannot be queued from status %.', v_lot.lot_number, v_lot.status;
    end if;
    select coalesce(sum(reserved_kg), 0), coalesce(sum(reserved_bags), 0)
    into v_reserved_kg, v_reserved_bags
    from public.stock_reservations where lot_id = v_lot.id and status = 'ACTIVE';
    if v_line.requested_kg > v_lot.quantity_kg - v_reserved_kg
      or v_line.requested_bags > v_lot.bag_count - v_reserved_bags then
      raise exception 'Lot % no longer has enough unreserved stock for this request.', v_lot.lot_number;
    end if;
  end loop;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hayked-processing-queue', 0));
  select coalesce(max(queue_position), 0) + 1 into v_next_position
  from public.processing_orders where status in ('QUEUED', 'BLOCKED', 'IN_PROCESS');
  v_order_number := public.next_erp_number('PROCESSING_ORDER', 'GEL', extract(year from v_request.request_date)::integer);
  insert into public.processing_orders (
    order_number, request_id, lot_id, client_id, queue_position, input_kg,
    allowance_percent, status, prepared_by
  ) values (
    v_order_number, v_request.id, v_primary_line.lot_id, v_request.client_id, v_next_position,
    (select sum(requested_kg) from public.processing_request_lines where processing_request_lines.request_id = v_request.id),
    case when v_request.coffee_type = 'WASHED' then 22.5 else 2.5 end, 'QUEUED', v_request.created_by
  ) returning * into v_new_order;

  insert into public.processing_order_inputs (order_id, request_line_id, lot_id, input_bags, input_kg)
  select v_new_order.id, id, lot_id, requested_bags, requested_kg
  from public.processing_request_lines where processing_request_lines.request_id = v_request.id;

  insert into public.stock_reservations (
    processing_order_id, lot_id, reserved_bags, reserved_kg, created_by
  )
  select v_new_order.id, lot_id, requested_bags, requested_kg, (select auth.uid())
  from public.processing_request_lines where processing_request_lines.request_id = v_request.id;

  update public.processing_requests set queued_order_id = v_new_order.id where id = v_request.id;
  update public.coffee_lots set status = 'WAITING_PROCESSING'
  where id in (select lot_id from public.processing_order_inputs where order_id = v_new_order.id);
  perform private.record_audit('PROCESSING_QUEUED', 'PROCESSING_ORDER', v_new_order.id,
    jsonb_build_object('request_id', v_request.id, 'order_number', v_order_number, 'queue_position', v_next_position));
  return jsonb_build_object('id', v_new_order.id, 'order_number', v_order_number, 'queue_position', v_next_position);
end;
$$;

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
  v_reservation public.stock_reservations;
  v_other_reserved_kg numeric;
  v_other_reserved_bags integer;
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
  into v_total_kg, v_total_bags from public.processing_order_inputs where order_id = p_order_id;
  if v_total_kg <= 0 or v_total_bags <= 0 then raise exception 'Processing order has no valid input lines.'; end if;
  if abs(v_total_kg - v_processing.input_kg) > 0.01
    or abs((p_intake ->> 'inputKg')::numeric - v_total_kg) > 0.01
    or (p_intake ->> 'inputBags')::integer <> v_total_bags then
    raise exception 'Intake bags and kilograms must equal the queued order inputs.';
  end if;

  for v_input in select * from public.processing_order_inputs where order_id = p_order_id order by lot_id
  loop
    select * into v_lot from public.coffee_lots where id = v_input.lot_id for update;
    if not found then raise exception 'Source coffee lot % not found.', v_input.lot_id; end if;
    perform private.assert_lot_reconciled(v_lot.id);
    if v_lot.client_id <> v_processing.client_id or v_lot.ownership_type <> 'CLIENT' then
      raise exception 'Every processing source must be client-owned stock for the processing client.';
    end if;
    if v_lot.lot_category not in ('ARRIVAL', 'CLIENT_REJECT', 'ACCEPTED_PROCESSED') then
      raise exception 'Processing input must be Arrival, Reject, or Processed coffee.';
    end if;
    select * into v_reservation from public.stock_reservations
    where processing_order_id = p_order_id and lot_id = v_lot.id and status = 'ACTIVE' for update;
    if not found or v_reservation.reserved_kg <> v_input.input_kg or v_reservation.reserved_bags <> v_input.input_bags then
      raise exception 'Active processing reservation is missing or no longer matches lot %.', v_lot.lot_number;
    end if;
    select coalesce(sum(reserved_kg), 0), coalesce(sum(reserved_bags), 0)
    into v_other_reserved_kg, v_other_reserved_bags
    from public.stock_reservations
    where lot_id = v_lot.id and status = 'ACTIVE' and id <> v_reservation.id;
    if v_input.input_kg > v_lot.quantity_kg - v_other_reserved_kg
      or v_input.input_bags > v_lot.bag_count - v_other_reserved_bags then
      raise exception 'Reserved processing input for lot % is no longer physically available.', v_lot.lot_number;
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
    update public.stock_reservations set status = 'CONSUMED', released_at = now()
    where id = v_reservation.id;
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
  update public.processing_orders set status = 'IN_PROCESS', started_at = v_intake.intake_at where id = p_order_id;
  perform private.record_audit('PROCESSING_STARTED', 'PROCESSING_ORDER', p_order_id,
    jsonb_build_object('intake_number', v_intake.intake_number, 'input_kg', v_total_kg, 'input_bags', v_total_bags));
  return jsonb_build_object('id', p_order_id, 'status', 'IN_PROCESS', 'intake_number', v_intake.intake_number);
end;
$$;

-- Preserve the existing completion rules while writing explicit many-to-many
-- lineage for every physical and non-physical output record.
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
  v_output public.processing_outputs;
  v_hayked_client_id uuid;
  v_line jsonb;
  v_line_number integer := 0;
  v_input_count integer;
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
  if jsonb_typeof(p_output_lines) <> 'array' or jsonb_array_length(p_output_lines) = 0 then raise exception 'At least one processing output line is required.'; end if;

  for v_line in select value from jsonb_array_elements(p_output_lines)
  loop
    v_category := v_line ->> 'category';
    if v_category not in ('ACCEPTED_CLIENT_COFFEE', 'CLIENT_REJECT', 'HAYKED_BYPRODUCT', 'REWORK', 'PROCESS_LOSS') then raise exception 'Unsupported processing output category.'; end if;
    if nullif(v_line ->> 'quantityKg', '') is null or (v_line ->> 'quantityKg')::numeric <= 0 then raise exception 'Every processing output quantity must be positive.'; end if;
    if v_category = 'PROCESS_LOSS' then
      if nullif(btrim(coalesce(v_line ->> 'reason', p_loss_reason)), '') is null then raise exception 'Process loss requires a reason.'; end if;
    else
      if coalesce((v_line ->> 'bagCount')::integer, 0) <= 0
        or nullif(btrim(v_line ->> 'warehouseSection'), '') is null
        or nullif(btrim(v_line ->> 'weighingReference'), '') is null then
        raise exception 'Every physical output requires positive bags, a warehouse section, and a weighing reference.';
      end if;
      if coalesce(nullif(v_line ->> 'coffeeType', ''), 'INVALID') not in ('WASHED', 'UNWASHED_UG') then raise exception 'Every physical output requires a valid coffee type.'; end if;
    end if;
    v_output_kg := v_output_kg + (v_line ->> 'quantityKg')::numeric;
    v_accepted_kg := v_accepted_kg + case when v_category = 'ACCEPTED_CLIENT_COFFEE' then (v_line ->> 'quantityKg')::numeric else 0 end;
    v_reject_kg := v_reject_kg + case when v_category = 'CLIENT_REJECT' then (v_line ->> 'quantityKg')::numeric else 0 end;
    v_byproduct_kg := v_byproduct_kg + case when v_category = 'HAYKED_BYPRODUCT' then (v_line ->> 'quantityKg')::numeric else 0 end;
    v_rework_kg := v_rework_kg + case when v_category = 'REWORK' then (v_line ->> 'quantityKg')::numeric else 0 end;
    v_loss_kg := v_loss_kg + case when v_category = 'PROCESS_LOSS' then (v_line ->> 'quantityKg')::numeric else 0 end;
  end loop;

  if abs(v_processing.input_kg - v_output_kg) > 0.01 then raise exception 'Processing outputs must reconcile to input within 0.01 kg.'; end if;
  v_allowance_kg := case when v_processing.allowance_percent = 22.5 then v_byproduct_kg + v_loss_kg else v_loss_kg end;
  v_requires_exception := v_allowance_kg > v_processing.input_kg * v_processing.allowance_percent / 100
    or (v_processing.allowance_percent = 2.5 and v_byproduct_kg > 0);
  if v_requires_exception and (
    not p_exception_approved or nullif(btrim(p_loss_evidence), '') is null
    or not exists (
      select 1 from public.approvals where request_type = 'PROCESSING_EXCEPTION'
        and reference_id = p_order_id and status = 'APPROVED' and requested_by <> decided_by
    )
  ) then raise exception 'Above-rule completion requires an approved independent PROCESSING_EXCEPTION record and evidence.'; end if;

  select count(*) into v_input_count from public.processing_order_inputs where order_id = p_order_id;
  select lot.* into v_parent_lot
  from public.processing_order_inputs input
  join public.coffee_lots lot on lot.id = input.lot_id
  where input.order_id = p_order_id order by input.created_at limit 1;
  if not found then raise exception 'Processing source lots not found.'; end if;
  select id into v_hayked_client_id from public.clients where code = 'CL-HAYKED' and active order by created_at limit 1;
  if v_byproduct_kg > 0 and v_hayked_client_id is null then raise exception 'Hayked internal ownership client is not configured.'; end if;

  v_completion_number := public.next_erp_number('PROCESSING_COMPLETION', 'GEL', extract(year from current_date)::integer);
  for v_line in select value from jsonb_array_elements(p_output_lines)
  loop
    v_line_number := v_line_number + 1;
    v_category := v_line ->> 'category';
    v_owner_type := case when v_category = 'HAYKED_BYPRODUCT' then 'HAYKED' when v_category = 'PROCESS_LOSS' then 'NONE' else 'CLIENT' end;
    v_lot_category := case when v_category = 'ACCEPTED_CLIENT_COFFEE' then 'ACCEPTED_PROCESSED' when v_category = 'CLIENT_REJECT' then 'CLIENT_REJECT' when v_category = 'HAYKED_BYPRODUCT' then 'HAYKED_BYPRODUCT' else 'OTHER' end;
    v_child_lot := null;
    if v_category <> 'PROCESS_LOSS' then
      insert into public.coffee_lots (
        lot_number, warehouse_id, client_id, receipt_id, parent_lot_id, source_processing_order_id,
        coffee_type, ownership_type, lot_category, bag_count, quantity_kg, section, status
      ) values (
        v_completion_number || '-O' || lpad(v_line_number::text, 2, '0'), v_parent_lot.warehouse_id,
        case when v_owner_type = 'HAYKED' then v_hayked_client_id else v_processing.client_id end,
        case when v_input_count = 1 then v_parent_lot.receipt_id else null end,
        case when v_input_count = 1 then v_parent_lot.id else null end,
        p_order_id, v_line ->> 'coffeeType', v_owner_type, v_lot_category,
        (v_line ->> 'bagCount')::integer, (v_line ->> 'quantityKg')::numeric,
        btrim(v_line ->> 'warehouseSection'), 'PROCESSED'
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
    ) returning * into v_output;

    insert into public.processing_output_sources (output_id, input_id)
    select v_output.id, input.id from public.processing_order_inputs input where input.order_id = p_order_id;
  end loop;

  update public.coffee_lots
  set status = case when quantity_kg <= 0.01 then 'CLOSED' when lot_category = 'ARRIVAL' then 'ARRIVAL_IN_STORAGE' else 'PROCESSED' end
  where id in (select lot_id from public.processing_order_inputs where order_id = p_order_id);
  update public.processing_orders set
    completion_number = v_completion_number, accepted_client_kg = v_accepted_kg + v_rework_kg,
    client_reject_kg = v_reject_kg, hayked_byproduct_kg = v_byproduct_kg,
    process_loss_kg = v_loss_kg, exception_evidence_path = nullif(btrim(p_loss_evidence), ''),
    status = 'POSTED', approved_by = (select auth.uid()), completed_at = now()
  where id = p_order_id;
  perform private.record_audit('PROCESSING_COMPLETED', 'PROCESSING_ORDER', p_order_id,
    jsonb_build_object('completion_number', v_completion_number, 'output_kg', v_output_kg, 'output_lines', v_line_number, 'input_lots', v_input_count));
  return jsonb_build_object('id', p_order_id, 'status', 'POSTED', 'completion_number', v_completion_number, 'output_lines', v_line_number, 'input_lots', v_input_count);
end;
$$;

create function public.post_labour_entry(
  p_client_id uuid,
  p_work_date date,
  p_activity text,
  p_quantity numeric,
  p_unit_label text,
  p_internal_cost_etb numeric,
  p_lot_id uuid default null,
  p_processing_order_id uuid default null,
  p_dispatch_id uuid default null,
  p_note text default null,
  p_external_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_setting public.labour_charge_settings;
  v_labour public.labour_records;
  v_service public.service_events;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor');
  if not exists (select 1 from public.clients where id = p_client_id and active) then raise exception 'Active labour client not found.'; end if;
  if p_work_date is null or p_work_date > current_date then raise exception 'Labour date must be today or earlier.'; end if;
  if nullif(btrim(p_activity), '') is null or p_quantity <= 0 or nullif(btrim(p_unit_label), '') is null then raise exception 'Labour activity, quantity, and unit are required.'; end if;
  if p_internal_cost_etb < 0 then raise exception 'Internal labour cost cannot be negative.'; end if;
  if p_lot_id is not null and not exists (select 1 from public.coffee_lots where id = p_lot_id and client_id = p_client_id) then raise exception 'Selected labour lot does not belong to the client.'; end if;
  if p_processing_order_id is not null and not exists (select 1 from public.processing_orders where id = p_processing_order_id and client_id = p_client_id) then raise exception 'Selected processing order does not belong to the client.'; end if;
  if p_dispatch_id is not null and not exists (select 1 from public.dispatch_orders where id = p_dispatch_id and client_id = p_client_id) then raise exception 'Selected dispatch does not belong to the client.'; end if;

  select * into v_setting from public.labour_charge_settings
  where active and p_work_date >= effective_from and (effective_to is null or p_work_date <= effective_to)
  order by effective_from desc limit 1;
  if not found then raise exception 'No active labour charge addition is configured for this date.'; end if;

  insert into public.labour_records (
    labour_number, work_date, client_id, lot_id, processing_order_id, dispatch_id,
    activity, quantity, unit_label, internal_cost_etb, charge_addition_etb,
    client_charge_etb, note, external_reference, created_by
  ) values (
    public.next_erp_number('LABOUR', 'GEL', extract(year from p_work_date)::integer),
    p_work_date, p_client_id, p_lot_id, p_processing_order_id, p_dispatch_id,
    btrim(p_activity), p_quantity, btrim(p_unit_label), round(p_internal_cost_etb, 2),
    v_setting.fixed_addition_etb, round(p_internal_cost_etb + v_setting.fixed_addition_etb, 2),
    nullif(btrim(p_note), ''), nullif(btrim(p_external_reference), ''), (select auth.uid())
  ) returning * into v_labour;

  insert into public.service_events (
    client_id, lot_id, service_type, description, quantity, unit_price,
    total_amount, reference_id, status
  ) values (
    p_client_id, p_lot_id, 'LABOUR', 'Labour Service - ' || btrim(p_activity),
    1, v_labour.client_charge_etb, v_labour.client_charge_etb, v_labour.id, 'UNBILLED'
  ) returning * into v_service;
  update public.labour_records set service_event_id = v_service.id where id = v_labour.id;
  perform private.record_audit('LABOUR_RECORDED', 'LABOUR_RECORD', v_labour.id,
    jsonb_build_object('labour_number', v_labour.labour_number, 'client_charge_etb', v_labour.client_charge_etb));
  return jsonb_build_object(
    'id', v_labour.id, 'labour_number', v_labour.labour_number,
    'internal_cost_etb', v_labour.internal_cost_etb,
    'charge_addition_etb', v_labour.charge_addition_etb,
    'client_charge_etb', v_labour.client_charge_etb,
    'service_event_id', v_service.id
  );
end;
$$;

revoke all on function public.list_eligible_processing_lots(uuid, text, text, integer),
  public.create_processing_request(jsonb, jsonb), public.queue_processing_request(uuid),
  public.start_processing_order_with_intake(uuid, jsonb),
  public.complete_processing_order_v2(uuid, jsonb, text, text, boolean),
  public.post_labour_entry(uuid, date, text, numeric, text, numeric, uuid, uuid, uuid, text, text)
from public, anon;

grant execute on function public.list_eligible_processing_lots(uuid, text, text, integer),
  public.create_processing_request(jsonb, jsonb), public.queue_processing_request(uuid),
  public.start_processing_order_with_intake(uuid, jsonb),
  public.complete_processing_order_v2(uuid, jsonb, text, text, boolean),
  public.post_labour_entry(uuid, date, text, numeric, text, numeric, uuid, uuid, uuid, text, text)
to authenticated;
