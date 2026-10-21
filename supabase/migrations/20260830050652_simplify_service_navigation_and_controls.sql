-- Add controlled edits and explicitly recorded client services.
-- Nothing in this migration creates a processing charge from a processing
-- status change. A service event exists only after a staff member calls the
-- manual service RPC below.

alter table public.service_events
  drop constraint if exists service_events_service_type_check;
alter table public.service_events
  add constraint service_events_service_type_check
  check (service_type in (
    'STORAGE', 'BAG_PRINTING', 'GENERATOR', 'LABOUR', 'PROCESSING',
    'HULLING', 'CLEANING', 'TRANSPORT', 'OTHER'
  ));

alter table public.service_events
  add column if not exists service_date date not null default current_date,
  add column if not exists unit_label text not null default 'unit',
  add column if not exists reference_type text;

create table public.manual_service_records (
  id uuid primary key default gen_random_uuid(),
  service_number text not null unique,
  client_id uuid not null references public.clients(id),
  processing_order_id uuid references public.processing_orders(id),
  service_code text not null check (service_code in (
    'PROCESSING', 'HULLING', 'CLEANING', 'TRANSPORT', 'OTHER'
  )),
  service_date date not null,
  description text not null check (char_length(btrim(description)) >= 3),
  quantity numeric(16,3) not null check (quantity > 0),
  unit_label text not null check (char_length(btrim(unit_label)) >= 1),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  total_amount numeric(16,2) not null check (total_amount >= 0),
  approved_by uuid not null references public.profiles(id),
  evidence_reference text,
  note text,
  service_event_id uuid not null unique references public.service_events(id),
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create unique index manual_processing_service_once_idx
  on public.manual_service_records (processing_order_id, service_code)
  where processing_order_id is not null;
create index manual_service_client_date_idx
  on public.manual_service_records (client_id, service_date desc);

alter table public.manual_service_records enable row level security;
create policy manual_service_staff_read on public.manual_service_records
  for select to authenticated
  using ((select private.has_role(
    'system_admin', 'warehouse_manager', 'processing_supervisor',
    'finance_officer', 'auditor', 'viewer'
  )));
revoke all on public.manual_service_records from public, anon, authenticated;
grant select on public.manual_service_records to authenticated;

create or replace function public.update_client_agreement(
  p_agreement_id uuid,
  p_effective_from date,
  p_effective_to date,
  p_status text,
  p_default_bag_weight_kg numeric,
  p_tariff_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.agreements;
  v_after public.agreements;
begin
  perform private.require_role('system_admin', 'warehouse_manager');
  select agreement.* into v_before
  from public.agreements agreement
  join public.clients client on client.id = agreement.client_id
  join public.profiles profile on profile.id = (select auth.uid())
  where agreement.id = p_agreement_id
    and client.organization_id = profile.organization_id
  for update of agreement;
  if not found then raise exception 'Agreement not found in your organization.'; end if;
  if p_status not in ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED') then
    raise exception 'Choose a valid agreement status.';
  end if;
  if p_effective_to is null or p_effective_to < p_effective_from then
    raise exception 'Agreement expiry must be on or after its effective date.';
  end if;
  if p_default_bag_weight_kg <= 0 then raise exception 'Default bag weight must be positive.'; end if;
  if nullif(btrim(p_tariff_version), '') is null then raise exception 'Tariff reference is required.'; end if;

  update public.agreements set
    effective_from = p_effective_from,
    effective_to = p_effective_to,
    status = p_status,
    default_bag_weight_kg = p_default_bag_weight_kg,
    tariff_version = btrim(p_tariff_version)
  where id = p_agreement_id
  returning * into v_after;

  perform private.record_audit(
    'AGREEMENT_UPDATED', 'AGREEMENT', v_after.id,
    jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after))
  );
  return to_jsonb(v_after);
end;
$$;

create or replace function public.update_authorized_representative(
  p_representative_id uuid,
  p_full_name text,
  p_identity_number text,
  p_phone text,
  p_valid_from date,
  p_valid_to date,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.authorized_representatives;
  v_after public.authorized_representatives;
begin
  perform private.require_role('system_admin', 'warehouse_manager');
  select representative.* into v_before
  from public.authorized_representatives representative
  join public.clients client on client.id = representative.client_id
  join public.profiles profile on profile.id = (select auth.uid())
  where representative.id = p_representative_id
    and client.organization_id = profile.organization_id
  for update of representative;
  if not found then raise exception 'Representative not found in your organization.'; end if;
  if nullif(btrim(p_full_name), '') is null or nullif(btrim(p_identity_number), '') is null then
    raise exception 'Representative name and identity number are required.';
  end if;
  if p_valid_to is not null and p_valid_to < p_valid_from then
    raise exception 'Representative expiry must be on or after the valid-from date.';
  end if;

  update public.authorized_representatives set
    full_name = btrim(p_full_name),
    identity_number = btrim(p_identity_number),
    phone = nullif(btrim(p_phone), ''),
    valid_from = p_valid_from,
    valid_to = p_valid_to,
    active = p_active
  where id = p_representative_id
  returning * into v_after;

  perform private.record_audit(
    'REPRESENTATIVE_UPDATED', 'AUTHORIZED_REPRESENTATIVE', v_after.id,
    jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after))
  );
  return to_jsonb(v_after);
end;
$$;

create or replace function public.post_manual_service_record(
  p_client_id uuid,
  p_service_code text,
  p_service_date date,
  p_description text,
  p_quantity numeric,
  p_unit_label text,
  p_unit_price numeric,
  p_approved_by uuid,
  p_processing_order_id uuid default null,
  p_evidence_reference text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.processing_orders;
  v_approver public.profiles;
  v_event public.service_events;
  v_record public.manual_service_records;
  v_total numeric(16,2);
begin
  perform private.require_role(
    'system_admin', 'warehouse_manager', 'processing_supervisor', 'finance_officer'
  );
  if p_service_code not in ('PROCESSING', 'HULLING', 'CLEANING', 'TRANSPORT', 'OTHER') then
    raise exception 'Choose a supported manual service.';
  end if;
  if p_service_date > current_date then raise exception 'Service date cannot be in the future.'; end if;
  if char_length(btrim(coalesce(p_description, ''))) < 3 then raise exception 'Service description is required.'; end if;
  if p_quantity <= 0 or p_unit_price < 0 then raise exception 'Quantity must be positive and rate cannot be negative.'; end if;
  if nullif(btrim(p_unit_label), '') is null then raise exception 'Service unit is required.'; end if;
  if p_approved_by = (select auth.uid()) then raise exception 'The recorder cannot approve the same service.'; end if;

  if not exists (
    select 1 from public.clients client
    join public.profiles recorder on recorder.id = (select auth.uid())
    where client.id = p_client_id
      and client.active
      and client.organization_id = recorder.organization_id
  ) then
    raise exception 'Choose an active client in your organization.';
  end if;

  select profile.* into v_approver from public.profiles profile
  join public.profiles recorder on recorder.id = (select auth.uid())
  where profile.id = p_approved_by and profile.active
    and profile.organization_id = recorder.organization_id
    and profile.role in ('system_admin', 'warehouse_manager', 'finance_officer');
  if not found then raise exception 'Choose an active independent approver.'; end if;

  if p_processing_order_id is not null then
    select processing.* into v_order from public.processing_orders processing
    where processing.id = p_processing_order_id and processing.client_id = p_client_id;
    if not found then raise exception 'Processing order does not belong to the selected client.'; end if;
    if v_order.status <> 'POSTED' then raise exception 'Only a completed processing order can be charged.'; end if;
  elsif p_service_code in ('PROCESSING', 'HULLING', 'CLEANING') then
    raise exception 'Processing, hulling, and cleaning services require a completed processing order.';
  end if;

  v_total := round(p_quantity * p_unit_price, 2);
  insert into public.service_events (
    client_id, lot_id, service_type, description, quantity, unit_price,
    total_amount, reference_id, status, service_date, unit_label, reference_type
  ) values (
    p_client_id, case when p_processing_order_id is null then null else v_order.lot_id end,
    p_service_code, btrim(p_description), p_quantity, p_unit_price, v_total,
    p_processing_order_id, 'UNBILLED', p_service_date, btrim(p_unit_label),
    case when p_processing_order_id is null then 'MANUAL_SERVICE' else 'PROCESSING_ORDER' end
  ) returning * into v_event;

  insert into public.manual_service_records (
    service_number, client_id, processing_order_id, service_code, service_date,
    description, quantity, unit_label, unit_price, total_amount, approved_by,
    evidence_reference, note, service_event_id, recorded_by
  ) values (
    'SVC-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'), p_client_id,
    p_processing_order_id, p_service_code, p_service_date, btrim(p_description),
    p_quantity, btrim(p_unit_label), p_unit_price, v_total, p_approved_by,
    nullif(btrim(p_evidence_reference), ''), nullif(btrim(p_note), ''),
    v_event.id, (select auth.uid())
  ) returning * into v_record;

  perform private.record_audit(
    'MANUAL_SERVICE_RECORDED', 'MANUAL_SERVICE', v_record.id,
    jsonb_build_object(
      'service_number', v_record.service_number,
      'service_event_id', v_event.id,
      'service_code', p_service_code,
      'processing_order_id', p_processing_order_id,
      'total_amount', v_total,
      'approved_by', p_approved_by,
      'automatic', false
    )
  );
  return jsonb_build_object(
    'id', v_record.id,
    'service_number', v_record.service_number,
    'service_event_id', v_event.id,
    'total_amount', v_total
  );
end;
$$;

create or replace function private.sync_arrears_after_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_case public.arrears_cases;
  v_paid numeric(16,2);
  v_outstanding numeric(16,2);
begin
  if new.direction <> 'PAYMENT' then return new; end if;
  select * into v_invoice from public.invoices where id = new.invoice_id;
  select coalesce(sum(case when direction = 'REVERSAL' then -amount_etb else amount_etb end), 0)
    into v_paid from public.payments where invoice_id = new.invoice_id;
  v_outstanding := greatest(0, v_invoice.total_etb - v_paid);

  select * into v_case from public.arrears_cases
  where invoice_id = new.invoice_id and stage <> 'CLOSED'
  order by created_at desc limit 1 for update;
  if not found then return new; end if;

  update public.arrears_cases set
    outstanding_etb = v_outstanding,
    stage = case when v_outstanding = 0 then 'CLOSED' else stage end,
    closed_at = case when v_outstanding = 0 then now() else closed_at end,
    next_action_on = case when v_outstanding = 0 then null else next_action_on end,
    notes = case when v_outstanding = 0
      then 'Closed automatically after full payment ' || new.payment_number || '.'
      else notes end,
    updated_by = new.recorded_by,
    updated_at = now()
  where id = v_case.id;

  if v_outstanding = 0 then
    insert into public.arrears_case_events (case_id, from_stage, to_stage, note, action_by)
    values (v_case.id, v_case.stage, 'CLOSED',
      'Closed automatically after full payment ' || new.payment_number || '.', new.recorded_by);
  end if;
  perform private.record_audit(
    'ARREARS_BALANCE_SYNCED', 'ARREARS_CASE', v_case.id,
    jsonb_build_object('payment_id', new.id, 'outstanding_etb', v_outstanding)
  );
  return new;
end;
$$;

drop trigger if exists sync_arrears_after_payment on public.payments;
create trigger sync_arrears_after_payment
after insert on public.payments
for each row execute function private.sync_arrears_after_payment();

revoke all on function public.update_client_agreement(uuid, date, date, text, numeric, text),
  public.update_authorized_representative(uuid, text, text, text, date, date, boolean),
  public.post_manual_service_record(uuid, text, date, text, numeric, text, numeric, uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.update_client_agreement(uuid, date, date, text, numeric, text),
  public.update_authorized_representative(uuid, text, text, text, date, date, boolean),
  public.post_manual_service_record(uuid, text, date, text, numeric, text, numeric, uuid, uuid, text, text)
to authenticated;
revoke all on function private.sync_arrears_after_payment() from public, anon, authenticated;
