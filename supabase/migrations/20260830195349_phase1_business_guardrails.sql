-- Phase 1 business guardrails keep unverified pricing and incomplete evidence
-- out of invoice preparation. Rate values must be supplied by management in a
-- later migration or controlled administration workflow; this migration does
-- not invent any rates.

create table public.service_rate_catalog (
  id uuid primary key default gen_random_uuid(),
  tariff_version_id uuid not null references public.tariff_versions(id),
  service_code text not null check (service_code in ('PROCESSING', 'HULLING', 'CLEANING', 'TRANSPORT', 'OTHER')),
  description text not null,
  unit_label text not null,
  unit_price numeric(16,2) not null check (unit_price >= 0),
  effective_from date not null,
  effective_to date,
  active boolean not null default true,
  verified_by_1 uuid not null references public.profiles(id),
  verified_by_2 uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  check (verified_by_1 <> verified_by_2),
  unique (tariff_version_id, service_code, unit_label, effective_from)
);

create index service_rate_catalog_lookup_idx
  on public.service_rate_catalog (service_code, unit_label, effective_from desc)
  where active;

alter table public.service_rate_catalog enable row level security;
create policy service_rate_catalog_staff_read
  on public.service_rate_catalog for select to authenticated
  using ((select private.has_role(
    'system_admin', 'warehouse_manager', 'warehouse_officer',
    'processing_supervisor', 'finance_officer', 'auditor', 'viewer'
  )));
revoke all on public.service_rate_catalog from public, anon, authenticated;
grant select on public.service_rate_catalog to authenticated;

alter table public.manual_service_records
  add column service_rate_id uuid references public.service_rate_catalog(id);

create or replace function private.enforce_processing_ecx_before_start()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'IN_PROCESS' and old.status is distinct from 'IN_PROCESS' then
    if not exists (
      select 1
      from public.processing_requests request
      join public.ecx_checks check_record
        on check_record.processing_request_id = request.id
      where request.id = new.request_id
        and request.status = 'APPROVED'
        and check_record.result in ('PASSED', 'NOT_REQUIRED')
    ) then
      raise exception 'Processing cannot start until ECX is Passed or Not Required.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists processing_orders_require_ecx_before_start on public.processing_orders;
create trigger processing_orders_require_ecx_before_start
before update of status on public.processing_orders
for each row execute function private.enforce_processing_ecx_before_start();

revoke all on function private.enforce_processing_ecx_before_start() from public, anon, authenticated;

create or replace function private.enforce_storage_invoice_evidence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_day_count integer;
  v_billable_units numeric;
  v_total numeric;
begin
  if new.status = 'INVOICED' then
    select count(*), coalesce(sum(day.billable_units), 0), coalesce(sum(day.amount_etb), 0)
    into v_day_count, v_billable_units, v_total
    from public.storage_billing_run_days day
    where day.run_id = new.id;

    if v_day_count = 0 then
      raise exception 'Storage billing cannot be invoiced without daily calculation evidence.';
    end if;
    if abs(v_billable_units - new.billable_bag_days) > 0.001
      or abs(v_total - new.total_amount) > 0.01 then
      raise exception 'Storage billing daily evidence does not match the run totals.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists storage_billing_requires_daily_evidence on public.storage_billing_runs;
create trigger storage_billing_requires_daily_evidence
before insert or update of status on public.storage_billing_runs
for each row execute function private.enforce_storage_invoice_evidence();

revoke all on function private.enforce_storage_invoice_evidence() from public, anon, authenticated;

create or replace function private.enforce_service_pricing_before_invoice()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'PREPARED' and old.status is distinct from 'PREPARED' then
    if old.service_type = 'STORAGE' then
      if not exists (
        select 1
        from public.storage_billing_runs run
        where run.id = old.reference_id
          and run.total_amount = old.total_amount
          and exists (
            select 1 from public.storage_billing_run_days day where day.run_id = run.id
          )
          and abs((
            select coalesce(sum(day.amount_etb), 0)
            from public.storage_billing_run_days day where day.run_id = run.id
          ) - run.total_amount) <= 0.01
      ) then
        raise exception 'Storage service lacks matching daily billing evidence.';
      end if;
    elsif old.service_type in ('PROCESSING', 'HULLING', 'CLEANING', 'TRANSPORT', 'OTHER') then
      if not exists (
        select 1
        from public.manual_service_records record
        join public.service_rate_catalog rate on rate.id = record.service_rate_id
        join public.tariff_versions tariff on tariff.id = rate.tariff_version_id
        where record.service_event_id = old.id
          and record.unit_price = rate.unit_price
          and tariff.active
          and tariff.verified_by_1 is not null
          and tariff.verified_by_2 is not null
          and tariff.verified_by_1 <> tariff.verified_by_2
      ) then
        raise exception 'Manual service lacks an independently verified catalog rate.';
      end if;
    else
      raise exception 'The % service rate is not yet approved for invoice preparation.', old.service_type;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists service_events_require_authoritative_pricing on public.service_events;
create trigger service_events_require_authoritative_pricing
before update of status on public.service_events
for each row execute function private.enforce_service_pricing_before_invoice();

revoke all on function private.enforce_service_pricing_before_invoice() from public, anon, authenticated;

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
  v_event public.service_events;
  v_record public.manual_service_records;
  v_rate public.service_rate_catalog;
  v_tariff public.tariff_versions;
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
  if p_quantity <= 0 then raise exception 'Quantity must be positive.'; end if;
  if nullif(btrim(p_unit_label), '') is null then raise exception 'Service unit is required.'; end if;
  if p_approved_by = (select auth.uid()) then raise exception 'The recorder cannot approve the same service.'; end if;

  if not exists (
    select 1 from public.clients client
    join public.profiles recorder on recorder.id = (select auth.uid())
    where client.id = p_client_id and client.active
      and client.organization_id = recorder.organization_id
  ) then
    raise exception 'Choose an active client in your organization.';
  end if;

  perform 1
  from public.profiles profile
  join public.profiles recorder on recorder.id = (select auth.uid())
  where profile.id = p_approved_by and profile.active
    and profile.organization_id = recorder.organization_id
    and profile.role in ('system_admin', 'warehouse_manager', 'finance_officer');
  if not found then raise exception 'Choose an active independent approver.'; end if;

  select rate.* into v_rate
  from public.service_rate_catalog rate
  join public.tariff_versions tariff on tariff.id = rate.tariff_version_id
  where rate.service_code = p_service_code
    and lower(rate.unit_label) = lower(btrim(p_unit_label))
    and rate.active and tariff.active
    and p_service_date >= rate.effective_from
    and (rate.effective_to is null or p_service_date <= rate.effective_to)
    and p_service_date >= tariff.effective_from
    and (tariff.effective_to is null or p_service_date <= tariff.effective_to)
    and tariff.verified_by_1 is not null
    and tariff.verified_by_2 is not null
    and tariff.verified_by_1 <> tariff.verified_by_2
  order by rate.effective_from desc
  limit 1;
  if not found then
    raise exception 'No independently verified catalog rate exists for this service, unit, and date.';
  end if;
  select * into v_tariff
  from public.tariff_versions
  where id = v_rate.tariff_version_id;
  if abs(coalesce(p_unit_price, -1) - v_rate.unit_price) > 0.001 then
    raise exception 'The entered rate does not match the approved catalog rate of ETB %.', v_rate.unit_price;
  end if;

  if p_processing_order_id is not null then
    select processing.* into v_order from public.processing_orders processing
    where processing.id = p_processing_order_id and processing.client_id = p_client_id;
    if not found then raise exception 'Processing order does not belong to the selected client.'; end if;
    if v_order.status <> 'POSTED' then raise exception 'Only a completed processing order can be charged.'; end if;
  elsif p_service_code in ('PROCESSING', 'HULLING', 'CLEANING') then
    raise exception 'Processing, hulling, and cleaning services require a completed processing order.';
  end if;

  v_total := round(p_quantity * v_rate.unit_price, 2);
  insert into public.service_events (
    client_id, lot_id, service_type, description, quantity, unit_price,
    total_amount, reference_id, status, service_date, unit_label, reference_type
  ) values (
    p_client_id, case when p_processing_order_id is null then null else v_order.lot_id end,
    p_service_code, btrim(p_description), p_quantity, v_rate.unit_price, v_total,
    p_processing_order_id, 'UNBILLED', p_service_date, v_rate.unit_label,
    case when p_processing_order_id is null then 'MANUAL_SERVICE' else 'PROCESSING_ORDER' end
  ) returning * into v_event;

  insert into public.manual_service_records (
    service_number, client_id, processing_order_id, service_code, service_date,
    description, quantity, unit_label, unit_price, total_amount, approved_by,
    evidence_reference, note, service_event_id, service_rate_id, recorded_by
  ) values (
    'SVC-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'), p_client_id,
    p_processing_order_id, p_service_code, p_service_date, btrim(p_description),
    p_quantity, v_rate.unit_label, v_rate.unit_price, v_total, p_approved_by,
    nullif(btrim(p_evidence_reference), ''), nullif(btrim(p_note), ''),
    v_event.id, v_rate.id, (select auth.uid())
  ) returning * into v_record;

  perform private.record_audit(
    'MANUAL_SERVICE_RECORDED', 'MANUAL_SERVICE', v_record.id,
    jsonb_build_object(
      'service_number', v_record.service_number,
      'service_event_id', v_event.id,
      'service_code', p_service_code,
      'processing_order_id', p_processing_order_id,
      'service_rate_id', v_rate.id,
      'tariff_version', v_tariff.version_code,
      'unit_price', v_rate.unit_price,
      'total_amount', v_total,
      'approved_by', p_approved_by,
      'automatic', false
    )
  );
  return jsonb_build_object(
    'id', v_record.id,
    'service_number', v_record.service_number,
    'service_event_id', v_event.id,
    'service_rate_id', v_rate.id,
    'total_amount', v_total
  );
end;
$$;

revoke all on function public.post_manual_service_record(
  uuid, text, date, text, numeric, text, numeric, uuid, uuid, text, text
) from public, anon;
grant execute on function public.post_manual_service_record(
  uuid, text, date, text, numeric, text, numeric, uuid, uuid, text, text
) to authenticated;
