-- A second staff member checks physical quantities before a stock-changing step.
-- Historical rows remain untouched; existing submitted work needs a fresh check.
create table public.quantity_checks (
  id uuid primary key default gen_random_uuid(),
  stage text not null check (stage in ('ARRIVAL', 'PROCESSING_INTAKE', 'PROCESSING_OUTPUT', 'DISPATCH_EXIT')),
  reference_id uuid not null,
  client_id uuid not null references public.clients(id),
  expected_kg numeric(16,3) not null check (expected_kg >= 0),
  measured_kg numeric(16,3) not null check (measured_kg >= 0),
  expected_bags integer not null check (expected_bags >= 0),
  measured_bags integer not null check (measured_bags >= 0),
  evidence_reference text not null check (length(btrim(evidence_reference)) >= 3),
  difference_reason text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  recorded_by uuid not null references public.profiles(id),
  verified_by uuid references public.profiles(id),
  decision_note text,
  recorded_at timestamptz not null default now(),
  verified_at timestamptz,
  check (verified_by is null or verified_by <> recorded_by),
  check (status = 'PENDING' or (verified_by is not null and verified_at is not null))
);
create unique index quantity_checks_one_open_idx on public.quantity_checks (stage, reference_id)
  where status in ('PENDING', 'APPROVED');
create index quantity_checks_reference_idx on public.quantity_checks (stage, reference_id, recorded_at desc);
create index quantity_checks_report_idx on public.quantity_checks (client_id, recorded_at desc);
alter table public.quantity_checks enable row level security;
create policy quantity_checks_staff_read on public.quantity_checks for select to authenticated
  using ((select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'auditor', 'viewer')));
revoke all on public.quantity_checks from public, anon, authenticated;
grant select on public.quantity_checks to authenticated;

create or replace function public.submit_quantity_check(
  p_stage text, p_reference_id uuid, p_expected_kg numeric, p_expected_bags integer,
  p_measured_kg numeric, p_measured_bags integer, p_evidence_reference text,
  p_difference_reason text default null, p_payload jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_expected_kg numeric;
  v_expected_bags integer;
  v_actual_kg numeric;
  v_actual_bags integer;
  v_client_id uuid;
  v_status text;
  v_id uuid;
  v_lines jsonb;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor');
  if p_stage not in ('ARRIVAL', 'PROCESSING_INTAKE', 'PROCESSING_OUTPUT', 'DISPATCH_EXIT') then
    raise exception 'Unsupported quantity-check stage.';
  end if;
  if p_measured_kg is null or p_measured_kg < 0 or p_measured_bags is null or p_measured_bags < 0 then
    raise exception 'Measured kilograms and bags must be nonnegative.';
  end if;
  if p_measured_kg <> round(p_measured_kg, 3)
    or (p_expected_kg is not null and p_expected_kg <> round(p_expected_kg, 3)) then
    raise exception 'Weights must be recorded to no more than three decimal places.';
  end if;
  if length(btrim(coalesce(p_evidence_reference, ''))) < 3 then
    raise exception 'A weighing or count evidence reference is required.';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'Invalid check details.'; end if;

  if p_stage = 'ARRIVAL' then
    select status, net_weight_kg, bag_count, client_id into v_status, v_actual_kg, v_actual_bags, v_client_id
    from public.warehouse_receipts where id = p_reference_id for update;
    if not found or v_status <> 'SUBMITTED' then raise exception 'Only a submitted receipt can be checked.'; end if;
    if p_expected_kg is null or p_expected_kg <= 0 or p_expected_bags is null or p_expected_bags <= 0 then
      raise exception 'Enter the declared delivery weight and bag count.';
    end if;
    if v_actual_kg <> p_measured_kg or v_actual_bags <> p_measured_bags then
      raise exception 'Measured values must match the saved GRN. Correct the GRN before checking it.';
    end if;
    v_expected_kg := p_expected_kg;
    v_expected_bags := p_expected_bags;
  elsif p_stage in ('PROCESSING_INTAKE', 'PROCESSING_OUTPUT') then
    select status, input_kg, client_id into v_status, v_expected_kg, v_client_id
    from public.processing_orders where id = p_reference_id for update;
    if not found or v_status <> (case when p_stage = 'PROCESSING_INTAKE' then 'QUEUED' else 'IN_PROCESS' end) then
      raise exception 'The processing order is not at the requested check stage.';
    end if;
    select coalesce(sum(input_bags), 0) into v_expected_bags
    from public.processing_order_inputs where order_id = p_reference_id;
    if p_stage = 'PROCESSING_INTAKE' then
      if nullif(btrim(p_payload ->> 'scaleReference'), '') is null
        or nullif(btrim(p_payload ->> 'warehouseIssueReference'), '') is null then
        raise exception 'Scale and warehouse issue references are required.';
      end if;
    else
      v_lines := p_payload -> 'lines';
      if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
        raise exception 'Processing output lines are required for review.';
      end if;
      select coalesce(sum((line ->> 'quantityKg')::numeric) filter (where line ->> 'category' <> 'PROCESS_LOSS'), 0),
             coalesce(sum((line ->> 'bagCount')::integer) filter (where line ->> 'category' <> 'PROCESS_LOSS'), 0),
             coalesce(sum((line ->> 'quantityKg')::numeric), 0)
      into v_actual_kg, v_actual_bags, v_expected_kg
      from jsonb_array_elements(v_lines) line;
      if v_actual_kg <> p_measured_kg or v_actual_bags <> p_measured_bags then
        raise exception 'Measured output must match the proposed physical output lines.';
      end if;
      if v_expected_kg <> (select input_kg from public.processing_orders where id = p_reference_id) then
        raise exception 'Every kilogram must be classified as physical output or explained process loss.';
      end if;
      select input_kg into v_expected_kg from public.processing_orders where id = p_reference_id;
      if v_expected_kg > p_measured_kg and nullif(btrim(p_payload ->> 'lossReason'), '') is null then
        raise exception 'A physical output shortage needs an explanation.';
      end if;
    end if;
  else
    select status, quantity_kg, bag_count, client_id into v_status, v_expected_kg, v_expected_bags, v_client_id
    from public.dispatch_orders where id = p_reference_id for update;
    if not found or v_status <> 'APPROVED' then raise exception 'Only an approved dispatch can receive an exit check.'; end if;
  end if;
  if v_expected_kg <> p_measured_kg or
     (p_stage <> 'PROCESSING_OUTPUT' and v_expected_bags <> p_measured_bags) then
    if length(btrim(coalesce(p_difference_reason, ''))) < 5 then
      raise exception 'Explain the measured difference before sending it for review.';
    end if;
  end if;
  insert into public.quantity_checks (
    stage, reference_id, client_id, expected_kg, expected_bags, measured_kg, measured_bags,
    evidence_reference, difference_reason, payload, recorded_by
  ) values (
    p_stage, p_reference_id, v_client_id, v_expected_kg, v_expected_bags, p_measured_kg, p_measured_bags,
    btrim(p_evidence_reference), nullif(btrim(p_difference_reason), ''), p_payload, (select auth.uid())
  ) returning id into v_id;
  perform private.record_audit('QUANTITY_CHECK_SUBMITTED', p_stage, p_reference_id,
    jsonb_build_object('check_id', v_id, 'expected_kg', v_expected_kg, 'measured_kg', p_measured_kg,
      'expected_bags', v_expected_bags, 'measured_bags', p_measured_bags));
  return v_id;
end;
$$;

create or replace function public.decide_quantity_check(p_check_id uuid, p_decision text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_check public.quantity_checks;
  v_result jsonb;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  if p_decision not in ('APPROVED', 'REJECTED') then raise exception 'Decision must be approved or rejected.'; end if;
  if length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'A decision note is required.'; end if;
  select * into v_check from public.quantity_checks where id = p_check_id for update;
  if not found or v_check.status <> 'PENDING' then raise exception 'Only a pending check can be decided.'; end if;
  if v_check.recorded_by = (select auth.uid()) then raise exception 'Another staff member must verify this check.'; end if;
  if v_check.stage in ('ARRIVAL', 'DISPATCH_EXIT') then
    perform private.require_role('system_admin', 'warehouse_manager');
  end if;
  update public.quantity_checks set status = p_decision, verified_by = (select auth.uid()),
    verified_at = now(), decision_note = btrim(p_note) where id = p_check_id;
  perform private.record_audit('QUANTITY_CHECK_' || p_decision, v_check.stage, v_check.reference_id,
    jsonb_build_object('check_id', p_check_id, 'note', btrim(p_note)));
  if p_decision = 'APPROVED' then
    if v_check.stage = 'ARRIVAL' then
      v_result := public.transition_grn(v_check.reference_id, 'APPROVED', null, null);
    elsif v_check.stage = 'PROCESSING_INTAKE'
      and v_check.expected_kg = v_check.measured_kg
      and v_check.expected_bags = v_check.measured_bags then
      v_result := public.start_processing_order_with_intake(v_check.reference_id, v_check.payload);
    elsif v_check.stage = 'PROCESSING_OUTPUT' then
      v_result := public.complete_processing_order_v2(
        v_check.reference_id, v_check.payload -> 'lines',
        v_check.payload ->> 'lossReason', v_check.evidence_reference,
        coalesce((v_check.payload ->> 'exceptionApproved')::boolean, false)
      );
    elsif v_check.stage = 'DISPATCH_EXIT'
      and v_check.expected_kg = v_check.measured_kg
      and v_check.expected_bags = v_check.measured_bags then
      v_result := public.post_dispatch_v2(v_check.reference_id);
    end if;
  end if;
  return jsonb_build_object('id', p_check_id, 'status', p_decision,
    'operation', coalesce(v_result, '{}'::jsonb));
end;
$$;

create or replace function private.enforce_quantity_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_check public.quantity_checks;
  v_lines jsonb;
  v_proposed jsonb;
  v_physical_kg numeric;
  v_physical_bags integer;
begin
  if new.status = old.status then return new; end if;
  if tg_table_name = 'warehouse_receipts' and new.status = 'APPROVED' then
    select * into v_check from public.quantity_checks
    where stage = 'ARRIVAL' and reference_id = new.id and status = 'APPROVED';
    if not found or v_check.measured_kg <> new.net_weight_kg
      or v_check.measured_bags <> new.bag_count then
      raise exception 'An independently approved arrival quantity check is required.';
    end if;
  elsif tg_table_name = 'processing_orders' and new.status = 'IN_PROCESS' then
    select * into v_check from public.quantity_checks
    where stage = 'PROCESSING_INTAKE' and reference_id = new.id and status = 'APPROVED';
    if not found or v_check.expected_kg <> v_check.measured_kg
      or v_check.expected_bags <> v_check.measured_bags
      or v_check.measured_kg <> new.input_kg then
      raise exception 'An exact independently approved processing intake check is required.';
    end if;
  elsif tg_table_name = 'processing_orders' and new.status = 'POSTED' then
    select * into v_check from public.quantity_checks
    where stage = 'PROCESSING_OUTPUT' and reference_id = new.id and status = 'APPROVED';
    if not found then raise exception 'An independently approved processing output check is required.'; end if;
    select coalesce(sum(quantity_kg) filter (where category <> 'PROCESS_LOSS'), 0),
           coalesce(sum(bag_count) filter (where category <> 'PROCESS_LOSS'), 0),
           coalesce(jsonb_agg(jsonb_build_array(category, quantity_kg, bag_count,
             coalesce(weighing_reference, ''), coalesce(warehouse_section, '')) order by line_number), '[]'::jsonb)
    into v_physical_kg, v_physical_bags, v_lines
    from public.processing_outputs where order_id = new.id;
    select coalesce(jsonb_agg(jsonb_build_array(line ->> 'category', (line ->> 'quantityKg')::numeric,
      coalesce((line ->> 'bagCount')::integer, 0), coalesce(line ->> 'weighingReference', ''),
      coalesce(line ->> 'warehouseSection', '')) order by ordinal), '[]'::jsonb)
    into v_proposed
    from jsonb_array_elements(v_check.payload -> 'lines') with ordinality as proposed(line, ordinal);
    if v_lines <> v_proposed or v_physical_kg <> v_check.measured_kg
      or v_physical_bags <> v_check.measured_bags then
      raise exception 'Posted outputs must match the independently reviewed quantities and destinations.';
    end if;
  elsif tg_table_name = 'dispatch_orders' and new.status = 'POSTED' then
    select * into v_check from public.quantity_checks
    where stage = 'DISPATCH_EXIT' and reference_id = new.id and status = 'APPROVED';
    if not found or v_check.measured_kg <> new.quantity_kg
      or v_check.measured_bags <> new.bag_count then
      raise exception 'An exact independently approved dispatch exit check is required.';
    end if;
  end if;
  return new;
end;
$$;
create trigger receipt_quantity_check before update of status on public.warehouse_receipts
  for each row execute function private.enforce_quantity_check();
create trigger processing_quantity_check before update of status on public.processing_orders
  for each row execute function private.enforce_quantity_check();
create trigger dispatch_quantity_check before update of status on public.dispatch_orders
  for each row execute function private.enforce_quantity_check();

revoke all on function public.submit_quantity_check(text, uuid, numeric, integer, numeric, integer, text, text, jsonb),
  public.decide_quantity_check(uuid, text, text) from public, anon, authenticated;
grant execute on function public.submit_quantity_check(text, uuid, numeric, integer, numeric, integer, text, text, jsonb),
  public.decide_quantity_check(uuid, text, text) to authenticated;
revoke all on function private.enforce_quantity_check() from public, anon, authenticated;

create or replace function public.cancel_queued_processing_order(p_order_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_order public.processing_orders;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Explain why intake cannot proceed.'; end if;
  select * into v_order from public.processing_orders where id = p_order_id for update;
  if not found or v_order.status not in ('QUEUED', 'BLOCKED') then
    raise exception 'Only an unstarted processing order can be cancelled.';
  end if;
  update public.stock_reservations set status = 'RELEASED', released_at = now()
  where processing_order_id = p_order_id and status = 'ACTIVE';
  update public.processing_orders set status = 'REVERSED' where id = p_order_id;
  perform private.record_audit('PROCESSING_INTAKE_CANCELLED', 'PROCESSING_ORDER', p_order_id,
    jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object('id', p_order_id, 'status', 'REVERSED');
end;
$$;
revoke all on function public.cancel_queued_processing_order(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_queued_processing_order(uuid, text) to authenticated;

-- Rebagging and blending change the identity or packaging of stock, not its owner.
-- They use the same immutable lot ledger and require an independent decision.
alter table public.stock_movements drop constraint if exists stock_movements_movement_type_check;
alter table public.stock_movements add constraint stock_movements_movement_type_check
  check (movement_type in ('RECEIPT', 'PROCESS_INPUT', 'PROCESS_OUTPUT', 'STORAGE_LOSS',
    'DISPATCH', 'ECS_SEND', 'ECS_RECEIVE', 'OWNERSHIP_OUT', 'OWNERSHIP_IN',
    'REVERSAL', 'ADJUSTMENT', 'REBAG_OUT', 'REBAG_IN', 'BLEND_OUT', 'BLEND_IN'));

create table public.coffee_transform_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('REBAG', 'BLEND')),
  client_id uuid not null references public.clients(id),
  coffee_type text not null check (coffee_type in ('WASHED', 'UNWASHED_UG')),
  lot_category text not null check (lot_category in ('ARRIVAL', 'ACCEPTED_PROCESSED', 'CLIENT_REJECT')),
  input_kg numeric(16,3) not null check (input_kg > 0),
  input_bags integer not null check (input_bags > 0),
  output_kg numeric(16,3) not null check (output_kg > 0),
  output_bags integer not null check (output_bags > 0),
  output_section text not null check (length(btrim(output_section)) >= 2),
  evidence_reference text not null check (length(btrim(evidence_reference)) >= 3),
  instruction text not null check (length(btrim(instruction)) >= 5),
  status text not null default 'PENDING' check (status in ('PENDING', 'POSTED', 'REJECTED')),
  output_lot_id uuid unique references public.coffee_lots(id),
  recorded_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  decision_note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (input_kg = output_kg),
  check (approved_by is null or approved_by <> recorded_by),
  check (status = 'PENDING' or (approved_by is not null and decided_at is not null))
);
create table public.coffee_transform_sources (
  job_id uuid not null references public.coffee_transform_jobs(id) on delete restrict,
  lot_id uuid not null references public.coffee_lots(id) on delete restrict,
  input_bags integer not null check (input_bags > 0),
  input_kg numeric(16,3) not null check (input_kg > 0),
  primary key (job_id, lot_id)
);
create unique index coffee_transform_evidence_once_idx on public.coffee_transform_jobs
  (client_id, job_type, upper(btrim(evidence_reference))) where status in ('PENDING', 'POSTED');
create index coffee_transform_jobs_report_idx on public.coffee_transform_jobs (client_id, created_at desc);
create index coffee_transform_sources_lot_idx on public.coffee_transform_sources (lot_id, job_id);
alter table public.coffee_transform_jobs enable row level security;
alter table public.coffee_transform_sources enable row level security;
create policy coffee_transform_jobs_staff_read on public.coffee_transform_jobs for select to authenticated
  using ((select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'auditor', 'viewer')));
create policy coffee_transform_sources_staff_read on public.coffee_transform_sources for select to authenticated
  using ((select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'auditor', 'viewer')));
revoke all on public.coffee_transform_jobs, public.coffee_transform_sources from public, anon, authenticated;
grant select on public.coffee_transform_jobs, public.coffee_transform_sources to authenticated;

create or replace function public.submit_coffee_transform(
  p_job_type text, p_client_id uuid, p_sources jsonb, p_output_bags integer,
  p_output_kg numeric, p_output_section text, p_evidence_reference text, p_instruction text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_line jsonb;
  v_lot public.coffee_lots;
  v_type text;
  v_category text;
  v_warehouse_id uuid;
  v_count integer := 0;
  v_bags integer := 0;
  v_kg numeric := 0;
  v_seen uuid[] := array[]::uuid[];
  v_job_id uuid;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  if p_job_type not in ('REBAG', 'BLEND') then raise exception 'Choose rebagging or blending.'; end if;
  if jsonb_typeof(p_sources) <> 'array' or jsonb_array_length(p_sources) = 0 then
    raise exception 'Select at least one source lot.';
  end if;
  if p_output_kg is null or p_output_kg <= 0 or p_output_bags is null or p_output_bags <= 0
    or length(btrim(coalesce(p_output_section, ''))) < 2
    or length(btrim(coalesce(p_evidence_reference, ''))) < 3
    or length(btrim(coalesce(p_instruction, ''))) < 5 then
    raise exception 'Output quantity, section, measurement evidence, and instruction are required.';
  end if;
  if p_output_kg <> round(p_output_kg, 3) then
    raise exception 'Weights must be recorded to no more than three decimal places.';
  end if;
  perform 1 from public.coffee_lots
    where id in (select (line ->> 'lotId')::uuid from jsonb_array_elements(p_sources) line)
    order by id for update;
  for v_line in select value from jsonb_array_elements(p_sources) loop
    v_count := v_count + 1;
    if (v_line ->> 'lotId')::uuid = any(v_seen) then raise exception 'A source lot can only appear once.'; end if;
    v_seen := array_append(v_seen, (v_line ->> 'lotId')::uuid);
    select * into v_lot from public.coffee_lots where id = (v_line ->> 'lotId')::uuid;
    if not found or v_lot.client_id <> p_client_id or v_lot.ownership_type <> 'CLIENT'
      or v_lot.lot_category not in ('ARRIVAL', 'ACCEPTED_PROCESSED', 'CLIENT_REJECT')
      or v_lot.status not in ('ARRIVAL_IN_STORAGE', 'PROCESSED', 'AWAITING_DISPATCH') then
      raise exception 'Every source must be an available client lot of a supported category.';
    end if;
    perform private.assert_lot_reconciled(v_lot.id);
    if v_type is null then
      v_type := v_lot.coffee_type;
      v_category := v_lot.lot_category;
      v_warehouse_id := v_lot.warehouse_id;
    elsif v_type <> v_lot.coffee_type or v_category <> v_lot.lot_category
      or v_warehouse_id <> v_lot.warehouse_id then
      raise exception 'Blending requires the same client, warehouse, coffee type, and stock category.';
    end if;
    if coalesce((v_line ->> 'bags')::integer, 0) <= 0 or coalesce((v_line ->> 'kg')::numeric, 0) <= 0 then
      raise exception 'Every source needs positive bags and kilograms.';
    end if;
    if (v_line ->> 'kg')::numeric <> round((v_line ->> 'kg')::numeric, 3) then
      raise exception 'Weights must be recorded to no more than three decimal places.';
    end if;
    if (v_line ->> 'bags')::integer > v_lot.bag_count -
      (select coalesce(sum(reserved_bags), 0) from public.stock_reservations where lot_id = v_lot.id and status = 'ACTIVE')
      or (v_line ->> 'kg')::numeric > v_lot.quantity_kg -
      (select coalesce(sum(reserved_kg), 0) from public.stock_reservations where lot_id = v_lot.id and status = 'ACTIVE') then
      raise exception 'Transformation exceeds available unreserved stock.';
    end if;
    if ((v_line ->> 'bags')::integer = v_lot.bag_count) <>
       ((v_line ->> 'kg')::numeric = v_lot.quantity_kg) then
      raise exception 'A source lot cannot be left with bags but no coffee, or coffee but no bags.';
    end if;
    v_bags := v_bags + (v_line ->> 'bags')::integer;
    v_kg := v_kg + (v_line ->> 'kg')::numeric;
  end loop;
  if (p_job_type = 'REBAG' and v_count <> 1) or (p_job_type = 'BLEND' and v_count < 2) then
    raise exception 'Rebagging needs one source; blending needs at least two.';
  end if;
  if v_kg <> p_output_kg then
    raise exception 'A special job cannot hide a weight difference. Investigate it before submitting.';
  end if;
  insert into public.coffee_transform_jobs (job_type, client_id, coffee_type, lot_category,
    input_kg, input_bags, output_kg, output_bags, output_section,
    evidence_reference, instruction, recorded_by)
  values (p_job_type, p_client_id, v_type, v_category, v_kg, v_bags, p_output_kg,
    p_output_bags, btrim(p_output_section), btrim(p_evidence_reference),
    btrim(p_instruction), (select auth.uid())) returning id into v_job_id;
  insert into public.coffee_transform_sources (job_id, lot_id, input_bags, input_kg)
  select v_job_id, (line ->> 'lotId')::uuid, (line ->> 'bags')::integer, (line ->> 'kg')::numeric
  from jsonb_array_elements(p_sources) line;
  perform private.record_audit('COFFEE_TRANSFORM_SUBMITTED', 'COFFEE_TRANSFORM', v_job_id,
    jsonb_build_object('type', p_job_type, 'input_kg', v_kg, 'output_kg', p_output_kg, 'source_count', v_count));
  return v_job_id;
end;
$$;

create or replace function public.decide_coffee_transform(p_job_id uuid, p_decision text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_job public.coffee_transform_jobs;
  v_source public.coffee_transform_sources;
  v_lot public.coffee_lots;
  v_first public.coffee_lots;
  v_output_id uuid;
  v_count integer := 0;
begin
  perform private.require_role('system_admin', 'warehouse_manager');
  if p_decision not in ('APPROVED', 'REJECTED') or length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'A decision and explanatory note are required.';
  end if;
  select * into v_job from public.coffee_transform_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'PENDING' then raise exception 'Only a pending job can be decided.'; end if;
  if v_job.recorded_by = (select auth.uid()) then raise exception 'The recorder cannot approve the same job.'; end if;
  if p_decision = 'APPROVED' then
    perform 1 from public.coffee_lots where id in
      (select lot_id from public.coffee_transform_sources where job_id = p_job_id) order by id for update;
    for v_source in select * from public.coffee_transform_sources where job_id = p_job_id order by lot_id loop
      select * into v_lot from public.coffee_lots where id = v_source.lot_id;
      perform private.assert_lot_reconciled(v_lot.id);
      if v_lot.client_id <> v_job.client_id or v_lot.ownership_type <> 'CLIENT'
        or v_lot.coffee_type <> v_job.coffee_type
        or v_lot.lot_category <> v_job.lot_category
        or v_lot.status not in ('ARRIVAL_IN_STORAGE', 'PROCESSED', 'AWAITING_DISPATCH')
        or v_source.input_bags > v_lot.bag_count -
          (select coalesce(sum(reserved_bags), 0) from public.stock_reservations where lot_id = v_lot.id and status = 'ACTIVE')
        or v_source.input_kg > v_lot.quantity_kg -
          (select coalesce(sum(reserved_kg), 0) from public.stock_reservations where lot_id = v_lot.id and status = 'ACTIVE') then
        raise exception 'A source lot changed or no longer has enough unreserved stock.';
      end if;
      if v_count > 0 and v_lot.warehouse_id <> v_first.warehouse_id then
        raise exception 'All sources must remain in the same warehouse.';
      end if;
      if (v_source.input_bags = v_lot.bag_count) <> (v_source.input_kg = v_lot.quantity_kg) then
        raise exception 'The source would be left with bags but no coffee, or coffee but no bags.';
      end if;
      if v_count = 0 then v_first := v_lot; end if;
      v_count := v_count + 1;
      insert into public.stock_movements (lot_id, warehouse_id, client_id, movement_type,
        quantity_kg, bag_delta, reference_type, reference_id, reason, posted_by)
      values (v_lot.id, v_lot.warehouse_id, v_lot.client_id, v_job.job_type || '_OUT',
        -v_source.input_kg, -v_source.input_bags, 'COFFEE_TRANSFORM', p_job_id,
        v_job.instruction, (select auth.uid()));
      update public.coffee_lots set quantity_kg = quantity_kg - v_source.input_kg,
        bag_count = bag_count - v_source.input_bags,
        status = case when quantity_kg - v_source.input_kg = 0 then 'CLOSED' else status end
      where id = v_lot.id;
    end loop;
    if (v_job.job_type = 'REBAG' and v_count <> 1) or (v_job.job_type = 'BLEND' and v_count < 2) then
      raise exception 'The source count changed.';
    end if;
    insert into public.coffee_lots (lot_number, warehouse_id, client_id, receipt_id, parent_lot_id,
      coffee_type, ownership_type, lot_category, bag_count, quantity_kg, section, status)
    values ('TRF-' || p_job_id::text, v_first.warehouse_id, v_job.client_id,
      case when v_count = 1 then v_first.receipt_id else null end,
      case when v_count = 1 then v_first.id else null end,
      v_job.coffee_type, 'CLIENT', v_job.lot_category, v_job.output_bags,
      v_job.output_kg, v_job.output_section,
      case when v_job.lot_category = 'ARRIVAL' then 'ARRIVAL_IN_STORAGE' else 'PROCESSED' end)
    returning id into v_output_id;
    insert into public.stock_movements (lot_id, warehouse_id, client_id, movement_type,
      quantity_kg, bag_delta, reference_type, reference_id, reason, posted_by)
    values (v_output_id, v_first.warehouse_id, v_job.client_id, v_job.job_type || '_IN',
      v_job.output_kg, v_job.output_bags, 'COFFEE_TRANSFORM', p_job_id,
      v_job.instruction, (select auth.uid()));
  end if;
  update public.coffee_transform_jobs set status = case when p_decision = 'APPROVED' then 'POSTED' else 'REJECTED' end,
    output_lot_id = v_output_id, approved_by = (select auth.uid()),
    decision_note = btrim(p_note), decided_at = now() where id = p_job_id;
  perform private.record_audit('COFFEE_TRANSFORM_' || p_decision, 'COFFEE_TRANSFORM', p_job_id,
    jsonb_build_object('output_lot_id', v_output_id, 'note', btrim(p_note)));
  return jsonb_build_object('id', p_job_id, 'status', p_decision, 'output_lot_id', v_output_id);
end;
$$;
revoke all on function public.submit_coffee_transform(text, uuid, jsonb, integer, numeric, text, text, text),
  public.decide_coffee_transform(uuid, text, text) from public, anon, authenticated;
grant execute on function public.submit_coffee_transform(text, uuid, jsonb, integer, numeric, text, text, text),
  public.decide_coffee_transform(uuid, text, text) to authenticated;
