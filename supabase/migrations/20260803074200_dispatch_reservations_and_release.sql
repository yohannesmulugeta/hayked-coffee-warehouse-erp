create table public.dispatch_lines (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references public.dispatch_orders(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  lot_id uuid not null references public.coffee_lots(id),
  bag_count integer not null check (bag_count > 0),
  quantity_kg numeric(16,3) not null check (quantity_kg > 0),
  created_at timestamptz not null default now(),
  unique (dispatch_id, line_number),
  unique (dispatch_id, lot_id)
);

create table public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references public.dispatch_orders(id) on delete cascade,
  lot_id uuid not null references public.coffee_lots(id),
  reserved_bags integer not null check (reserved_bags > 0),
  reserved_kg numeric(16,3) not null check (reserved_kg > 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CONSUMED', 'RELEASED')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  unique (dispatch_id, lot_id),
  check (status = 'ACTIVE' or released_at is not null)
);

create table public.credit_overrides (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null unique references public.dispatch_orders(id) on delete cascade,
  amount_etb numeric(16,2) not null check (amount_etb > 0),
  expires_on date not null,
  reason text not null,
  document_reference text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
  requested_by uuid not null references public.profiles(id),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (decided_by is null or decided_by <> requested_by),
  check (status = 'PENDING' or (decided_by is not null and decided_at is not null))
);

alter table public.dispatch_orders
  add column dispatch_date date not null default current_date,
  add column dispatch_reason text not null default 'Export',
  add column destination text,
  add column documents_reference text,
  add column weighbridge_reference text,
  add column notes text;

insert into public.dispatch_lines (dispatch_id, line_number, lot_id, bag_count, quantity_kg)
select id, 1, lot_id, bag_count, quantity_kg from public.dispatch_orders
on conflict (dispatch_id, lot_id) do nothing;

create unique index stock_movements_dispatch_once_idx
  on public.stock_movements (reference_id, lot_id)
  where reference_type = 'DISPATCH_ORDER' and movement_type = 'DISPATCH';

alter table public.dispatch_lines enable row level security;
alter table public.stock_reservations enable row level security;
alter table public.credit_overrides enable row level security;
create policy staff_read on public.dispatch_lines for select to authenticated
using ((select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'finance_officer', 'auditor', 'viewer')));
create policy staff_read on public.stock_reservations for select to authenticated
using ((select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'finance_officer', 'auditor', 'viewer')));
create policy staff_read on public.credit_overrides for select to authenticated
using ((select private.has_role('system_admin', 'warehouse_manager', 'finance_officer', 'auditor')));
revoke all on public.dispatch_lines, public.stock_reservations, public.credit_overrides from public, anon, authenticated;
grant select on public.dispatch_lines, public.stock_reservations, public.credit_overrides to authenticated;

create or replace function public.create_dispatch_draft(p_header jsonb, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  dispatch public.dispatch_orders;
  client public.clients;
  representative public.authorized_representatives;
  lot public.coffee_lots;
  line jsonb;
  line_no integer := 0;
  total_bags integer := 0;
  total_kg numeric := 0;
  reserved_bags integer;
  reserved_kg numeric;
  first_lot_id uuid;
  seen_lots uuid[] := '{}';
  invoices_clear boolean;
  dispatch_number text;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer');
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'At least one dispatch line is required'; end if;
  select * into client from public.clients where id = (p_header ->> 'clientId')::uuid and active;
  if not found then raise exception 'Active client not found'; end if;
  select * into representative from public.authorized_representatives
    where id = (p_header ->> 'representativeId')::uuid and client_id = client.id and active
      and current_date between valid_from and valid_to;
  if not found then raise exception 'A currently valid client representative is required'; end if;

  for line in select value from jsonb_array_elements(p_lines)
  loop
    line_no := line_no + 1;
    if (line ->> 'lotId')::uuid = any(seen_lots) then raise exception 'A dispatch lot can only appear once'; end if;
    seen_lots := array_append(seen_lots, (line ->> 'lotId')::uuid);
    select * into lot from public.coffee_lots where id = (line ->> 'lotId')::uuid for update;
    if not found or lot.client_id <> client.id or lot.ownership_type <> 'CLIENT' then raise exception 'Every dispatch lot must be available client-owned stock'; end if;
    if (line ->> 'bagCount')::integer <= 0 or (line ->> 'quantityKg')::numeric <= 0 then raise exception 'Dispatch bags and kilograms must be positive'; end if;
    select coalesce(sum(r.reserved_bags),0), coalesce(sum(r.reserved_kg),0) into reserved_bags, reserved_kg
      from public.stock_reservations r where r.lot_id = lot.id and r.status = 'ACTIVE';
    if lot.bag_count - reserved_bags < (line ->> 'bagCount')::integer or lot.quantity_kg - reserved_kg < (line ->> 'quantityKg')::numeric then
      raise exception 'Requested dispatch quantity exceeds unreserved stock';
    end if;
    if line_no = 1 then first_lot_id := lot.id; end if;
    total_bags := total_bags + (line ->> 'bagCount')::integer;
    total_kg := total_kg + (line ->> 'quantityKg')::numeric;
  end loop;

  select coalesce(bool_and(status = 'PAID'), false) into invoices_clear from public.invoices where client_id = client.id;
  dispatch_number := replace(public.next_erp_number('DISPATCH', 'GEL', extract(year from (p_header ->> 'dispatchDate')::date)::integer), 'DISPATCH-', 'DSP-');
  insert into public.dispatch_orders (
    dispatch_number, lot_id, client_id, representative_id, quantity_kg, bag_count,
    invoices_paid, documents_ready, weighbridge_ready, legal_or_quality_hold,
    status, prepared_by, dispatch_date, dispatch_reason, destination,
    documents_reference, weighbridge_reference, notes
  ) values (
    dispatch_number, first_lot_id, client.id, representative.id, total_kg, total_bags,
    invoices_clear, nullif(btrim(p_header ->> 'documentsReference'), '') is not null,
    nullif(btrim(p_header ->> 'weighbridgeReference'), '') is not null, false,
    'DRAFT', (select auth.uid()), (p_header ->> 'dispatchDate')::date,
    p_header ->> 'reason', nullif(btrim(p_header ->> 'destination'), ''),
    nullif(btrim(p_header ->> 'documentsReference'), ''),
    nullif(btrim(p_header ->> 'weighbridgeReference'), ''), nullif(btrim(p_header ->> 'notes'), '')
  ) returning * into dispatch;

  line_no := 0;
  for line in select value from jsonb_array_elements(p_lines)
  loop
    line_no := line_no + 1;
    insert into public.dispatch_lines (dispatch_id, line_number, lot_id, bag_count, quantity_kg)
      values (dispatch.id, line_no, (line ->> 'lotId')::uuid, (line ->> 'bagCount')::integer, (line ->> 'quantityKg')::numeric);
    insert into public.stock_reservations (dispatch_id, lot_id, reserved_bags, reserved_kg, created_by)
      values (dispatch.id, (line ->> 'lotId')::uuid, (line ->> 'bagCount')::integer, (line ->> 'quantityKg')::numeric, (select auth.uid()));
  end loop;
  if coalesce((p_header ->> 'creditAmount')::numeric, 0) > 0 then
    insert into public.credit_overrides (dispatch_id, amount_etb, expires_on, reason, document_reference, requested_by)
    values (dispatch.id, (p_header ->> 'creditAmount')::numeric, (p_header ->> 'creditExpiry')::date,
      p_header ->> 'creditReason', p_header ->> 'creditDocumentReference', (select auth.uid()));
  end if;
  perform private.record_audit('DISPATCH_DRAFT_CREATED', 'DISPATCH_ORDER', dispatch.id,
    jsonb_build_object('dispatch_number', dispatch_number, 'line_count', line_no, 'quantity_kg', total_kg));
  return jsonb_build_object('id', dispatch.id, 'dispatch_number', dispatch_number);
end;
$$;

create or replace function public.submit_dispatch(p_dispatch_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare dispatch public.dispatch_orders;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer');
  select * into dispatch from public.dispatch_orders where id = p_dispatch_id for update;
  if not found or dispatch.status <> 'DRAFT' then raise exception 'Only a draft dispatch can be submitted'; end if;
  update public.dispatch_orders set status = 'AWAITING_APPROVAL' where id = dispatch.id;
  perform private.record_audit('DISPATCH_SUBMITTED', 'DISPATCH_ORDER', dispatch.id, '{}'::jsonb);
  return jsonb_build_object('id', dispatch.id, 'status', 'AWAITING_APPROVAL');
end;
$$;

create or replace function public.decide_credit_override(p_credit_id uuid, p_decision text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare credit public.credit_overrides;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'finance_officer');
  if p_decision not in ('APPROVED', 'REJECTED') then raise exception 'Unsupported credit decision'; end if;
  select * into credit from public.credit_overrides where id = p_credit_id for update;
  if not found or credit.status <> 'PENDING' then raise exception 'Only a pending credit override can be decided'; end if;
  if credit.requested_by = (select auth.uid()) then raise exception 'The credit requester cannot decide the override'; end if;
  update public.credit_overrides set status = p_decision, decided_by = (select auth.uid()), decided_at = now() where id = credit.id;
  update public.dispatch_orders set credit_approved = p_decision = 'APPROVED' where id = credit.dispatch_id;
  perform private.record_audit('CREDIT_OVERRIDE_' || p_decision, 'DISPATCH_ORDER', credit.dispatch_id, jsonb_build_object('credit_id', credit.id));
  return jsonb_build_object('id', credit.id, 'status', p_decision);
end;
$$;

create or replace function public.approve_dispatch(p_dispatch_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare dispatch public.dispatch_orders;
declare active_reservations integer;
declare active_agreements integer;
begin
  perform private.require_role('system_admin', 'warehouse_manager');
  select * into dispatch from public.dispatch_orders where id = p_dispatch_id for update;
  if not found or dispatch.status <> 'AWAITING_APPROVAL' then raise exception 'Only a submitted dispatch can be approved'; end if;
  if dispatch.prepared_by = (select auth.uid()) then raise exception 'The dispatch preparer cannot approve it'; end if;
  select count(*) into active_agreements from public.agreements
    where client_id = dispatch.client_id and status = 'ACTIVE'
      and dispatch.dispatch_date between effective_from and effective_to;
  if active_agreements = 0 then raise exception 'An active agreement is required'; end if;
  select count(*) into active_reservations from public.stock_reservations where dispatch_id = dispatch.id and status = 'ACTIVE';
  if active_reservations = 0 then raise exception 'Active stock reservations are required'; end if;
  if not (dispatch.invoices_paid or dispatch.credit_approved) then raise exception 'Paid invoices or an approved credit override are required'; end if;
  if not dispatch.documents_ready or dispatch.documents_reference is null then raise exception 'Document references are incomplete'; end if;
  if not dispatch.weighbridge_ready or dispatch.weighbridge_reference is null then raise exception 'Weighbridge reference is incomplete'; end if;
  if dispatch.legal_or_quality_hold then raise exception 'A legal or quality hold blocks release'; end if;
  update public.dispatch_orders set status = 'APPROVED', approved_by = (select auth.uid()) where id = dispatch.id;
  perform private.record_audit('DISPATCH_APPROVED', 'DISPATCH_ORDER', dispatch.id, jsonb_build_object('reservations', active_reservations));
  return jsonb_build_object('id', dispatch.id, 'status', 'APPROVED');
end;
$$;

create or replace function public.post_dispatch_v2(p_dispatch_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare dispatch public.dispatch_orders;
declare line public.dispatch_lines;
declare lot public.coffee_lots;
declare reservation public.stock_reservations;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer');
  select * into dispatch from public.dispatch_orders where id = p_dispatch_id for update;
  if not found then raise exception 'Dispatch not found'; end if;
  if dispatch.status = 'POSTED' then return jsonb_build_object('id', dispatch.id, 'status', 'POSTED', 'duplicate', true); end if;
  if dispatch.status <> 'APPROVED' or dispatch.approved_by is null or dispatch.approved_by = dispatch.prepared_by then raise exception 'Independent approved dispatch is required'; end if;
  for line in select * from public.dispatch_lines where dispatch_id = dispatch.id order by line_number
  loop
    select * into reservation from public.stock_reservations where dispatch_id = dispatch.id and lot_id = line.lot_id and status = 'ACTIVE' for update;
    if not found then raise exception 'An active stock reservation is missing'; end if;
    select * into lot from public.coffee_lots where id = line.lot_id for update;
    if lot.quantity_kg < line.quantity_kg or lot.bag_count < line.bag_count then raise exception 'Reserved lot stock is no longer sufficient'; end if;
    insert into public.stock_movements (lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta, reference_type, reference_id, reason, posted_by)
      values (lot.id, lot.warehouse_id, lot.client_id, 'DISPATCH', -line.quantity_kg, -line.bag_count, 'DISPATCH_ORDER', dispatch.id, 'Reserved dispatch posted', (select auth.uid()));
    update public.coffee_lots set quantity_kg = quantity_kg - line.quantity_kg, bag_count = bag_count - line.bag_count,
      status = case when quantity_kg - line.quantity_kg <= 0.01 then 'DISPATCHED' else 'AWAITING_DISPATCH' end where id = lot.id;
    update public.stock_reservations set status = 'CONSUMED', released_at = now() where id = reservation.id;
  end loop;
  update public.dispatch_orders set status = 'POSTED', posted_at = now() where id = dispatch.id;
  perform private.record_audit('DISPATCH_POSTED', 'DISPATCH_ORDER', dispatch.id, jsonb_build_object('quantity_kg', dispatch.quantity_kg, 'bag_count', dispatch.bag_count));
  return jsonb_build_object('id', dispatch.id, 'status', 'POSTED');
end;
$$;

revoke all on function public.create_dispatch_draft(jsonb, jsonb), public.submit_dispatch(uuid), public.decide_credit_override(uuid, text), public.approve_dispatch(uuid), public.post_dispatch_v2(uuid) from public, anon;
revoke execute on function public.post_dispatch(uuid) from authenticated;
grant execute on function public.create_dispatch_draft(jsonb, jsonb), public.submit_dispatch(uuid), public.decide_credit_override(uuid, text), public.approve_dispatch(uuid), public.post_dispatch_v2(uuid) to authenticated;
