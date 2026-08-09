-- Forward repair for database-lint findings in callable operational functions.

create or replace function public.list_eligible_processing_lots(p_client_id uuid)
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
    select sr.lot_id res_lot_id,
      coalesce(sum(sr.reserved_kg), 0)::numeric(16,3) total_reserved_kg,
      coalesce(sum(sr.reserved_bags), 0)::integer total_reserved_bags
    from public.stock_reservations sr
    where sr.status = 'ACTIVE'
    group by sr.lot_id
  )
  select cl.id, cl.lot_number, cl.client_id, cl.lot_category, cl.coffee_type,
    coalesce(wr.grade, 'Standard'), cl.section, cl.bag_count, cl.quantity_kg,
    coalesce(ar.total_reserved_kg, 0)::numeric(16,3),
    greatest(0, cl.quantity_kg - coalesce(ar.total_reserved_kg, 0))::numeric(16,3),
    greatest(0, cl.bag_count - coalesce(ar.total_reserved_bags, 0))::integer,
    cl.receipt_id, cl.parent_lot_id, cl.source_processing_order_id, cl.status, cl.created_at
  from public.coffee_lots cl
  left join public.warehouse_receipts wr on wr.id = cl.receipt_id
  left join active_reservations ar on ar.res_lot_id = cl.id
  where cl.client_id = p_client_id
    and cl.ownership_type = 'CLIENT'
    and cl.lot_category in ('ARRIVAL', 'CLIENT_REJECT', 'ACCEPTED_PROCESSED')
    and cl.quantity_kg > 0
    and cl.status not in ('REVERSED', 'CLOSED', 'DISPATCHED', 'IN_PROCESS', 'IN_TRANSIT')
  order by cl.created_at desc;
end;
$$;

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
  if exists (
    select 1 from public.payments p
    where p.client_id = v_invoice.client_id and lower(p.bank_reference) = lower(v_reference)
      and p.direction = 'PAYMENT'
  ) then raise exception 'This bank reference has already been recorded for the client.'; end if;
  select coalesce(sum(case when p.direction = 'PAYMENT' then p.amount_etb else -p.amount_etb end), 0)
  into v_paid_total from public.payments p where p.invoice_id = v_invoice.id;
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
    select coalesce(sum(r.reserved_bags), 0)::integer, coalesce(sum(r.reserved_kg), 0)
    into v_reserved_bags, v_reserved_kg
    from public.stock_reservations r where r.lot_id = v_lot.id and r.status = 'ACTIVE';
    if v_lot.bag_count - v_reserved_bags < (v_line ->> 'bagCount')::integer
      or v_lot.quantity_kg - v_reserved_kg < (v_line ->> 'quantityKg')::numeric then
      raise exception 'Requested dispatch quantity exceeds unreserved stock.';
    end if;
    if v_line_no = 1 then v_first_lot_id := v_lot.id; end if;
    v_total_bags := v_total_bags + (v_line ->> 'bagCount')::integer;
    v_total_kg := v_total_kg + (v_line ->> 'quantityKg')::numeric;
  end loop;

  select not exists (
    select 1 from public.invoices i
    where i.client_id = v_client.id and i.status in ('ISSUED', 'PARTIALLY_PAID')
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

create or replace function public.schedule_processing_machine(
  p_order_id uuid,
  p_machine_name text,
  p_shift_name text,
  p_scheduled_date date,
  p_allocated_hours numeric,
  p_capacity_kg_per_hr numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule_id uuid;
begin
  perform private.require_role('system_admin', 'processing_supervisor', 'warehouse_manager');
  if not exists (select 1 from public.processing_orders where id = p_order_id) then raise exception 'Processing order not found.'; end if;
  insert into public.machine_schedules (
    order_id, machine_name, shift_name, scheduled_date, allocated_hours, capacity_kg_per_hr, scheduled_by
  ) values (
    p_order_id, p_machine_name, p_shift_name, p_scheduled_date,
    p_allocated_hours, p_capacity_kg_per_hr, (select auth.uid())
  ) returning id into v_schedule_id;
  return v_schedule_id;
end;
$$;

revoke all on function public.list_eligible_processing_lots(uuid),
  public.record_invoice_payment(uuid, numeric, text),
  public.create_dispatch_draft(jsonb, jsonb),
  public.schedule_processing_machine(uuid, text, text, date, numeric, numeric)
from public, anon;
grant execute on function public.list_eligible_processing_lots(uuid),
  public.record_invoice_payment(uuid, numeric, text),
  public.create_dispatch_draft(jsonb, jsonb),
  public.schedule_processing_machine(uuid, text, text, date, numeric, numeric)
to authenticated;
