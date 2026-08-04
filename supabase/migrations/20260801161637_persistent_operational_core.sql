alter table public.processing_orders
  add column if not exists request_id uuid unique references public.processing_requests(id);

alter table public.warehouse_receipts
  add column if not exists section text not null default 'A-01 Arrival',
  add column if not exists driver_name text,
  add column if not exists seal_number text,
  add column if not exists weighbridge_reference text,
  add column if not exists origin text,
  add column if not exists grade text,
  add column if not exists crop_year integer check (crop_year between 1900 and 2200),
  add column if not exists bag_weight_kg numeric(10,3) check (bag_weight_kg > 0),
  add column if not exists gross_weight_kg numeric(16,3) check (gross_weight_kg > 0),
  add column if not exists tare_weight_kg numeric(16,3) check (tare_weight_kg >= 0),
  add column if not exists moisture_percent numeric(6,3) check (moisture_percent between 0 and 100),
  add column if not exists wet_coffee boolean not null default false,
  add constraint warehouse_receipts_measured_net_check
    check (gross_weight_kg is null or tare_weight_kg is null or abs(gross_weight_kg - tare_weight_kg - net_weight_kg) <= 0.01);

create or replace function private.prevent_final_record_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_table_name = 'invoices' and tg_op = 'UPDATE'
    and old.status in ('ISSUED', 'PARTIALLY_PAID')
    and new.status in ('PARTIALLY_PAID', 'PAID') then
    return new;
  end if;
  if old.status in ('POSTED', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID', 'SUPERSEDED') then
    raise exception 'Finalized % records are immutable; create a new version or compensating entry', tg_table_name;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.require_role(variadic required_roles text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select private.has_role(variadic required_roles)) then
    raise exception 'You do not have permission to perform this action';
  end if;
end;
$$;
revoke all on function private.require_role(text[]) from public, anon, authenticated;

create or replace function private.record_audit(
  action_name text,
  reference_name text,
  reference_uuid uuid,
  details jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_events (organization_id, actor_id, action, reference_type, reference_id, event_data)
  select organization_id, id, action_name, reference_name, reference_uuid, details
  from public.profiles
  where id = (select auth.uid());
$$;
revoke all on function private.record_audit(text, text, uuid, jsonb) from public, anon, authenticated;

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
    insert into public.coffee_lots (
      lot_number, warehouse_id, client_id, receipt_id, coffee_type, bag_count, quantity_kg, section, status
    ) values (
      lot_number, receipt.warehouse_id, receipt.client_id, receipt.id, receipt.coffee_type,
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
    update public.coffee_lots set quantity_kg = 0, bag_count = 0, status = 'CLOSED' where id = lot.id;
    update public.warehouse_receipts set status = 'REVERSED' where id = receipt_id;
  else
    raise exception 'Invalid GRN transition from % to %', receipt.status, target_status;
  end if;

  perform private.record_audit('GRN_' || target_status, 'WAREHOUSE_RECEIPT', receipt_id,
    jsonb_build_object('from', receipt.status, 'to', target_status, 'reason', reversal_reason));
  return jsonb_build_object('id', receipt_id, 'status', target_status, 'lot_id', lot.id, 'lot_number', lot.lot_number);
end;
$$;

create or replace function public.transition_processing_request(request_id uuid, target_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.processing_requests;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  select * into request from public.processing_requests where id = request_id for update;
  if not found then raise exception 'Processing request not found'; end if;

  if request.status = 'DRAFT' and target_status = 'SUBMITTED' then
    update public.processing_requests set status = 'SUBMITTED' where id = request_id;
    insert into public.approvals (request_type, reference_id, requested_by)
    values ('PROCESSING_REQUEST', request_id, (select auth.uid()));
  elsif request.status = 'SUBMITTED' and target_status in ('APPROVED', 'REJECTED') then
    if request.created_by = (select auth.uid()) then raise exception 'The requester cannot decide the same request'; end if;
    update public.processing_requests
      set status = target_status, approved_by = case when target_status = 'APPROVED' then (select auth.uid()) else null end
      where id = request_id;
    update public.approvals
      set status = target_status, decided_by = (select auth.uid()), decided_at = now()
      where request_type = 'PROCESSING_REQUEST' and reference_id = request_id and status = 'PENDING';
  else
    raise exception 'Invalid processing request transition from % to %', request.status, target_status;
  end if;

  perform private.record_audit('PROCESSING_REQUEST_' || target_status, 'PROCESSING_REQUEST', request_id,
    jsonb_build_object('from', request.status, 'to', target_status));
  return jsonb_build_object('id', request_id, 'status', target_status);
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
  new_order public.processing_orders;
  next_position integer;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  select * into request from public.processing_requests where id = request_id for update;
  if not found or request.status <> 'APPROVED' then raise exception 'Only approved requests can enter the queue'; end if;
  if request.queued_order_id is not null then raise exception 'This request is already queued'; end if;
  if request.client_id is null or request.lot_id is null then raise exception 'The request must be linked to a client and coffee lot before queueing'; end if;
  select coalesce(max(queue_position), 0) + 1 into next_position
    from public.processing_orders where status in ('QUEUED', 'BLOCKED', 'IN_PROCESS');
  insert into public.processing_orders (
    order_number, request_id, lot_id, client_id, queue_position, input_kg,
    allowance_percent, status, prepared_by
  ) values (
    'PRO-' || replace(request.request_note_number, ' ', '-'), request.id, request.lot_id, request.client_id,
    next_position, request.requested_kg, case when request.coffee_type = 'WASHED' then 22.5 else 2.5 end,
    'QUEUED', request.created_by
  ) returning * into new_order;
  update public.processing_requests set queued_order_id = new_order.id where id = request.id;
  update public.coffee_lots set status = 'WAITING_PROCESSING' where id = request.lot_id;
  perform private.record_audit('PROCESSING_QUEUED', 'PROCESSING_ORDER', new_order.id,
    jsonb_build_object('request_id', request.id, 'queue_position', next_position));
  return jsonb_build_object('id', new_order.id, 'order_number', new_order.order_number, 'queue_position', next_position);
end;
$$;

create or replace function public.start_processing_order(order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  processing public.processing_orders;
  lot public.coffee_lots;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  select * into processing from public.processing_orders where id = order_id for update;
  if not found or processing.status <> 'QUEUED' then raise exception 'Only a queued order can start'; end if;
  select * into lot from public.coffee_lots where id = processing.lot_id for update;
  if lot.quantity_kg < processing.input_kg then raise exception 'Insufficient lot stock'; end if;
  insert into public.stock_movements (
    lot_id, warehouse_id, client_id, movement_type, quantity_kg, reference_type, reference_id, reason, posted_by
  ) values (
    lot.id, lot.warehouse_id, lot.client_id, 'PROCESS_INPUT', -processing.input_kg,
    'PROCESSING_ORDER', processing.id, 'Processing input issued', (select auth.uid())
  );
  update public.coffee_lots set quantity_kg = quantity_kg - processing.input_kg, status = 'IN_PROCESS' where id = lot.id;
  update public.processing_orders set status = 'IN_PROCESS', started_at = now() where id = processing.id;
  perform private.record_audit('PROCESSING_STARTED', 'PROCESSING_ORDER', processing.id,
    jsonb_build_object('input_kg', processing.input_kg));
  return jsonb_build_object('id', processing.id, 'status', 'IN_PROCESS');
end;
$$;

create or replace function public.complete_processing_order(
  order_id uuid,
  accepted_kg numeric,
  reject_kg numeric,
  byproduct_kg numeric,
  loss_kg numeric,
  evidence_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  processing public.processing_orders;
  lot public.coffee_lots;
  byproduct_lot public.coffee_lots;
  output_kg numeric;
  allowance_kg numeric;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  select * into processing from public.processing_orders where id = order_id for update;
  if not found or processing.status <> 'IN_PROCESS' then raise exception 'Only an active order can be completed'; end if;
  if processing.prepared_by = (select auth.uid()) then raise exception 'The order preparer cannot approve completion'; end if;
  if least(accepted_kg, reject_kg, byproduct_kg, loss_kg) < 0 then raise exception 'Completion weights cannot be negative'; end if;
  output_kg := accepted_kg + reject_kg + byproduct_kg + loss_kg;
  if abs(processing.input_kg - output_kg) > 0.01 then raise exception 'Processing output must reconcile to input within 0.01 kg'; end if;
  allowance_kg := case when processing.allowance_percent = 22.5 then byproduct_kg + loss_kg else loss_kg end;
  if allowance_kg > processing.input_kg * processing.allowance_percent / 100 and nullif(btrim(evidence_path), '') is null then
    raise exception 'Allowance exceptions require evidence';
  end if;
  if processing.allowance_percent = 2.5 and byproduct_kg > 0 and nullif(btrim(evidence_path), '') is null then
    raise exception 'Unwashed byproduct requires approved evidence';
  end if;

  select * into lot from public.coffee_lots where id = processing.lot_id for update;
  if accepted_kg + reject_kg > 0 then
    insert into public.stock_movements (
      lot_id, warehouse_id, client_id, movement_type, quantity_kg, reference_type, reference_id, reason, posted_by
    ) values (
      lot.id, lot.warehouse_id, lot.client_id, 'PROCESS_OUTPUT', accepted_kg + reject_kg,
      'PROCESSING_ORDER', processing.id, 'Accepted coffee and client rejects', (select auth.uid())
    );
  end if;
  update public.coffee_lots
    set quantity_kg = quantity_kg + accepted_kg + reject_kg, status = 'PROCESSED'
    where id = lot.id;

  if byproduct_kg > 0 then
    insert into public.coffee_lots (
      lot_number, warehouse_id, client_id, parent_lot_id, coffee_type, ownership_type,
      quantity_kg, section, status
    ) values (
      processing.order_number || '-BYP', lot.warehouse_id, lot.client_id, lot.id, lot.coffee_type,
      'HAYKED', byproduct_kg, lot.section, 'PROCESSED'
    ) returning * into byproduct_lot;
    insert into public.stock_movements (
      lot_id, warehouse_id, client_id, movement_type, quantity_kg, reference_type, reference_id, reason, posted_by
    ) values (
      byproduct_lot.id, byproduct_lot.warehouse_id, null, 'PROCESS_OUTPUT', byproduct_kg,
      'PROCESSING_ORDER', processing.id, 'Hayked processing byproduct', (select auth.uid())
    );
  end if;

  update public.processing_orders set
    accepted_client_kg = accepted_kg,
    client_reject_kg = reject_kg,
    hayked_byproduct_kg = byproduct_kg,
    process_loss_kg = loss_kg,
    exception_evidence_path = evidence_path,
    status = 'POSTED', approved_by = (select auth.uid()), completed_at = now()
  where id = processing.id;
  perform private.record_audit('PROCESSING_COMPLETED', 'PROCESSING_ORDER', processing.id,
    jsonb_build_object('accepted_kg', accepted_kg, 'reject_kg', reject_kg, 'byproduct_kg', byproduct_kg, 'loss_kg', loss_kg));
  return jsonb_build_object('id', processing.id, 'status', 'POSTED', 'byproduct_lot_id', byproduct_lot.id);
end;
$$;

create or replace function public.post_dispatch(dispatch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  dispatch public.dispatch_orders;
  lot public.coffee_lots;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer');
  select * into dispatch from public.dispatch_orders where id = dispatch_id for update;
  if not found or dispatch.status <> 'APPROVED' then raise exception 'Only an approved dispatch can be posted'; end if;
  if dispatch.approved_by is null or dispatch.approved_by = dispatch.prepared_by then raise exception 'Independent dispatch approval is required'; end if;
  if not (dispatch.invoices_paid or dispatch.credit_approved) or not dispatch.documents_ready or not dispatch.weighbridge_ready or dispatch.legal_or_quality_hold then
    raise exception 'Dispatch release gates are incomplete';
  end if;
  select * into lot from public.coffee_lots where id = dispatch.lot_id for update;
  if lot.quantity_kg < dispatch.quantity_kg then raise exception 'Insufficient lot stock'; end if;
  insert into public.stock_movements (
    lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta,
    reference_type, reference_id, reason, posted_by
  ) values (
    lot.id, lot.warehouse_id, lot.client_id, 'DISPATCH', -dispatch.quantity_kg, -dispatch.bag_count,
    'DISPATCH_ORDER', dispatch.id, 'Approved dispatch posted', (select auth.uid())
  );
  update public.coffee_lots set quantity_kg = quantity_kg - dispatch.quantity_kg,
    bag_count = greatest(0, bag_count - dispatch.bag_count),
    status = case when quantity_kg - dispatch.quantity_kg <= 0.01 then 'DISPATCHED' else 'AWAITING_DISPATCH' end
    where id = lot.id;
  update public.dispatch_orders set status = 'POSTED', posted_at = now() where id = dispatch.id;
  perform private.record_audit('DISPATCH_POSTED', 'DISPATCH_ORDER', dispatch.id,
    jsonb_build_object('quantity_kg', dispatch.quantity_kg, 'bag_count', dispatch.bag_count));
  return jsonb_build_object('id', dispatch.id, 'status', 'POSTED');
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
  invoice public.invoices;
  payment public.payments;
  paid_total numeric;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'finance_officer');
  select * into invoice from public.invoices where id = invoice_id for update;
  if not found or invoice.status not in ('ISSUED', 'PARTIALLY_PAID') then raise exception 'Only an open issued invoice can receive payment'; end if;
  if amount_etb <= 0 or nullif(btrim(bank_reference), '') is null then raise exception 'A positive amount and bank reference are required'; end if;
  insert into public.payments (payment_number, invoice_id, client_id, amount_etb, paid_at, bank_reference, recorded_by)
    values ('PAY-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'), invoice.id, invoice.client_id,
      amount_etb, now(), bank_reference, (select auth.uid())) returning * into payment;
  select coalesce(sum(case when pmt.direction = 'PAYMENT' then pmt.amount_etb else -pmt.amount_etb end), 0)
    into paid_total from public.payments pmt where pmt.invoice_id = invoice.id;
  update public.invoices set status = case when paid_total >= total_etb then 'PAID' else 'PARTIALLY_PAID' end where id = invoice.id;
  perform private.record_audit('PAYMENT_RECORDED', 'INVOICE', invoice.id,
    jsonb_build_object('payment_id', payment.id, 'amount_etb', amount_etb, 'bank_reference', bank_reference));
  return jsonb_build_object('id', payment.id, 'payment_number', payment.payment_number, 'invoice_status', case when paid_total >= invoice.total_etb then 'PAID' else 'PARTIALLY_PAID' end);
end;
$$;

create or replace function public.decide_approval(approval_id uuid, decision text, note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  approval public.approvals;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'finance_officer');
  if decision not in ('APPROVED', 'REJECTED') then raise exception 'Decision must be APPROVED or REJECTED'; end if;
  select * into approval from public.approvals where id = approval_id for update;
  if not found or approval.status <> 'PENDING' then raise exception 'Only a pending approval can be decided'; end if;
  if approval.requested_by = (select auth.uid()) then raise exception 'The requester cannot decide the same approval'; end if;
  update public.approvals set status = decision, decided_by = (select auth.uid()), decided_at = now(), decision_note = note where id = approval.id;
  perform private.record_audit('APPROVAL_' || decision, 'APPROVAL', approval.id,
    jsonb_build_object('request_type', approval.request_type, 'reference_id', approval.reference_id, 'note', note));
  return jsonb_build_object('id', approval.id, 'status', decision);
end;
$$;

revoke all on function public.transition_grn(uuid, text, text, text) from public, anon;
revoke all on function public.transition_processing_request(uuid, text) from public, anon;
revoke all on function public.queue_processing_request(uuid) from public, anon;
revoke all on function public.start_processing_order(uuid) from public, anon;
revoke all on function public.complete_processing_order(uuid, numeric, numeric, numeric, numeric, text) from public, anon;
revoke all on function public.post_dispatch(uuid) from public, anon;
revoke all on function public.record_invoice_payment(uuid, numeric, text) from public, anon;
revoke all on function public.decide_approval(uuid, text, text) from public, anon;

grant execute on function public.transition_grn(uuid, text, text, text) to authenticated;
grant execute on function public.transition_processing_request(uuid, text) to authenticated;
grant execute on function public.queue_processing_request(uuid) to authenticated;
grant execute on function public.start_processing_order(uuid) to authenticated;
grant execute on function public.complete_processing_order(uuid, numeric, numeric, numeric, numeric, text) to authenticated;
grant execute on function public.post_dispatch(uuid) to authenticated;
grant execute on function public.record_invoice_payment(uuid, numeric, text) to authenticated;
grant execute on function public.decide_approval(uuid, text, text) to authenticated;

revoke update on public.warehouse_receipts, public.coffee_lots, public.processing_requests,
  public.processing_orders, public.dispatch_orders, public.invoices, public.approvals from authenticated;

create or replace function private.prevent_completed_processing_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status in ('POSTED', 'REVERSED') then
    raise exception 'Completed processing records are locked';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.prevent_completed_processing_mutation() from public, anon, authenticated;
create trigger processing_orders_completion_lock
  before update or delete on public.processing_orders
  for each row execute function private.prevent_completed_processing_mutation();
