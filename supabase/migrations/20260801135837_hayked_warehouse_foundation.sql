create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  currency text not null default 'ETB' check (currency = 'ETB'),
  timezone text not null default 'Africa/Addis_Ababa',
  created_at timestamptz not null default now()
);

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code text not null,
  name text not null,
  location text not null,
  is_primary boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);
create unique index warehouses_one_primary_idx on public.warehouses (organization_id) where is_primary;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  full_name text not null,
  role text not null default 'viewer' check (role in ('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'finance_officer', 'auditor', 'viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code text not null,
  legal_name text not null,
  tin text,
  phone text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  unique (organization_id, code)
);

create table public.agreements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  agreement_number text not null unique,
  effective_from date not null,
  effective_to date,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED')),
  default_bag_weight_kg numeric(8,3) not null default 60 check (default_bag_weight_kg > 0),
  tariff_version text not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  check (effective_to is null or effective_to >= effective_from)
);

create table public.authorized_representatives (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  full_name text not null,
  identity_number text not null,
  phone text,
  valid_from date not null,
  valid_to date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_id, identity_number),
  check (valid_to is null or valid_to >= valid_from)
);

create table public.warehouse_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  warehouse_id uuid not null references public.warehouses(id),
  client_id uuid not null references public.clients(id),
  agreement_id uuid not null references public.agreements(id),
  representative_id uuid references public.authorized_representatives(id),
  arrival_at timestamptz not null,
  coffee_type text not null check (coffee_type in ('WASHED', 'UNWASHED_UG')),
  bag_count integer not null check (bag_count > 0),
  net_weight_kg numeric(16,3) not null check (net_weight_kg > 0),
  vehicle_plate text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REVERSED')),
  prepared_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  posted_at timestamptz,
  reversed_receipt_id uuid references public.warehouse_receipts(id),
  created_at timestamptz not null default now(),
  check (approved_by is null or approved_by <> prepared_by),
  check (status not in ('APPROVED', 'POSTED') or approved_by is not null),
  check (status <> 'POSTED' or posted_at is not null)
);

create table public.coffee_lots (
  id uuid primary key default gen_random_uuid(),
  lot_number text not null unique,
  warehouse_id uuid not null references public.warehouses(id),
  client_id uuid not null references public.clients(id),
  receipt_id uuid references public.warehouse_receipts(id),
  parent_lot_id uuid references public.coffee_lots(id),
  coffee_type text not null check (coffee_type in ('WASHED', 'UNWASHED_UG')),
  ownership_type text not null default 'CLIENT' check (ownership_type in ('CLIENT', 'HAYKED')),
  bag_count integer not null default 0 check (bag_count >= 0),
  quantity_kg numeric(16,3) not null default 0 check (quantity_kg >= 0),
  section text not null,
  status text not null default 'ARRIVAL_IN_STORAGE' check (status in ('ARRIVAL_IN_STORAGE', 'WAITING_PROCESSING', 'IN_PROCESS', 'PROCESSED', 'AWAITING_DISPATCH', 'IN_TRANSIT', 'DISPATCHED', 'CLOSED')),
  created_at timestamptz not null default now()
);
create index coffee_lots_client_status_idx on public.coffee_lots (client_id, status);
create index coffee_lots_warehouse_section_idx on public.coffee_lots (warehouse_id, section);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.coffee_lots(id),
  warehouse_id uuid not null references public.warehouses(id),
  client_id uuid references public.clients(id),
  movement_type text not null check (movement_type in ('RECEIPT', 'PROCESS_INPUT', 'PROCESS_OUTPUT', 'STORAGE_LOSS', 'DISPATCH', 'ECS_SEND', 'ECS_RECEIVE', 'OWNERSHIP_OUT', 'OWNERSHIP_IN', 'REVERSAL', 'ADJUSTMENT')),
  quantity_kg numeric(16,3) not null,
  bag_delta integer not null default 0,
  reference_type text not null,
  reference_id uuid not null,
  reverses_movement_id uuid references public.stock_movements(id),
  reason text,
  occurred_at timestamptz not null default now(),
  posted_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (quantity_kg <> 0 or bag_delta <> 0),
  check (movement_type <> 'REVERSAL' or reverses_movement_id is not null)
);
create index stock_movements_lot_occurred_idx on public.stock_movements (lot_id, occurred_at, id);
create index stock_movements_client_occurred_idx on public.stock_movements (client_id, occurred_at);
create unique index stock_movements_one_reversal_idx on public.stock_movements (reverses_movement_id) where reverses_movement_id is not null;

create table public.processing_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  lot_id uuid not null references public.coffee_lots(id),
  client_id uuid not null references public.clients(id),
  queue_position integer not null check (queue_position > 0),
  input_kg numeric(16,3) not null check (input_kg > 0),
  accepted_client_kg numeric(16,3) not null default 0 check (accepted_client_kg >= 0),
  client_reject_kg numeric(16,3) not null default 0 check (client_reject_kg >= 0),
  hayked_byproduct_kg numeric(16,3) not null default 0 check (hayked_byproduct_kg >= 0),
  process_loss_kg numeric(16,3) not null default 0 check (process_loss_kg >= 0),
  allowance_percent numeric(6,3) not null check (allowance_percent in (22.5, 2.5)),
  exception_evidence_path text,
  status text not null default 'QUEUED' check (status in ('QUEUED', 'BLOCKED', 'IN_PROCESS', 'AWAITING_APPROVAL', 'POSTED', 'REVERSED')),
  prepared_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (approved_by is null or approved_by <> prepared_by),
  check (status <> 'POSTED' or abs(input_kg - accepted_client_kg - client_reject_kg - hayked_byproduct_kg - process_loss_kg) <= 0.01)
);
create index processing_orders_queue_idx on public.processing_orders (status, queue_position, created_at);

create table public.dispatch_orders (
  id uuid primary key default gen_random_uuid(),
  dispatch_number text not null unique,
  lot_id uuid not null references public.coffee_lots(id),
  client_id uuid not null references public.clients(id),
  representative_id uuid not null references public.authorized_representatives(id),
  quantity_kg numeric(16,3) not null check (quantity_kg > 0),
  bag_count integer not null check (bag_count > 0),
  invoices_paid boolean not null default false,
  credit_approved boolean not null default false,
  documents_ready boolean not null default false,
  weighbridge_ready boolean not null default false,
  legal_or_quality_hold boolean not null default false,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'POSTED', 'REVERSED')),
  prepared_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  check (approved_by is null or approved_by <> prepared_by),
  check (status <> 'POSTED' or ((invoices_paid or credit_approved) and documents_ready and weighbridge_ready and not legal_or_quality_hold and approved_by is not null))
);

create table public.ecs_transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_number text not null unique,
  lot_id uuid not null references public.coffee_lots(id),
  client_id uuid not null references public.clients(id),
  source_warehouse_id uuid not null references public.warehouses(id),
  destination_warehouse_id uuid not null references public.warehouses(id),
  sent_kg numeric(16,3) not null check (sent_kg > 0),
  received_kg numeric(16,3),
  status text not null default 'IN_TRANSIT' check (status in ('IN_TRANSIT', 'RECEIVED', 'REVERSED')),
  sent_at timestamptz not null,
  received_at timestamptz,
  variance_approved_by uuid references public.profiles(id),
  prepared_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (source_warehouse_id <> destination_warehouse_id),
  check (status <> 'RECEIVED' or (received_kg is not null and received_at is not null)),
  check (received_kg is null or abs(received_kg - sent_kg) <= 0.01 or variance_approved_by is not null)
);

create table public.ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_number text not null unique,
  source_lot_id uuid not null references public.coffee_lots(id),
  child_lot_id uuid references public.coffee_lots(id),
  source_client_id uuid not null references public.clients(id),
  destination_client_id uuid not null references public.clients(id),
  quantity_kg numeric(16,3) not null check (quantity_kg > 0),
  signed_instruction_path text not null,
  source_approved_at timestamptz not null,
  destination_accepted_at timestamptz not null,
  hayked_approved_by uuid not null references public.profiles(id),
  status text not null default 'APPROVED' check (status in ('APPROVED', 'POSTED', 'REVERSED')),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  check (source_client_id <> destination_client_id),
  check (status <> 'POSTED' or (child_lot_id is not null and posted_at is not null))
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  client_id uuid not null references public.clients(id),
  tariff_version text not null,
  issued_on date,
  due_on date,
  line_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(line_snapshot) = 'array'),
  subtotal_etb numeric(16,2) not null default 0 check (subtotal_etb >= 0),
  tax_etb numeric(16,2) not null default 0 check (tax_etb >= 0),
  total_etb numeric(16,2) generated always as (subtotal_etb + tax_etb) stored,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (due_on is null or issued_on is null or due_on >= issued_on),
  check (status = 'DRAFT' or issued_on is not null)
);
create index invoices_client_status_idx on public.invoices (client_id, status, due_on);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  payment_number text not null unique,
  invoice_id uuid not null references public.invoices(id),
  client_id uuid not null references public.clients(id),
  direction text not null default 'PAYMENT' check (direction in ('PAYMENT', 'REVERSAL')),
  amount_etb numeric(16,2) not null check (amount_etb > 0),
  paid_at timestamptz not null,
  bank_reference text not null,
  reverses_payment_id uuid references public.payments(id),
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (direction <> 'REVERSAL' or reverses_payment_id is not null)
);
create unique index payments_one_reversal_idx on public.payments (reverses_payment_id) where reverses_payment_id is not null;

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  request_type text not null,
  reference_id uuid not null,
  requested_by uuid not null references public.profiles(id),
  requested_at timestamptz not null default now(),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  check (decided_by is null or decided_by <> requested_by),
  check (status = 'PENDING' or (decided_by is not null and decided_at is not null))
);
create index approvals_pending_idx on public.approvals (status, requested_at) where status = 'PENDING';

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  document_number text not null unique,
  document_type text not null,
  reference_type text not null,
  reference_id uuid not null,
  version integer not null default 1 check (version > 0),
  previous_version_id uuid references public.documents(id),
  bucket_id text not null default 'erp-documents' check (bucket_id = 'erp-documents'),
  object_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  checksum_sha256 text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'POSTED', 'SUPERSEDED')),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (reference_type, reference_id, document_type, version)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  actor_id uuid not null references public.profiles(id),
  action text not null,
  reference_type text not null,
  reference_id uuid not null,
  event_data jsonb not null default '{}'::jsonb check (jsonb_typeof(event_data) = 'object'),
  occurred_at timestamptz not null default now()
);
create index audit_events_reference_idx on public.audit_events (reference_type, reference_id, occurred_at desc);
create index audit_events_actor_idx on public.audit_events (actor_id, occurred_at desc);

insert into public.organizations (code, name)
values ('HAYKED', 'Hayked General Trading PLC')
on conflict (code) do nothing;

insert into public.warehouses (organization_id, code, name, location, is_primary)
select id, 'GEL', 'Main Warehouse', 'Gelancho, Addis Ababa', true
from public.organizations where code = 'HAYKED'
on conflict (organization_id, code) do nothing;

create or replace function private.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles
  where id = (select auth.uid()) and active;
$$;
revoke all on function private.current_app_role() from public, anon;
grant execute on function private.current_app_role() to authenticated;

create or replace function private.has_role(variadic required_roles text[])
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select private.current_app_role()) = any(required_roles), false);
$$;
revoke all on function private.has_role(text[]) from public, anon;
grant execute on function private.has_role(text[]) to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, organization_id, full_name)
  select new.id, organization.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  from public.organizations as organization
  where organization.code = 'HAYKED';
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;
create trigger auth_user_profile_created after insert on auth.users for each row execute function private.handle_new_user();

create or replace function private.prevent_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception '% records are append-only; post a reversal or compensating entry', tg_table_name;
end;
$$;
revoke all on function private.prevent_mutation() from public, anon, authenticated;

create or replace function private.prevent_final_record_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status in ('POSTED', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID', 'SUPERSEDED') then
    raise exception 'Finalized % records are immutable; create a new version or compensating entry', tg_table_name;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.prevent_final_record_mutation() from public, anon, authenticated;

create trigger stock_movements_immutable before update or delete on public.stock_movements for each row execute function private.prevent_mutation();
create trigger payments_immutable before update or delete on public.payments for each row execute function private.prevent_mutation();
create trigger audit_events_immutable before update or delete on public.audit_events for each row execute function private.prevent_mutation();
create trigger invoices_final_immutable before update or delete on public.invoices for each row execute function private.prevent_final_record_mutation();
create trigger documents_final_immutable before update or delete on public.documents for each row execute function private.prevent_final_record_mutation();

do $$
declare table_name text;
begin
  foreach table_name in array array['organizations', 'warehouses', 'profiles', 'clients', 'agreements', 'authorized_representatives', 'warehouse_receipts', 'coffee_lots', 'stock_movements', 'processing_orders', 'dispatch_orders', 'ecs_transfers', 'ownership_transfers', 'invoices', 'payments', 'approvals', 'documents', 'audit_events']
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy staff_read on public.%I for select to authenticated using ((select private.has_role(''system_admin'', ''warehouse_manager'', ''warehouse_officer'', ''processing_supervisor'', ''finance_officer'', ''auditor'', ''viewer'')))', table_name);
  end loop;
end;
$$;

create policy administration_insert on public.organizations for insert to authenticated with check ((select private.has_role('system_admin')));
create policy administration_update on public.organizations for update to authenticated using ((select private.has_role('system_admin'))) with check ((select private.has_role('system_admin')));
create policy administration_insert on public.warehouses for insert to authenticated with check ((select private.has_role('system_admin')));
create policy administration_update on public.warehouses for update to authenticated using ((select private.has_role('system_admin'))) with check ((select private.has_role('system_admin')));
create policy administration_update on public.profiles for update to authenticated using ((select private.has_role('system_admin'))) with check ((select private.has_role('system_admin')));

do $$
declare table_name text;
begin
  foreach table_name in array array['clients', 'agreements', 'authorized_representatives']
  loop
    execute format('create policy management_insert on public.%I for insert to authenticated with check ((select private.has_role(''system_admin'', ''warehouse_manager'')))', table_name);
    execute format('create policy management_update on public.%I for update to authenticated using ((select private.has_role(''system_admin'', ''warehouse_manager''))) with check ((select private.has_role(''system_admin'', ''warehouse_manager'')))', table_name);
  end loop;
  foreach table_name in array array['warehouse_receipts', 'coffee_lots', 'stock_movements', 'dispatch_orders', 'ecs_transfers', 'ownership_transfers']
  loop
    execute format('create policy warehouse_insert on public.%I for insert to authenticated with check ((select private.has_role(''system_admin'', ''warehouse_manager'', ''warehouse_officer'')))', table_name);
    if table_name <> 'stock_movements' then
      execute format('create policy warehouse_update on public.%I for update to authenticated using ((select private.has_role(''system_admin'', ''warehouse_manager'', ''warehouse_officer''))) with check ((select private.has_role(''system_admin'', ''warehouse_manager'', ''warehouse_officer'')))', table_name);
    end if;
  end loop;
end;
$$;

create policy processing_insert on public.processing_orders for insert to authenticated with check ((select private.has_role('system_admin', 'warehouse_manager', 'processing_supervisor')));
create policy processing_update on public.processing_orders for update to authenticated using ((select private.has_role('system_admin', 'warehouse_manager', 'processing_supervisor'))) with check ((select private.has_role('system_admin', 'warehouse_manager', 'processing_supervisor')));
create policy finance_insert on public.invoices for insert to authenticated with check ((select private.has_role('system_admin', 'warehouse_manager', 'finance_officer')));
create policy finance_update on public.invoices for update to authenticated using ((select private.has_role('system_admin', 'warehouse_manager', 'finance_officer'))) with check ((select private.has_role('system_admin', 'warehouse_manager', 'finance_officer')));
create policy payment_insert on public.payments for insert to authenticated with check ((select private.has_role('system_admin', 'warehouse_manager', 'finance_officer')));
create policy approval_request on public.approvals for insert to authenticated with check (requested_by = (select auth.uid()));
create policy approval_decision on public.approvals for update to authenticated using (requested_by <> (select auth.uid()) and (select private.has_role('system_admin', 'warehouse_manager', 'finance_officer'))) with check (requested_by <> (select auth.uid()) and decided_by = (select auth.uid()));
create policy document_insert on public.documents for insert to authenticated with check (uploaded_by = (select auth.uid()) and (select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'finance_officer')));
create policy document_update on public.documents for update to authenticated using ((select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'finance_officer'))) with check ((select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'finance_officer')));
create policy audit_insert on public.audit_events for insert to authenticated with check (actor_id = (select auth.uid()));

revoke all on public.organizations, public.warehouses, public.profiles, public.clients, public.agreements, public.authorized_representatives, public.warehouse_receipts, public.coffee_lots, public.stock_movements, public.processing_orders, public.dispatch_orders, public.ecs_transfers, public.ownership_transfers, public.invoices, public.payments, public.approvals, public.documents, public.audit_events from anon;
grant usage on schema public to authenticated;
grant select on public.organizations, public.warehouses, public.profiles, public.clients, public.agreements, public.authorized_representatives, public.warehouse_receipts, public.coffee_lots, public.stock_movements, public.processing_orders, public.dispatch_orders, public.ecs_transfers, public.ownership_transfers, public.invoices, public.payments, public.approvals, public.documents, public.audit_events to authenticated;
grant insert, update on public.organizations, public.warehouses, public.clients, public.agreements, public.authorized_representatives, public.warehouse_receipts, public.coffee_lots, public.processing_orders, public.dispatch_orders, public.ecs_transfers, public.ownership_transfers, public.invoices, public.approvals, public.documents to authenticated;
grant update on public.profiles to authenticated;
grant insert on public.stock_movements, public.payments, public.audit_events to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('erp-documents', 'erp-documents', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy erp_documents_read on storage.objects for select to authenticated
using (bucket_id = 'erp-documents' and (select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'finance_officer', 'auditor', 'viewer')));
create policy erp_documents_insert on storage.objects for insert to authenticated
with check (bucket_id = 'erp-documents' and owner_id = (select auth.uid()::text) and (select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'finance_officer')));
