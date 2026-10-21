-- Connect recorded warehouse rent, invoice preparation, exact invoice review,
-- and payment without creating automatic client charges.

alter table public.service_events
  drop constraint if exists service_events_status_check;
alter table public.service_events
  add constraint service_events_status_check
  check (status in ('UNBILLED', 'PREPARED', 'INVOICED'));

create table public.storage_rent_records (
  id uuid primary key default gen_random_uuid(),
  rent_number text not null unique,
  client_id uuid not null references public.clients(id),
  lot_id uuid not null references public.coffee_lots(id),
  storage_category text not null check (storage_category in (
    'NO_PROCESSING', 'WAITING_PROCESSING', 'PROCESSED_EXPORT',
    'GRADE_IMPROVEMENT', 'REJECT', 'EMPTY_BAGS'
  )),
  charge_start_on date not null,
  billed_through_on date,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CLOSED')),
  evidence_reference text,
  note text,
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (billed_through_on is null or billed_through_on >= charge_start_on)
);

create unique index storage_rent_one_active_lot_idx
  on public.storage_rent_records (lot_id)
  where status = 'ACTIVE';
create index storage_rent_client_status_idx
  on public.storage_rent_records (client_id, status, charge_start_on);

alter table public.storage_billing_runs
  add column if not exists storage_rent_record_id uuid references public.storage_rent_records(id);
create index if not exists storage_billing_rent_record_idx
  on public.storage_billing_runs (storage_rent_record_id);

alter table public.storage_rent_records enable row level security;
create policy storage_rent_staff_read on public.storage_rent_records
  for select to authenticated
  using ((select private.has_role(
    'system_admin', 'warehouse_manager', 'warehouse_officer',
    'finance_officer', 'auditor', 'viewer'
  )));
revoke all on public.storage_rent_records from public, anon, authenticated;
grant select on public.storage_rent_records to authenticated;

create or replace function public.record_storage_rent(
  p_client_id uuid,
  p_lot_id uuid,
  p_storage_category text,
  p_charge_start_on date,
  p_evidence_reference text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.storage_rent_records;
  v_received_on date;
begin
  perform private.require_role(
    'system_admin', 'warehouse_manager', 'warehouse_officer', 'finance_officer'
  );
  if p_storage_category not in (
    'NO_PROCESSING', 'WAITING_PROCESSING', 'PROCESSED_EXPORT',
    'GRADE_IMPROVEMENT', 'REJECT', 'EMPTY_BAGS'
  ) then raise exception 'Choose a supported storage category.'; end if;
  if p_charge_start_on is null or p_charge_start_on > current_date then
    raise exception 'Storage rent must start today or earlier.';
  end if;
  select coalesce(receipt.arrival_at::date, lot.created_at::date)
  into v_received_on
    from public.coffee_lots lot
    join public.clients client on client.id = lot.client_id
    join public.profiles recorder on recorder.id = (select auth.uid())
    left join public.warehouse_receipts receipt on receipt.id = lot.receipt_id
    where lot.id = p_lot_id
      and lot.client_id = p_client_id
      and client.active
      and client.organization_id = recorder.organization_id;
  if v_received_on is null then
    raise exception 'Choose an active client lot in your organization.';
  end if;
  if p_charge_start_on < v_received_on then
    raise exception 'Warehouse rent cannot start before the lot was received.';
  end if;
  if exists (
    select 1 from public.storage_rent_records
    where lot_id = p_lot_id and status = 'ACTIVE'
  ) then raise exception 'This lot already has an active warehouse rent record.'; end if;

  insert into public.storage_rent_records (
    rent_number, client_id, lot_id, storage_category, charge_start_on,
    evidence_reference, note, recorded_by
  ) values (
    'RENT-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
    p_client_id, p_lot_id, p_storage_category, p_charge_start_on,
    nullif(btrim(p_evidence_reference), ''), nullif(btrim(p_note), ''),
    (select auth.uid())
  ) returning * into v_record;

  perform private.record_audit(
    'STORAGE_RENT_RECORDED', 'STORAGE_RENT', v_record.id,
    jsonb_build_object(
      'rent_number', v_record.rent_number,
      'client_id', p_client_id,
      'lot_id', p_lot_id,
      'charge_start_on', p_charge_start_on,
      'creates_charge', false
    )
  );
  return to_jsonb(v_record);
end;
$$;

create or replace function public.post_storage_rent_billing(
  p_rent_record_id uuid,
  p_period_end date,
  p_tariff_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.storage_rent_records;
  v_period_start date;
  v_run_id uuid;
  v_certified boolean;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'finance_officer');
  select * into v_record
  from public.storage_rent_records
  where id = p_rent_record_id and status = 'ACTIVE'
  for update;
  if not found then raise exception 'Active warehouse rent record not found.'; end if;

  v_period_start := coalesce(v_record.billed_through_on + 1, v_record.charge_start_on);
  if p_period_end is null or p_period_end < v_period_start then
    raise exception 'Billing end date must be on or after the next unbilled storage day.';
  end if;
  if exists (
    select 1 from public.storage_billing_runs run
    where run.client_id = v_record.client_id
      and run.lot_id = v_record.lot_id
      and run.category = v_record.storage_category
      and run.period_start <= p_period_end
      and run.period_end >= v_period_start
  ) then raise exception 'Some selected storage days have already been billed for this lot and category.'; end if;
  v_certified := private.lot_is_certified_for_period(
    v_record.lot_id, v_period_start, p_period_end
  );
  v_run_id := public.calculate_and_save_storage_billing_v2(
    v_record.client_id, v_record.lot_id, v_record.storage_category,
    v_period_start, p_period_end, v_certified, p_tariff_version
  );
  update public.storage_billing_runs
  set storage_rent_record_id = v_record.id
  where id = v_run_id;
  update public.storage_rent_records
  set billed_through_on = p_period_end, updated_at = now()
  where id = v_record.id;

  perform private.record_audit(
    'STORAGE_RENT_BILLED', 'STORAGE_RENT', v_record.id,
    jsonb_build_object(
      'storage_billing_run_id', v_run_id,
      'period_start', v_period_start,
      'period_end', p_period_end,
      'tariff_version', p_tariff_version
    )
  );
  return jsonb_build_object(
    'rent_record_id', v_record.id,
    'storage_billing_run_id', v_run_id,
    'period_start', v_period_start,
    'period_end', p_period_end
  );
end;
$$;

create or replace function public.create_invoice_draft_from_services(
  p_service_event_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice_id uuid;
  v_invoice_number text;
  v_client_id uuid;
  v_client_count integer;
  v_tariff_version text;
  v_subtotal numeric(16,2);
  v_lines jsonb;
  v_count integer;
begin
  perform private.require_role('system_admin', 'finance_officer');
  if coalesce(cardinality(p_service_event_ids), 0) = 0 then
    raise exception 'Select at least one unbilled service.';
  end if;

  perform 1 from public.service_events
  where id = any(p_service_event_ids)
  for update;

  select count(*), count(distinct service.client_id), min(service.client_id::text)::uuid,
    round(sum(service.total_amount), 2),
    jsonb_agg(jsonb_build_object(
      'service_event_id', service.id,
      'service_type', service.service_type,
      'description', service.description,
      'quantity', service.quantity,
      'rate_etb', service.unit_price,
      'amount_etb', service.total_amount,
      'reference_id', service.reference_id,
      'reference_type', service.reference_type
    ) order by service.service_date, service.created_at)
  into v_count, v_client_count, v_client_id, v_subtotal, v_lines
  from public.service_events service
  where service.id = any(p_service_event_ids)
    and service.status = 'UNBILLED'
    and service.invoice_id is null;

  if v_count <> cardinality(p_service_event_ids) then
    raise exception 'Every selected service must still be unbilled and outside another invoice draft.';
  end if;
  if v_client_count <> 1 then
    raise exception 'Prepare one client invoice at a time.';
  end if;

  select agreement.tariff_version into v_tariff_version
  from public.agreements agreement
  where agreement.client_id = v_client_id
    and agreement.status = 'ACTIVE'
    and agreement.effective_from <= current_date
    and (agreement.effective_to is null or agreement.effective_to >= current_date)
  order by agreement.effective_from desc
  limit 1;
  if nullif(btrim(v_tariff_version), '') is null then
    raise exception 'The client needs an active agreement with a tariff reference before invoice preparation.';
  end if;

  v_invoice_number := 'DRF-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
  insert into public.invoices (
    invoice_number, client_id, tariff_version, line_snapshot,
    subtotal_etb, tax_etb, status, created_by
  ) values (
    v_invoice_number, v_client_id, v_tariff_version, v_lines,
    v_subtotal, 0, 'DRAFT', (select auth.uid())
  ) returning id into v_invoice_id;

  update public.service_events
  set invoice_id = v_invoice_id, status = 'PREPARED'
  where id = any(p_service_event_ids);

  perform private.record_audit(
    'INVOICE_DRAFT_PREPARED', 'INVOICE', v_invoice_id,
    jsonb_build_object(
      'invoice_number', v_invoice_number,
      'client_id', v_client_id,
      'service_event_ids', p_service_event_ids,
      'subtotal_etb', v_subtotal,
      'tax_etb', 0
    )
  );
  return jsonb_build_object(
    'id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'client_id', v_client_id,
    'subtotal_etb', v_subtotal,
    'status', 'DRAFT'
  );
end;
$$;

revoke all on function public.record_storage_rent(uuid, uuid, text, date, text, text)
  from public, anon;
revoke all on function public.post_storage_rent_billing(uuid, date, text)
  from public, anon;
revoke all on function public.create_invoice_draft_from_services(uuid[])
  from public, anon;
grant execute on function public.record_storage_rent(uuid, uuid, text, date, text, text)
  to authenticated;
grant execute on function public.post_storage_rent_billing(uuid, date, text)
  to authenticated;
grant execute on function public.create_invoice_draft_from_services(uuid[])
  to authenticated;
