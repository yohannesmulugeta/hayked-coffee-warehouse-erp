-- Simplified, task-focused ERP controls.
-- This migration is additive and preserves all historic client, stock, and
-- finance records. Posted warehouse movements remain immutable.

alter table public.payments
  add column if not exists payment_method text not null default 'BANK_TRANSFER'
    check (payment_method in ('BANK_TRANSFER', 'CASH', 'CHEQUE', 'MOBILE_MONEY', 'OTHER')),
  add column if not exists payer_name text,
  add column if not exists financial_institution text,
  add column if not exists payment_note text;

create or replace function public.update_client_profile(
  p_client_id uuid,
  p_client jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients;
  v_previous jsonb;
begin
  perform private.require_role('system_admin', 'warehouse_manager');
  if jsonb_typeof(p_client) <> 'object' then
    raise exception 'Client details are required.';
  end if;

  select * into v_client from public.clients where id = p_client_id for update;
  if not found then raise exception 'Client not found.'; end if;
  if nullif(btrim(p_client ->> 'code'), '') is null
    or nullif(btrim(p_client ->> 'legalName'), '') is null then
    raise exception 'Client code and legal name are required.';
  end if;

  v_previous := jsonb_build_object(
    'code', v_client.code, 'legal_name', v_client.legal_name,
    'tin', v_client.tin, 'phone', v_client.phone,
    'email', v_client.email, 'active', v_client.active
  );

  update public.clients set
    code = btrim(p_client ->> 'code'),
    legal_name = btrim(p_client ->> 'legalName'),
    tin = nullif(btrim(p_client ->> 'tin'), ''),
    phone = nullif(btrim(p_client ->> 'phone'), ''),
    email = nullif(btrim(p_client ->> 'email'), ''),
    active = coalesce((p_client ->> 'active')::boolean, active)
  where id = p_client_id
  returning * into v_client;

  perform private.record_audit('CLIENT_UPDATED', 'CLIENT', v_client.id,
    jsonb_build_object(
      'before', v_previous,
      'after', jsonb_build_object(
        'code', v_client.code, 'legal_name', v_client.legal_name,
        'tin', v_client.tin, 'phone', v_client.phone,
        'email', v_client.email, 'active', v_client.active
      )
    ));

  return jsonb_build_object(
    'id', v_client.id, 'code', v_client.code,
    'legal_name', v_client.legal_name, 'active', v_client.active
  );
end;
$$;

create or replace function public.update_dispatch_readiness(
  p_dispatch_id uuid,
  p_document_reference text,
  p_weighbridge_reference text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dispatch public.dispatch_orders;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer');
  select * into v_dispatch from public.dispatch_orders where id = p_dispatch_id for update;
  if not found then raise exception 'Dispatch record not found.'; end if;
  if v_dispatch.status not in ('DRAFT', 'AWAITING_APPROVAL') then
    raise exception 'Only a draft or awaiting-approval dispatch can be corrected.';
  end if;

  update public.dispatch_orders set
    documents_reference = nullif(btrim(p_document_reference), ''),
    documents_ready = nullif(btrim(p_document_reference), '') is not null,
    weighbridge_reference = nullif(btrim(p_weighbridge_reference), ''),
    weighbridge_ready = nullif(btrim(p_weighbridge_reference), '') is not null,
    notes = nullif(btrim(coalesce(p_notes, notes)), '')
  where id = p_dispatch_id
  returning * into v_dispatch;

  perform private.record_audit('DISPATCH_READINESS_UPDATED', 'DISPATCH_ORDER', v_dispatch.id,
    jsonb_build_object(
      'dispatch_number', v_dispatch.dispatch_number,
      'document_reference', v_dispatch.documents_reference,
      'weighbridge_reference', v_dispatch.weighbridge_reference
    ));
  return jsonb_build_object('id', v_dispatch.id, 'dispatch_number', v_dispatch.dispatch_number);
end;
$$;

create or replace function public.record_invoice_payment_v2(
  p_invoice_id uuid,
  p_amount_etb numeric,
  p_reference text,
  p_paid_at timestamptz default now(),
  p_payment_method text default 'BANK_TRANSFER',
  p_payer_name text default null,
  p_financial_institution text default null,
  p_note text default null
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
  v_reference text := nullif(btrim(p_reference), '');
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'finance_officer');
  if p_payment_method not in ('BANK_TRANSFER', 'CASH', 'CHEQUE', 'MOBILE_MONEY', 'OTHER') then
    raise exception 'Choose a valid payment method.';
  end if;
  if p_paid_at > now() + interval '5 minutes' then
    raise exception 'Payment date cannot be in the future.';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found or v_invoice.status not in ('ISSUED', 'PARTIALLY_PAID') then
    raise exception 'Only an open issued invoice can receive payment.';
  end if;
  if p_amount_etb <= 0 or v_reference is null then
    raise exception 'A positive amount and payment reference are required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_invoice.client_id::text || '|' || lower(v_reference), 0)
  );
  if exists (
    select 1 from public.payments payment
    where payment.client_id = v_invoice.client_id
      and lower(payment.bank_reference) = lower(v_reference)
      and payment.direction = 'PAYMENT'
  ) then raise exception 'This payment reference has already been recorded for the client.'; end if;

  select coalesce(sum(case when payment.direction = 'PAYMENT' then payment.amount_etb else -payment.amount_etb end), 0)
  into v_paid_total from public.payments payment where payment.invoice_id = v_invoice.id;
  if p_amount_etb > v_invoice.total_etb - v_paid_total then
    raise exception 'Payment exceeds the outstanding invoice balance.';
  end if;

  insert into public.payments (
    payment_number, invoice_id, client_id, amount_etb, paid_at, bank_reference,
    payment_method, payer_name, financial_institution, payment_note, recorded_by
  ) values (
    public.next_erp_number('PAYMENT', 'GEL', extract(year from p_paid_at)::integer),
    v_invoice.id, v_invoice.client_id, p_amount_etb, p_paid_at, v_reference,
    p_payment_method, nullif(btrim(p_payer_name), ''),
    nullif(btrim(p_financial_institution), ''), nullif(btrim(p_note), ''),
    (select auth.uid())
  ) returning * into v_payment;

  v_paid_total := v_paid_total + p_amount_etb;
  update public.invoices
  set status = case when v_paid_total = total_etb then 'PAID' else 'PARTIALLY_PAID' end
  where id = v_invoice.id;

  perform private.record_audit('PAYMENT_RECORDED', 'INVOICE', v_invoice.id,
    jsonb_build_object(
      'payment_id', v_payment.id, 'payment_number', v_payment.payment_number,
      'amount_etb', p_amount_etb, 'payment_method', p_payment_method,
      'payment_reference', v_reference
    ));
  return jsonb_build_object(
    'id', v_payment.id, 'payment_number', v_payment.payment_number,
    'invoice_status', case when v_paid_total = v_invoice.total_etb then 'PAID' else 'PARTIALLY_PAID' end
  );
end;
$$;

-- ECX checks must be completed before a submitted processing request can be
-- approved. NOT_REQUIRED is an explicit, auditable decision rather than a
-- missing check.
create or replace function public.transition_processing_request(request_id uuid, target_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.processing_requests;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  select * into v_request from public.processing_requests where id = request_id for update;
  if not found then raise exception 'Processing request not found'; end if;

  if v_request.status = 'DRAFT' and target_status = 'SUBMITTED' then
    update public.processing_requests set status = 'SUBMITTED' where id = request_id;
    insert into public.approvals (request_type, reference_id, requested_by)
    values ('PROCESSING_REQUEST', request_id, (select auth.uid()));
  elsif v_request.status = 'SUBMITTED' and target_status in ('APPROVED', 'REJECTED') then
    if v_request.created_by = (select auth.uid()) then
      raise exception 'The requester cannot decide the same request';
    end if;
    if target_status = 'APPROVED' and not exists (
      select 1 from public.ecx_checks check_record
      where check_record.processing_request_id = request_id
        and check_record.result in ('PASSED', 'NOT_REQUIRED')
    ) then
      raise exception 'Complete the ECX check, or mark it not required, before approval.';
    end if;
    update public.processing_requests
    set status = target_status,
      approved_by = case when target_status = 'APPROVED' then (select auth.uid()) else null end
    where id = request_id;
    update public.approvals
    set status = target_status, decided_by = (select auth.uid()), decided_at = now()
    where request_type = 'PROCESSING_REQUEST' and reference_id = request_id and status = 'PENDING';
  else
    raise exception 'Invalid processing request transition from % to %', v_request.status, target_status;
  end if;

  perform private.record_audit('PROCESSING_REQUEST_' || target_status, 'PROCESSING_REQUEST', request_id,
    jsonb_build_object('from', v_request.status, 'to', target_status));
  return jsonb_build_object('id', request_id, 'status', target_status);
end;
$$;

revoke all on function public.update_client_profile(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.update_dispatch_readiness(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.record_invoice_payment_v2(uuid, numeric, text, timestamptz, text, text, text, text) from public, anon, authenticated;
revoke all on function public.transition_processing_request(uuid, text) from public, anon, authenticated;

grant execute on function public.update_client_profile(uuid, jsonb) to authenticated;
grant execute on function public.update_dispatch_readiness(uuid, text, text, text) to authenticated;
grant execute on function public.record_invoice_payment_v2(uuid, numeric, text, timestamptz, text, text, text, text) to authenticated;
grant execute on function public.transition_processing_request(uuid, text) to authenticated;
