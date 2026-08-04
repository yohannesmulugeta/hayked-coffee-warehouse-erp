create table public.processing_requests (
  id uuid primary key default gen_random_uuid(),
  request_note_number text not null unique,
  request_date date not null,
  client_name text not null,
  client_id uuid references public.clients(id),
  lot_reference text not null,
  warehouse_receipt_id uuid references public.warehouse_receipts(id),
  lot_id uuid references public.coffee_lots(id),
  coffee_type text not null check (coffee_type in ('WASHED', 'UNWASHED_UG')),
  requested_preparation_type text not null,
  grade text not null,
  requested_bags integer not null check (requested_bags > 0),
  requested_kg numeric(16,3) not null check (requested_kg > 0),
  certifications text[] not null default '{}',
  other_certification text,
  requester_name text not null,
  checker_name text not null,
  approver_name text not null,
  notes text,
  scanned_document_attached boolean not null default false,
  scanned_document_id uuid references public.documents(id),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED')),
  queued_order_id uuid unique references public.processing_orders(id),
  created_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (lower(btrim(approver_name)) <> lower(btrim(requester_name))),
  check (queued_order_id is null or status = 'APPROVED'),
  check (certifications <@ array['Organic', 'RFA', 'C.A.F.E', 'Non-certified', 'Fairtrade', 'Other']::text[]),
  check ('Other' <> all(certifications) or nullif(btrim(other_certification), '') is not null),
  check (approved_by is null or approved_by <> created_by)
);

create index processing_requests_status_date_idx on public.processing_requests (status, request_date, created_at);
create index processing_requests_lot_idx on public.processing_requests (lot_id, request_date) where lot_id is not null;

alter table public.processing_requests enable row level security;

create policy staff_read on public.processing_requests for select to authenticated
using ((select private.has_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'finance_officer', 'auditor', 'viewer')));

create policy processing_request_insert on public.processing_requests for insert to authenticated
with check ((select private.has_role('system_admin', 'warehouse_manager', 'processing_supervisor')));

create policy processing_request_update on public.processing_requests for update to authenticated
using ((select private.has_role('system_admin', 'warehouse_manager', 'processing_supervisor')))
with check ((select private.has_role('system_admin', 'warehouse_manager', 'processing_supervisor')));

revoke all on public.processing_requests from anon;
grant select, insert, update on public.processing_requests to authenticated;
