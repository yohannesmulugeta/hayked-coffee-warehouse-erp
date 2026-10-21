-- Agreement 001/2018, Article 16: independently reviewed empty-jute-bag charges.
-- Existing coffee-lot storage charges and custody events are preserved.
create table public.empty_bag_cohort_allocations (
  ledger_entry_id uuid not null references public.empty_bag_ledger_entries(id),
  cohort_event_id uuid not null references public.empty_bag_events(id),
  quantity_delta integer not null check (quantity_delta <> 0),
  primary key (ledger_entry_id, cohort_event_id)
);
create index empty_bag_cohort_event_idx on public.empty_bag_cohort_allocations (cohort_event_id);
alter table public.empty_bag_cohort_allocations enable row level security;
revoke all on public.empty_bag_cohort_allocations from public, anon, authenticated;

create function private.allocate_empty_bag_cohorts(p_entry_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_entry public.empty_bag_ledger_entries;
  v_event public.empty_bag_events;
  v_remaining integer;
  v_take integer;
  v_cohort record;
begin
  select * into v_entry from public.empty_bag_ledger_entries where id = p_entry_id;
  if not found or exists (select 1 from public.empty_bag_cohort_allocations where ledger_entry_id = p_entry_id) then return; end if;
  select * into v_event from public.empty_bag_events where id = v_entry.event_id;
  if v_entry.quantity_delta > 0 and v_event.event_type in ('RECEIPT', 'RETURN', 'ADJUST_IN') then
    insert into public.empty_bag_cohort_allocations values (p_entry_id, v_event.id, v_entry.quantity_delta);
  elsif v_entry.quantity_delta > 0 then
    insert into public.empty_bag_cohort_allocations (ledger_entry_id, cohort_event_id, quantity_delta)
    select p_entry_id, allocation.cohort_event_id, -allocation.quantity_delta
    from public.empty_bag_cohort_allocations allocation
    join public.empty_bag_ledger_entries source on source.id = allocation.ledger_entry_id
    where source.event_id = v_entry.event_id and source.quantity_delta < 0;
    if coalesce((select sum(quantity_delta) from public.empty_bag_cohort_allocations where ledger_entry_id = p_entry_id), 0) <> v_entry.quantity_delta then
      raise exception 'The transferred bag cohorts do not reconcile.';
    end if;
  else
    v_remaining := -v_entry.quantity_delta;
    for v_cohort in
      select allocation.cohort_event_id, sum(allocation.quantity_delta)::integer as available
      from public.empty_bag_cohort_allocations allocation
      join public.empty_bag_ledger_entries entry on entry.id = allocation.ledger_entry_id
      join public.empty_bag_events cohort on cohort.id = allocation.cohort_event_id
      where entry.organization_id = v_entry.organization_id and entry.client_id = v_entry.client_id
        and entry.warehouse_id = v_entry.warehouse_id and entry.location_code = v_entry.location_code
        and entry.bag_type = v_entry.bag_type and entry.condition = v_entry.condition
      group by allocation.cohort_event_id, cohort.business_date, cohort.created_at
      having sum(allocation.quantity_delta) > 0
      order by cohort.business_date, cohort.created_at, allocation.cohort_event_id
    loop
      v_take := least(v_remaining, v_cohort.available);
      insert into public.empty_bag_cohort_allocations values (p_entry_id, v_cohort.cohort_event_id, -v_take);
      v_remaining := v_remaining - v_take;
      exit when v_remaining = 0;
    end loop;
    if v_remaining <> 0 then raise exception 'The source bag cohorts do not cover this movement.'; end if;
  end if;
end;
$$;
revoke all on function private.allocate_empty_bag_cohorts(uuid) from public, anon, authenticated;

create function private.track_empty_bag_cohorts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.allocate_empty_bag_cohorts(new.id);
  return new;
end;
$$;
revoke all on function private.track_empty_bag_cohorts() from public, anon, authenticated;
create trigger empty_bag_cohort_track after insert on public.empty_bag_ledger_entries
for each row execute function private.track_empty_bag_cohorts();

-- Replay existing custody entries in event order. The migration fails atomically if provenance is inconsistent.
do $$ declare v_entry record; begin
  for v_entry in
    select entry.id from public.empty_bag_ledger_entries entry
    join public.empty_bag_events event on event.id = entry.event_id
    order by event.business_date, event.created_at,
      case when entry.quantity_delta < 0 then 0 else 1 end, entry.created_at, entry.id
  loop
    perform private.allocate_empty_bag_cohorts(v_entry.id);
  end loop;
end $$;

create table public.empty_bag_charge_runs (
  id uuid primary key default gen_random_uuid(),
  run_number text not null unique,
  organization_id uuid not null references public.organizations(id),
  client_id uuid not null references public.clients(id),
  agreement_id uuid not null references public.agreements(id),
  charge_type text not null check (charge_type in ('STORAGE', 'ARTICLE_16_4')),
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  tariff_version text not null,
  billable_units numeric(18,4) not null check (billable_units >= 0),
  total_amount numeric(16,2) not null check (total_amount >= 0),
  evidence_reference text,
  charge_reason text,
  status text not null default 'PENDING_REVIEW' check (status in ('PENDING_REVIEW','APPROVED','REJECTED','POSTED','INVOICED')),
  prepared_by uuid not null references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  review_note text,
  reviewed_at timestamptz,
  posted_by uuid references public.profiles(id),
  posted_at timestamptz,
  service_event_id uuid unique references public.service_events(id),
  created_at timestamptz not null default now(),
  check (charge_type <> 'ARTICLE_16_4' or
    (length(btrim(coalesce(evidence_reference,''))) >= 3 and length(btrim(coalesce(charge_reason,''))) >= 20))
);
create index empty_bag_charge_overlap_idx on public.empty_bag_charge_runs
  (organization_id, client_id, charge_type, period_start, period_end)
  where status <> 'REJECTED';
create table public.empty_bag_charge_days (
  run_id uuid not null references public.empty_bag_charge_runs(id),
  charge_date date not null,
  cohort_event_id uuid references public.empty_bag_events(id),
  opening_bags integer not null check (opening_bags >= 0),
  movement_bags integer not null,
  closing_bags integer not null check (closing_bags >= 0),
  age_day integer,
  rate_etb numeric(10,2) not null check (rate_etb >= 0),
  billable_units numeric(18,4) not null check (billable_units >= 0),
  amount_etb numeric(16,2) not null check (amount_etb >= 0),
  movement_references text[] not null default '{}',
  unique (run_id, charge_date, cohort_event_id)
);
create index empty_bag_charge_days_run_idx on public.empty_bag_charge_days (run_id, charge_date);
alter table public.empty_bag_charge_runs enable row level security;
alter table public.empty_bag_charge_days enable row level security;
revoke all on public.empty_bag_charge_runs, public.empty_bag_charge_days from public, anon, authenticated;
grant select on public.empty_bag_charge_runs, public.empty_bag_charge_days to authenticated;
create policy empty_bag_charge_runs_read on public.empty_bag_charge_runs for select to authenticated
using (organization_id = (select private.current_organization_id()) and
  (select private.has_role('system_admin','warehouse_manager','finance_officer','auditor','viewer')));
create policy empty_bag_charge_days_read on public.empty_bag_charge_days for select to authenticated
using (exists (select 1 from public.empty_bag_charge_runs run where run.id = run_id
  and run.organization_id = (select private.current_organization_id())) and
  (select private.has_role('system_admin','warehouse_manager','finance_officer','auditor','viewer')));

create function private.guard_billed_empty_bag_dates()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.bag_type = 'JUTE' and exists (
    select 1 from public.empty_bag_charge_runs run
    where run.organization_id = new.organization_id and run.client_id = new.client_id
      and run.status <> 'REJECTED'
      and new.business_date <= run.period_end
  ) then
    raise exception 'This date has a pending or posted bag-storage calculation. Reject the pending review or record a current-date correction.';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_billed_empty_bag_dates() from public, anon, authenticated;
create trigger empty_bag_no_backdated_bill_change before insert on public.empty_bag_events
for each row execute function private.guard_billed_empty_bag_dates();

-- No Article 13.1 washed Grades 3-5 price exists in the signed table.
create function private.guard_washed_processing_price()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.service_type = 'PROCESSING' and new.reference_type = 'PROCESSING_ORDER'
    and (exists (
      select 1 from public.processing_orders order_record
      join public.coffee_lots lot on lot.id = order_record.lot_id
      left join public.processing_requests request on request.id = order_record.request_id
      left join public.warehouse_receipts receipt on receipt.id = lot.receipt_id
      where order_record.id = new.reference_id and lot.coffee_type = 'WASHED'
        and lower(btrim(coalesce(request.grade,receipt.grade,''))) in ('grade 3','grade 4','grade 5')
    ) or exists (
      select 1 from public.processing_outputs output
      where output.order_id = new.reference_id and output.coffee_type = 'WASHED'
        and output.category = 'ACCEPTED_CLIENT_COFFEE'
        and lower(btrim(coalesce(output.grade,''))) in ('grade 3','grade 4','grade 5')
    )) then
    raise exception 'Agreement Article 13.1 has no washed Grade 3-5 processing rate. Obtain an approved price mapping before charging.';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_washed_processing_price() from public, anon, authenticated;
create trigger service_event_washed_grade_price_guard
before insert or update of status, service_type, reference_id on public.service_events
for each row execute function private.guard_washed_processing_price();

create function private.empty_bag_charge_rows(
  p_client_id uuid, p_agreement_id uuid, p_start date, p_end date, p_charge_type text
)
returns table (
  charge_date date, cohort_event_id uuid, opening_bags integer, movement_bags integer,
  closing_bags integer, age_day integer, rate_etb numeric, billable_units numeric,
  amount_etb numeric, movement_references text[]
)
language sql stable security definer set search_path = '' as $$
  with days as (
    select day::date as charge_date
    from pg_catalog.generate_series(p_start, p_end, interval '1 day') day
  ),
  cohorts as (
    select event.id, event.business_date
    from public.empty_bag_events event
    where event.client_id = p_client_id and event.bag_type = 'JUTE'
      and event.event_type in ('RECEIPT','RETURN','ADJUST_IN')
      and event.business_date <= p_end
  ),
  balances as (
    select days.charge_date, cohort.id as cohort_event_id,
      (days.charge_date - cohort.business_date + 1)::integer as age_day,
      coalesce(detail.opening_bags, 0)::integer as opening_bags,
      coalesce(detail.movement_bags, 0)::integer as movement_bags,
      (coalesce(detail.opening_bags, 0) + coalesce(detail.movement_bags, 0))::integer as closing_bags,
      coalesce(detail.references, '{}'::text[]) as movement_references
    from days join cohorts cohort on cohort.business_date <= days.charge_date
    cross join lateral (
      select sum(allocation.quantity_delta) filter (where entry.business_date < days.charge_date) as opening_bags,
        sum(allocation.quantity_delta) filter (where entry.business_date = days.charge_date) as movement_bags,
        array_agg(distinct event.document_reference) filter (where entry.business_date = days.charge_date) as references
      from public.empty_bag_cohort_allocations allocation
      join public.empty_bag_ledger_entries entry on entry.id = allocation.ledger_entry_id
      join public.empty_bag_events event on event.id = entry.event_id
      where allocation.cohort_event_id = cohort.id and entry.business_date <= days.charge_date
    ) detail
  ),
  storage_rows as (
    select balance.charge_date, balance.cohort_event_id, balance.opening_bags,
      balance.movement_bags, balance.closing_bags, balance.age_day,
      case when balance.closing_bags = 0 then 0 else price.daily_rate_per_unit end as rate_etb,
      (balance.closing_bags::numeric / 50) as billable_units,
      round(balance.closing_bags::numeric / 50 * coalesce(price.daily_rate_per_unit,0), 2) as amount_etb,
      balance.movement_references
    from balances balance
    join public.agreements agreement on agreement.id = p_agreement_id
    join public.tariff_versions tariff on tariff.version_code = agreement.tariff_version
    left join lateral (
      select rate.daily_rate_per_unit
      from public.tariff_line_items rate
      where rate.tariff_version_id = tariff.id and rate.category = 'EMPTY_BAGS'
        and not rate.certified and rate.age_start_days <= balance.age_day
        and (rate.age_end_days is null or rate.age_end_days >= balance.age_day)
      order by rate.age_start_days desc limit 1
    ) price on true
    where balance.opening_bags <> 0 or balance.movement_bags <> 0 or balance.closing_bags <> 0
  ),
  penalty_rows as (
    select balance.charge_date, null::uuid as cohort_event_id,
      sum(balance.opening_bags)::integer as opening_bags,
      sum(balance.movement_bags)::integer as movement_bags,
      sum(balance.closing_bags)::integer as closing_bags,
      null::integer as age_day, 100.00::numeric as rate_etb,
      case when sum(balance.closing_bags) > 0 then 1::numeric else 0::numeric end as billable_units,
      case when sum(balance.closing_bags) > 0 then 100.00::numeric else 0::numeric end as amount_etb,
      coalesce((
        select array_agg(distinct reference.value)
        from balances other_balance
        cross join lateral pg_catalog.unnest(other_balance.movement_references) reference(value)
        where other_balance.charge_date = balance.charge_date
      ), '{}'::text[]) as movement_references
    from balances balance
    group by balance.charge_date
  )
  select * from storage_rows where p_charge_type = 'STORAGE'
  union all
  select * from penalty_rows where p_charge_type = 'ARTICLE_16_4'
  order by charge_date, cohort_event_id;
$$;
revoke all on function private.empty_bag_charge_rows(uuid,uuid,date,date,text) from public, anon, authenticated;

create function private.validate_empty_bag_charge(
  p_client_id uuid, p_agreement_id uuid, p_start date, p_end date, p_charge_type text
)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := (select private.current_organization_id());
  v_tariff public.tariff_versions;
begin
  perform private.require_role('system_admin','warehouse_manager','finance_officer','auditor');
  if p_charge_type is null or p_charge_type not in ('STORAGE','ARTICLE_16_4') or p_start is null or p_end is null
    or p_end < p_start or p_end - p_start > 365
    or p_end > (now() at time zone 'Africa/Addis_Ababa')::date then
    raise exception 'Choose a valid bag charge and date range of at most 366 days.';
  end if;
  if not exists (
    select 1 from public.clients client
    join public.agreements agreement on agreement.client_id = client.id
    where client.id = p_client_id and client.organization_id = v_org and client.active
      and agreement.id = p_agreement_id and agreement.status in ('ACTIVE','EXPIRED')
      and agreement.effective_from <= p_start
      and (agreement.effective_to is null or agreement.effective_to >= p_end)
  ) then raise exception 'Choose this client’s agreement covering the full billing period.'; end if;
  select tariff.* into v_tariff from public.agreements agreement
    join public.tariff_versions tariff on tariff.version_code = agreement.tariff_version
    where agreement.id = p_agreement_id;
  if v_tariff.id is null or not v_tariff.active or v_tariff.verified_by_1 is null
    or v_tariff.verified_by_2 is null or v_tariff.verified_by_1 = v_tariff.verified_by_2
    or v_tariff.effective_from > p_start
    or (v_tariff.effective_to is not null and v_tariff.effective_to < p_end) then
    raise exception 'The agreement needs an active, independently verified tariff covering these dates.';
  end if;
  if not exists (
    select 1 from public.empty_bag_events event
    where event.organization_id = v_org and event.client_id = p_client_id
      and event.bag_type = 'JUTE' and event.event_type in ('RECEIPT','RETURN','ADJUST_IN')
      and event.business_date <= p_end
  ) then raise exception 'Record and reconcile the client’s jute-bag custody before billing.'; end if;
  if p_charge_type = 'STORAGE' and exists (
    select 1 from private.empty_bag_charge_rows(p_client_id,p_agreement_id,p_start,p_end,p_charge_type) row
    where row.closing_bags > 0 and row.rate_etb is null
  ) then raise exception 'An approved Article 16 storage rate is missing for a receipt cohort.'; end if;
  if p_charge_type = 'ARTICLE_16_4' and (
    select count(*) from private.empty_bag_charge_rows(p_client_id,p_agreement_id,p_start,p_end,p_charge_type) row
    where row.closing_bags > 0
  ) <> p_end - p_start + 1 then
    raise exception 'The Article 16.4 period must have client-owned jute bags in storage on every charged day.';
  end if;
  return v_tariff.version_code;
end;
$$;
revoke all on function private.validate_empty_bag_charge(uuid,uuid,date,date,text) from public, anon, authenticated;

create function public.quote_empty_bag_charge(
  p_client_id uuid, p_agreement_id uuid, p_start date, p_end date, p_charge_type text
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tariff_version text;
  v_total numeric;
  v_units numeric;
  v_rows jsonb;
begin
  v_tariff_version := private.validate_empty_bag_charge(p_client_id,p_agreement_id,p_start,p_end,p_charge_type);
  select coalesce(sum(row.amount_etb),0), coalesce(sum(row.billable_units),0),
    coalesce(jsonb_agg(jsonb_build_object(
      'date',row.charge_date,'cohortId',row.cohort_event_id,'openingBags',row.opening_bags,
      'movementBags',row.movement_bags,'closingBags',row.closing_bags,'ageDay',row.age_day,
      'rate',row.rate_etb,'units',row.billable_units,'amount',row.amount_etb,
      'references',row.movement_references
    ) order by row.charge_date,row.cohort_event_id), '[]'::jsonb)
  into v_total,v_units,v_rows
  from private.empty_bag_charge_rows(p_client_id,p_agreement_id,p_start,p_end,p_charge_type) row;
  return jsonb_build_object('tariffVersion',v_tariff_version,'chargeType',p_charge_type,
    'billableUnits',v_units,'amount',v_total,'rows',v_rows);
end;
$$;
revoke all on function public.quote_empty_bag_charge(uuid,uuid,date,date,text) from public, anon, authenticated;
grant execute on function public.quote_empty_bag_charge(uuid,uuid,date,date,text) to authenticated;

create function public.prepare_empty_bag_charge(
  p_client_id uuid, p_agreement_id uuid, p_start date, p_end date,
  p_charge_type text, p_evidence_reference text, p_charge_reason text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := (select private.current_organization_id());
  v_quote jsonb;
  v_id uuid;
begin
  perform private.require_role('system_admin','finance_officer');
  if p_end >= (now() at time zone 'Africa/Addis_Ababa')::date then
    raise exception 'Prepare completed days through yesterday.';
  end if;
  if length(btrim(coalesce(p_evidence_reference,''))) < 3 then
    raise exception 'Provide a physical-count or collection evidence reference.';
  end if;
  if p_charge_type = 'ARTICLE_16_4' and length(btrim(coalesce(p_charge_reason,''))) < 20 then
    raise exception 'Explain the documented Article 16.4 trigger before review.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_client_id::text, 0));
  if exists (
    select 1 from public.empty_bag_charge_runs run
    where run.organization_id = v_org and run.client_id = p_client_id
      and run.charge_type = p_charge_type and run.status <> 'REJECTED'
      and run.period_start <= p_end and run.period_end >= p_start
  ) then raise exception 'These bag charge days are already pending review or posted.'; end if;
  v_quote := public.quote_empty_bag_charge(p_client_id,p_agreement_id,p_start,p_end,p_charge_type);
  insert into public.empty_bag_charge_runs (
    run_number,organization_id,client_id,agreement_id,charge_type,period_start,period_end,
    tariff_version,billable_units,total_amount,evidence_reference,charge_reason,prepared_by
  ) values (
    'EBC-' || pg_catalog.replace(gen_random_uuid()::text,'-',''), v_org,p_client_id,p_agreement_id,
    p_charge_type,p_start,p_end,v_quote->>'tariffVersion',
    (v_quote->>'billableUnits')::numeric,(v_quote->>'amount')::numeric,
    upper(btrim(p_evidence_reference)),nullif(btrim(p_charge_reason),''),(select auth.uid())
  ) returning id into v_id;
  insert into public.empty_bag_charge_days (
    run_id,charge_date,cohort_event_id,opening_bags,movement_bags,closing_bags,
    age_day,rate_etb,billable_units,amount_etb,movement_references
  )
  select v_id,row.charge_date,row.cohort_event_id,row.opening_bags,row.movement_bags,
    row.closing_bags,row.age_day,row.rate_etb,row.billable_units,row.amount_etb,row.movement_references
  from private.empty_bag_charge_rows(p_client_id,p_agreement_id,p_start,p_end,p_charge_type) row;
  perform private.record_audit('EMPTY_BAG_CHARGE_PREPARED','EMPTY_BAG_CHARGE_RUN',v_id,
    jsonb_build_object('type',p_charge_type,'client_id',p_client_id,'amount',v_quote->>'amount',
      'evidence',p_evidence_reference));
  return v_id;
end;
$$;
revoke all on function public.prepare_empty_bag_charge(uuid,uuid,date,date,text,text,text) from public, anon, authenticated;
grant execute on function public.prepare_empty_bag_charge(uuid,uuid,date,date,text,text,text) to authenticated;

create function public.decide_empty_bag_charge(
  p_run_id uuid, p_approve boolean, p_review_note text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_run public.empty_bag_charge_runs;
begin
  perform private.require_role('system_admin','warehouse_manager');
  select * into v_run from public.empty_bag_charge_runs
    where id = p_run_id and organization_id = (select private.current_organization_id()) for update;
  if not found or v_run.status <> 'PENDING_REVIEW' then
    raise exception 'Choose a pending bag charge in your organization.';
  end if;
  if v_run.prepared_by = (select auth.uid()) then
    raise exception 'A different employee must review this bag charge.';
  end if;
  if not coalesce(p_approve,false) and length(btrim(coalesce(p_review_note,''))) < 5 then
    raise exception 'Explain why the charge was rejected.';
  end if;
  if coalesce(p_approve,false) and v_run.charge_type = 'ARTICLE_16_4'
    and length(btrim(coalesce(p_review_note,''))) < 10 then
    raise exception 'Record why Article 16.4 applies to this period.';
  end if;
  update public.empty_bag_charge_runs
    set status = case when p_approve then 'APPROVED' else 'REJECTED' end,
      reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = nullif(btrim(p_review_note),'')
    where id = p_run_id;
  perform private.record_audit('EMPTY_BAG_CHARGE_REVIEWED','EMPTY_BAG_CHARGE_RUN',p_run_id,
    jsonb_build_object('approved',p_approve,'review_note',p_review_note));
end;
$$;
revoke all on function public.decide_empty_bag_charge(uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.decide_empty_bag_charge(uuid,boolean,text) to authenticated;

create function public.post_empty_bag_charge(p_run_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_run public.empty_bag_charge_runs;
  v_event_id uuid;
begin
  perform private.require_role('system_admin','finance_officer');
  select * into v_run from public.empty_bag_charge_runs
    where id = p_run_id and organization_id = (select private.current_organization_id()) for update;
  if not found or v_run.status <> 'APPROVED' then
    raise exception 'A separate manager must approve this bag charge before posting.';
  end if;
  if v_run.reviewed_by = (select auth.uid()) then
    raise exception 'The reviewer cannot also post this bag charge.';
  end if;
  perform private.validate_empty_bag_charge(
    v_run.client_id,v_run.agreement_id,v_run.period_start,v_run.period_end,v_run.charge_type);
  if v_run.total_amount > 0 then
    insert into public.service_events (
      client_id,service_type,description,quantity,unit_price,total_amount,
      reference_id,reference_type,service_date,unit_label,tariff_version
    ) values (
      v_run.client_id,'STORAGE',
      case when v_run.charge_type = 'STORAGE' then 'Empty jute-bag storage (Article 16)'
        else 'Empty jute-bag exception charge (Article 16.4)' end ||
        ' · ' || v_run.period_start || ' to ' || v_run.period_end,
      v_run.billable_units,round(v_run.total_amount / nullif(v_run.billable_units,0),2),
      v_run.total_amount,v_run.id,'EMPTY_BAG_CHARGE_RUN',v_run.period_end,
      case when v_run.charge_type = 'STORAGE' then '50-bag days' else 'days' end,
      v_run.tariff_version
    ) returning id into v_event_id;
  end if;
  update public.empty_bag_charge_runs
    set status = 'POSTED', posted_by = (select auth.uid()), posted_at = now(),
      service_event_id = v_event_id where id = p_run_id;
  perform private.record_audit('EMPTY_BAG_CHARGE_POSTED','EMPTY_BAG_CHARGE_RUN',p_run_id,
    jsonb_build_object('amount',v_run.total_amount,'service_event_id',v_event_id));
  return v_event_id;
end;
$$;
revoke all on function public.post_empty_bag_charge(uuid) from public, anon, authenticated;
grant execute on function public.post_empty_bag_charge(uuid) to authenticated;

create trigger empty_bag_cohort_allocation_immutable before update or delete
on public.empty_bag_cohort_allocations for each row execute function private.prevent_mutation();
create trigger empty_bag_charge_days_immutable before update or delete
on public.empty_bag_charge_days for each row execute function private.prevent_mutation();

create or replace function private.enforce_service_pricing_before_invoice()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status = 'PREPARED' and old.status is distinct from 'PREPARED' then
    if old.service_type = 'STORAGE' and old.reference_type = 'EMPTY_BAG_CHARGE_RUN' then
      if not exists (
        select 1 from public.empty_bag_charge_runs run
        where run.id = old.reference_id and run.service_event_id = old.id
          and run.status = 'POSTED' and run.total_amount = old.total_amount
          and run.tariff_version = old.tariff_version
          and exists (select 1 from public.empty_bag_charge_days day where day.run_id = run.id)
          and (select coalesce(sum(day.amount_etb),0) from public.empty_bag_charge_days day
            where day.run_id = run.id) = run.total_amount
      ) then raise exception 'Empty-bag service lacks an approved, posted daily calculation.'; end if;
    elsif old.service_type = 'STORAGE' then
      if not exists (
        select 1 from public.storage_billing_runs run
        where run.id = old.reference_id and run.total_amount = old.total_amount
          and exists (select 1 from public.storage_billing_run_days day where day.run_id = run.id)
          and abs((select coalesce(sum(day.amount_etb),0) from public.storage_billing_run_days day
            where day.run_id = run.id) - run.total_amount) <= 0.01
      ) then raise exception 'Storage service lacks matching daily billing evidence.'; end if;
    elsif old.service_type in ('PROCESSING','HULLING','CLEANING','TRANSPORT','OTHER','LABOUR',
      'LOADING','UNLOADING','WEIGHING','BAG_PRINTING','PACKING','VACUUM_PACKING',
      'CONTAINER_HANDLING','GENERATOR','CERTIFICATION') then
      if not exists (
        select 1 from public.manual_service_records record
        join public.service_rate_catalog rate on rate.id = record.service_rate_id
        join public.tariff_versions tariff on tariff.id = rate.tariff_version_id
        where record.service_event_id = old.id and record.unit_price = rate.unit_price
          and tariff.active and tariff.verified_by_1 is not null and tariff.verified_by_2 is not null
          and tariff.verified_by_1 <> tariff.verified_by_2
      ) then raise exception 'Manual service lacks an independently verified catalog rate.'; end if;
    else
      raise exception 'The % service rate is not yet approved for invoice preparation.', old.service_type;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_service_pricing_before_invoice() from public, anon, authenticated;

create function private.mark_empty_bag_charge_invoiced()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'INVOICED' and old.status is distinct from 'INVOICED'
    and new.reference_type = 'EMPTY_BAG_CHARGE_RUN' then
    update public.empty_bag_charge_runs set status = 'INVOICED'
    where id = new.reference_id and service_event_id = new.id and status = 'POSTED';
    if not found then raise exception 'The empty-bag charge is not posted.'; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.mark_empty_bag_charge_invoiced() from public, anon, authenticated;
create trigger empty_bag_charge_invoice_sync after update of status on public.service_events
for each row execute function private.mark_empty_bag_charge_invoiced();
