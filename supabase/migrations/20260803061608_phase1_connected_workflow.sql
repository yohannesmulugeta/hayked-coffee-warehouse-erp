create table public.number_sequences (
  scope_key text primary key,
  organization_id uuid not null references public.organizations(id),
  warehouse_id uuid references public.warehouses(id),
  document_type text not null,
  calendar_year integer not null check (calendar_year between 2000 and 2200),
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now()
);

alter table public.number_sequences enable row level security;
revoke all on public.number_sequences from public, anon, authenticated;

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
  if document_type not in ('GRN', 'PROCESSING_REQUEST', 'DISPATCH', 'INVOICE', 'PAYMENT', 'DOCUMENT') then
    raise exception 'Unsupported document number type';
  end if;
  if calendar_year < 2000 or calendar_year > 2200 then raise exception 'Invalid document year'; end if;

  select o.* into organization
  from public.organizations o
  join public.profiles p on p.organization_id = o.id
  where p.id = (select auth.uid());
  if not found then raise exception 'User organization not found'; end if;

  select w.* into warehouse
  from public.warehouses w
  where w.organization_id = organization.id and w.code = warehouse_code and w.active;
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
    when 'PAYMENT' then 'PAY'
    when 'DOCUMENT' then 'DOC'
    else document_type
  end;
  return prefix || '-' || warehouse.code || '-' || calendar_year || '-' || lpad(next_value::text, 4, '0');
end;
$$;

revoke all on function public.next_erp_number(text, text, integer) from public, anon;
grant execute on function public.next_erp_number(text, text, integer) to authenticated;

alter table public.processing_requests add column request_number text;

with numbered as (
  select id, extract(year from request_date)::integer as request_year,
    row_number() over (partition by extract(year from request_date) order by created_at, id) as sequence_number
  from public.processing_requests
)
update public.processing_requests request
set request_number = 'PR-GEL-' || numbered.request_year || '-' || lpad(numbered.sequence_number::text, 4, '0')
from numbered where numbered.id = request.id;

alter table public.processing_requests alter column request_number set not null;
create unique index processing_requests_request_number_idx on public.processing_requests (request_number);

insert into public.number_sequences (
  scope_key, organization_id, warehouse_id, document_type, calendar_year, last_value
)
select organization.id || '|' || warehouse.id || '|PROCESSING_REQUEST|' || years.request_year,
  organization.id, warehouse.id, 'PROCESSING_REQUEST', years.request_year, years.request_count
from public.organizations organization
join public.warehouses warehouse on warehouse.organization_id = organization.id and warehouse.code = 'GEL'
cross join (
  select extract(year from request_date)::integer as request_year, count(*) as request_count
  from public.processing_requests group by extract(year from request_date)
) years
on conflict (scope_key) do update set last_value = excluded.last_value, updated_at = now();

create or replace function public.update_grn_draft(
  receipt_id uuid,
  client_id uuid,
  agreement_id uuid,
  representative_id uuid,
  arrival_at timestamptz,
  coffee_type text,
  bag_count integer,
  net_weight_kg numeric,
  vehicle_plate text,
  section text,
  driver_name text,
  seal_number text,
  weighbridge_reference text,
  origin text,
  grade text,
  crop_year integer,
  bag_weight_kg numeric,
  gross_weight_kg numeric,
  tare_weight_kg numeric,
  moisture_percent numeric,
  wet_coffee boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  receipt public.warehouse_receipts;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer');
  select * into receipt from public.warehouse_receipts where id = receipt_id for update;
  if not found then raise exception 'Warehouse receipt not found'; end if;
  if receipt.status <> 'DRAFT' then raise exception 'Only a draft GRN can be edited'; end if;
  if bag_count <= 0 or net_weight_kg <= 0 or bag_weight_kg <= 0 then raise exception 'Bags and weights must be positive'; end if;
  if gross_weight_kg <= 0 or tare_weight_kg < 0 or abs(gross_weight_kg - tare_weight_kg - net_weight_kg) > 0.01 then
    raise exception 'Net weight must equal gross weight minus tare weight';
  end if;
  if not exists (
    select 1 from public.clients c where c.id = update_grn_draft.client_id and c.active
  ) then raise exception 'Active client not found'; end if;
  if not exists (
    select 1 from public.agreements a where a.id = update_grn_draft.agreement_id and a.client_id = update_grn_draft.client_id and a.status = 'ACTIVE'
      and a.effective_from <= update_grn_draft.arrival_at::date and (a.effective_to is null or a.effective_to >= update_grn_draft.arrival_at::date)
  ) then raise exception 'A valid active client agreement is required'; end if;
  if not exists (
    select 1 from public.authorized_representatives r where r.id = update_grn_draft.representative_id and r.client_id = update_grn_draft.client_id and r.active
      and r.valid_from <= update_grn_draft.arrival_at::date and (r.valid_to is null or r.valid_to >= update_grn_draft.arrival_at::date)
  ) then raise exception 'A valid authorized representative is required'; end if;

  update public.warehouse_receipts set
    client_id = update_grn_draft.client_id,
    agreement_id = update_grn_draft.agreement_id,
    representative_id = update_grn_draft.representative_id,
    arrival_at = update_grn_draft.arrival_at,
    coffee_type = update_grn_draft.coffee_type,
    bag_count = update_grn_draft.bag_count,
    net_weight_kg = update_grn_draft.net_weight_kg,
    vehicle_plate = update_grn_draft.vehicle_plate,
    section = update_grn_draft.section,
    driver_name = update_grn_draft.driver_name,
    seal_number = update_grn_draft.seal_number,
    weighbridge_reference = update_grn_draft.weighbridge_reference,
    origin = update_grn_draft.origin,
    grade = update_grn_draft.grade,
    crop_year = update_grn_draft.crop_year,
    bag_weight_kg = update_grn_draft.bag_weight_kg,
    gross_weight_kg = update_grn_draft.gross_weight_kg,
    tare_weight_kg = update_grn_draft.tare_weight_kg,
    moisture_percent = update_grn_draft.moisture_percent,
    wet_coffee = update_grn_draft.wet_coffee
  where id = receipt_id;

  perform private.record_audit('GRN_DRAFT_UPDATED', 'WAREHOUSE_RECEIPT', receipt_id,
    jsonb_build_object('receipt_number', receipt.receipt_number));
  return jsonb_build_object('id', receipt_id, 'receipt_number', receipt.receipt_number, 'status', 'DRAFT');
end;
$$;

revoke all on function public.update_grn_draft(uuid, uuid, uuid, uuid, timestamptz, text, integer, numeric, text, text, text, text, text, text, text, integer, numeric, numeric, numeric, numeric, boolean) from public, anon;
grant execute on function public.update_grn_draft(uuid, uuid, uuid, uuid, timestamptz, text, integer, numeric, text, text, text, text, text, text, text, integer, numeric, numeric, numeric, numeric, boolean) to authenticated;
