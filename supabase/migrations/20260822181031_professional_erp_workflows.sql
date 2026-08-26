-- Professional workflow persistence for ECX checks and arrears management.
-- This migration is additive. Existing document numbers and financial records
-- are preserved; number sequences only move forward to observed maxima.

create table public.ecx_checks (
  id uuid primary key default gen_random_uuid(),
  check_number text not null unique,
  processing_request_id uuid not null references public.processing_requests(id),
  processing_order_id uuid references public.processing_orders(id),
  client_id uuid not null references public.clients(id),
  lot_id uuid references public.coffee_lots(id),
  checked_on date not null default current_date,
  result text not null default 'PENDING'
    check (result in ('PENDING', 'PASSED', 'FAILED', 'NOT_REQUIRED')),
  reference_number text,
  inspector_name text,
  notes text,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (processing_request_id)
);

create index ecx_checks_client_date_idx
  on public.ecx_checks (client_id, checked_on desc);
create index ecx_checks_result_idx
  on public.ecx_checks (result, checked_on desc);

create table public.arrears_cases (
  id uuid primary key default gen_random_uuid(),
  case_number text not null unique,
  client_id uuid not null references public.clients(id),
  invoice_id uuid not null references public.invoices(id),
  stage text not null default 'MONITORING'
    check (stage in ('MONITORING', 'PAYMENT_REMINDER', 'FORMAL_NOTICE',
      'MANAGEMENT_REVIEW', 'LEGAL_REVIEW', 'AGREED_SETTLEMENT', 'CLOSED')),
  outstanding_etb numeric(16,2) not null check (outstanding_etb >= 0),
  opened_on date not null default current_date,
  oldest_due_on date,
  next_action_on date,
  assigned_to uuid references public.profiles(id),
  notes text,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (stage <> 'CLOSED' or closed_at is not null)
);

create unique index arrears_cases_one_open_invoice_idx
  on public.arrears_cases (invoice_id) where stage <> 'CLOSED';
create index arrears_cases_client_stage_idx
  on public.arrears_cases (client_id, stage, oldest_due_on);

create table public.arrears_case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.arrears_cases(id) on delete restrict,
  from_stage text,
  to_stage text not null,
  note text not null check (char_length(btrim(note)) >= 3),
  action_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index arrears_case_events_case_date_idx
  on public.arrears_case_events (case_id, created_at desc);

alter table public.ecx_checks enable row level security;
alter table public.arrears_cases enable row level security;
alter table public.arrears_case_events enable row level security;

create policy ecx_checks_staff_read on public.ecx_checks
  for select to authenticated
  using ((select private.has_role('system_admin', 'warehouse_manager',
    'warehouse_officer', 'processing_supervisor', 'finance_officer', 'auditor', 'viewer')));
create policy arrears_cases_staff_read on public.arrears_cases
  for select to authenticated
  using ((select private.has_role('system_admin', 'warehouse_manager',
    'finance_officer', 'auditor', 'viewer')));
create policy arrears_case_events_staff_read on public.arrears_case_events
  for select to authenticated
  using ((select private.has_role('system_admin', 'warehouse_manager',
    'finance_officer', 'auditor', 'viewer')));

revoke all on public.ecx_checks, public.arrears_cases,
  public.arrears_case_events from public, anon, authenticated;
grant select on public.ecx_checks, public.arrears_cases,
  public.arrears_case_events to authenticated;

-- Bring every scoped counter forward to the largest number already stored.
-- Different historic prefixes are accepted; only the trailing digits matter.
with observed as (
  select warehouse.organization_id, receipt.warehouse_id, 'GRN'::text document_type,
    extract(year from receipt.arrival_at)::integer calendar_year,
    max(coalesce((substring(receipt.receipt_number from '([0-9]+)$'))::bigint, 0)) last_value
  from public.warehouse_receipts receipt
  join public.warehouses warehouse on warehouse.id = receipt.warehouse_id
  group by warehouse.organization_id, receipt.warehouse_id, extract(year from receipt.arrival_at)
  union all
  select client.organization_id, warehouse.id, 'LABOUR', extract(year from labour.work_date)::integer,
    max(coalesce((substring(labour.labour_number from '([0-9]+)$'))::bigint, 0))
  from public.labour_records labour
  join public.clients client on client.id = labour.client_id
  join public.warehouses warehouse on warehouse.organization_id = client.organization_id and warehouse.code = 'GEL'
  group by client.organization_id, warehouse.id, extract(year from labour.work_date)
  union all
  select client.organization_id, warehouse.id, 'INVOICE', extract(year from coalesce(invoice.issued_on, invoice.created_at::date))::integer,
    max(coalesce((substring(invoice.invoice_number from '([0-9]+)$'))::bigint, 0))
  from public.invoices invoice
  join public.clients client on client.id = invoice.client_id
  join public.warehouses warehouse on warehouse.organization_id = client.organization_id and warehouse.code = 'GEL'
  group by client.organization_id, warehouse.id, extract(year from coalesce(invoice.issued_on, invoice.created_at::date))
  union all
  select client.organization_id, warehouse.id, 'PAYMENT', extract(year from payment.paid_at)::integer,
    max(coalesce((substring(payment.payment_number from '([0-9]+)$'))::bigint, 0))
  from public.payments payment
  join public.clients client on client.id = payment.client_id
  join public.warehouses warehouse on warehouse.organization_id = client.organization_id and warehouse.code = 'GEL'
  group by client.organization_id, warehouse.id, extract(year from payment.paid_at)
)
insert into public.number_sequences (
  scope_key, organization_id, warehouse_id, document_type, calendar_year, last_value
)
select organization_id || '|' || warehouse_id || '|' || document_type || '|' || calendar_year,
  organization_id, warehouse_id, document_type, calendar_year, last_value
from observed
on conflict (scope_key) do update
set last_value = greatest(public.number_sequences.last_value, excluded.last_value),
  updated_at = now();

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
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer',
    'processing_supervisor', 'finance_officer');
  if document_type not in ('GRN', 'PROCESSING_REQUEST', 'PROCESSING_ORDER',
    'PROCESSING_INTAKE', 'PROCESSING_COMPLETION', 'DISPATCH', 'INVOICE',
    'PAYMENT', 'DOCUMENT', 'LABOUR', 'ECX_CHECK', 'ARREARS') then
    raise exception 'Unsupported document number type';
  end if;
  if calendar_year < 2000 or calendar_year > 2200 then
    raise exception 'Invalid document year';
  end if;

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
    when 'ECX_CHECK' then 'ECX'
    when 'ARREARS' then 'ARR'
    else document_type
  end;
  return prefix || '-' || warehouse.code || '-' || calendar_year || '-' || lpad(next_value::text, 4, '0');
end;
$$;

create function public.create_ecx_check(
  p_processing_request_id uuid,
  p_checked_on date,
  p_result text,
  p_reference_number text default null,
  p_inspector_name text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.processing_requests;
  v_check public.ecx_checks;
begin
  perform private.require_role('system_admin', 'warehouse_manager',
    'warehouse_officer', 'processing_supervisor');
  select * into v_request from public.processing_requests
  where id = p_processing_request_id;
  if not found then raise exception 'Processing request not found.'; end if;
  if p_result not in ('PENDING', 'PASSED', 'FAILED', 'NOT_REQUIRED') then
    raise exception 'Invalid ECX check result.';
  end if;
  if p_result in ('PASSED', 'FAILED') and nullif(btrim(p_reference_number), '') is null then
    raise exception 'ECX reference number is required for a completed check.';
  end if;

  insert into public.ecx_checks (
    check_number, processing_request_id, processing_order_id, client_id, lot_id,
    checked_on, result, reference_number, inspector_name, notes, created_by, updated_by
  ) values (
    public.next_erp_number('ECX_CHECK', 'GEL', extract(year from p_checked_on)::integer),
    v_request.id, v_request.queued_order_id, v_request.client_id, v_request.lot_id,
    p_checked_on, p_result, nullif(btrim(p_reference_number), ''),
    nullif(btrim(p_inspector_name), ''), nullif(btrim(p_notes), ''),
    (select auth.uid()), (select auth.uid())
  ) returning * into v_check;

  perform private.record_audit('ECX_CHECK_CREATED', 'ECX_CHECK', v_check.id,
    jsonb_build_object('check_number', v_check.check_number, 'result', v_check.result,
      'processing_request_id', v_check.processing_request_id));
  return to_jsonb(v_check);
end;
$$;

create function public.update_ecx_check(
  p_check_id uuid,
  p_checked_on date,
  p_result text,
  p_reference_number text default null,
  p_inspector_name text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check public.ecx_checks;
  v_previous text;
begin
  perform private.require_role('system_admin', 'warehouse_manager',
    'warehouse_officer', 'processing_supervisor');
  select * into v_check from public.ecx_checks where id = p_check_id for update;
  if not found then raise exception 'ECX check not found.'; end if;
  if p_result not in ('PENDING', 'PASSED', 'FAILED', 'NOT_REQUIRED') then
    raise exception 'Invalid ECX check result.';
  end if;
  if p_result in ('PASSED', 'FAILED') and nullif(btrim(p_reference_number), '') is null then
    raise exception 'ECX reference number is required for a completed check.';
  end if;
  v_previous := v_check.result;
  update public.ecx_checks set checked_on = p_checked_on, result = p_result,
    reference_number = nullif(btrim(p_reference_number), ''),
    inspector_name = nullif(btrim(p_inspector_name), ''),
    notes = nullif(btrim(p_notes), ''), updated_by = (select auth.uid()), updated_at = now()
  where id = p_check_id returning * into v_check;
  perform private.record_audit('ECX_CHECK_UPDATED', 'ECX_CHECK', v_check.id,
    jsonb_build_object('from', v_previous, 'to', v_check.result,
      'check_number', v_check.check_number));
  return to_jsonb(v_check);
end;
$$;

create function public.create_arrears_case(
  p_invoice_id uuid,
  p_next_action_on date default null,
  p_assigned_to uuid default null,
  p_note text default 'Case opened for overdue invoice review.'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_case public.arrears_cases;
  v_paid numeric;
  v_outstanding numeric;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'finance_officer');
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if not found then raise exception 'Invoice not found.'; end if;
  if v_invoice.status in ('DRAFT', 'VOID', 'PAID') then
    raise exception 'Only issued unpaid invoices can open an arrears case.';
  end if;
  if v_invoice.due_on is null or v_invoice.due_on >= current_date then
    raise exception 'The invoice is not overdue.';
  end if;
  select coalesce(sum(case when direction = 'REVERSAL' then -amount_etb else amount_etb end), 0)
    into v_paid from public.payments where invoice_id = v_invoice.id;
  v_outstanding := greatest(0, v_invoice.total_etb - v_paid);
  if v_outstanding <= 0 then raise exception 'The invoice has no outstanding balance.'; end if;

  insert into public.arrears_cases (
    case_number, client_id, invoice_id, stage, outstanding_etb, opened_on,
    oldest_due_on, next_action_on, assigned_to, notes, created_by, updated_by
  ) values (
    public.next_erp_number('ARREARS', 'GEL', extract(year from current_date)::integer),
    v_invoice.client_id, v_invoice.id, 'MONITORING', v_outstanding, current_date,
    v_invoice.due_on, p_next_action_on, p_assigned_to, nullif(btrim(p_note), ''),
    (select auth.uid()), (select auth.uid())
  ) returning * into v_case;
  insert into public.arrears_case_events (case_id, from_stage, to_stage, note, action_by)
  values (v_case.id, null, 'MONITORING', coalesce(nullif(btrim(p_note), ''),
    'Case opened for overdue invoice review.'), (select auth.uid()));
  perform private.record_audit('ARREARS_CASE_OPENED', 'ARREARS_CASE', v_case.id,
    jsonb_build_object('case_number', v_case.case_number, 'invoice_id', v_case.invoice_id,
      'outstanding_etb', v_case.outstanding_etb));
  return to_jsonb(v_case);
end;
$$;

create function public.advance_arrears_case(
  p_case_id uuid,
  p_target_stage text,
  p_note text,
  p_next_action_on date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.arrears_cases;
  v_allowed boolean := false;
  v_previous text;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'finance_officer');
  select * into v_case from public.arrears_cases where id = p_case_id for update;
  if not found then raise exception 'Arrears case not found.'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'A short action note is required.';
  end if;
  v_allowed := case v_case.stage
    when 'MONITORING' then p_target_stage in ('PAYMENT_REMINDER', 'CLOSED')
    when 'PAYMENT_REMINDER' then p_target_stage in ('FORMAL_NOTICE', 'AGREED_SETTLEMENT', 'CLOSED')
    when 'FORMAL_NOTICE' then p_target_stage in ('MANAGEMENT_REVIEW', 'AGREED_SETTLEMENT', 'CLOSED')
    when 'MANAGEMENT_REVIEW' then p_target_stage in ('LEGAL_REVIEW', 'AGREED_SETTLEMENT', 'CLOSED')
    when 'LEGAL_REVIEW' then p_target_stage in ('AGREED_SETTLEMENT', 'CLOSED')
    when 'AGREED_SETTLEMENT' then p_target_stage = 'CLOSED'
    else false end;
  if not v_allowed then
    raise exception 'Invalid arrears transition from % to %.', v_case.stage, p_target_stage;
  end if;
  v_previous := v_case.stage;
  update public.arrears_cases set stage = p_target_stage, notes = btrim(p_note),
    next_action_on = p_next_action_on, updated_by = (select auth.uid()), updated_at = now(),
    closed_at = case when p_target_stage = 'CLOSED' then now() else null end
  where id = p_case_id returning * into v_case;
  insert into public.arrears_case_events (case_id, from_stage, to_stage, note, action_by)
  values (v_case.id, v_previous, p_target_stage, btrim(p_note), (select auth.uid()));
  perform private.record_audit('ARREARS_STAGE_CHANGED', 'ARREARS_CASE', v_case.id,
    jsonb_build_object('from', v_previous, 'to', p_target_stage, 'note', btrim(p_note)));
  return to_jsonb(v_case);
end;
$$;

revoke all on function public.next_erp_number(text, text, integer),
  public.create_ecx_check(uuid, date, text, text, text, text),
  public.update_ecx_check(uuid, date, text, text, text, text),
  public.create_arrears_case(uuid, date, uuid, text),
  public.advance_arrears_case(uuid, text, text, date)
from public, anon;

grant execute on function public.next_erp_number(text, text, integer),
  public.create_ecx_check(uuid, date, text, text, text, text),
  public.update_ecx_check(uuid, date, text, text, text, text),
  public.create_arrears_case(uuid, date, uuid, text),
  public.advance_arrears_case(uuid, text, text, date)
to authenticated;
