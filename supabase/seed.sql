-- Local development data only. This file is not part of production migrations.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'admin@hayked.local', crypt('HaykedLocal#2026', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Meron Tadesse"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'manager@hayked.local', crypt('HaykedLocal#2026', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Daniel Bekele"}', now(), now(), '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
values
  ('admin@hayked.local', '10000000-0000-0000-0000-000000000001',
   '{"sub":"10000000-0000-0000-0000-000000000001","email":"admin@hayked.local","email_verified":true}', 'email', now(), now()),
  ('manager@hayked.local', '10000000-0000-0000-0000-000000000002',
   '{"sub":"10000000-0000-0000-0000-000000000002","email":"manager@hayked.local","email_verified":true}', 'email', now(), now())
on conflict (provider_id, provider) do nothing;

update public.profiles set role = 'system_admin', full_name = 'Meron Tadesse'
where id = '10000000-0000-0000-0000-000000000001';
update public.profiles set role = 'warehouse_manager', full_name = 'Daniel Bekele'
where id = '10000000-0000-0000-0000-000000000002';

insert into public.clients (id, organization_id, code, legal_name, tin, phone, email, created_by)
select '20000000-0000-0000-0000-000000000001', id, 'CL-0015', 'Guji Specialty Coffee PLC',
  '0018472635', '+251 911 245 760', 'operations@guji.example', '10000000-0000-0000-0000-000000000001'
from public.organizations where code = 'HAYKED'
on conflict (id) do nothing;

insert into public.agreements (
  id, client_id, agreement_number, effective_from, effective_to, status,
  default_bag_weight_kg, tariff_version, created_by
) values (
  '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
  'AGR-2026-011', '2026-01-01', '2026-12-31', 'ACTIVE', 60, 'TV-001',
  '10000000-0000-0000-0000-000000000001'
) on conflict (id) do nothing;

insert into public.authorized_representatives (
  id, client_id, full_name, identity_number, phone, valid_from, valid_to
) values (
  '40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
  'Aster Kebede', 'ID-2026-0015', '+251 911 245 760', '2026-01-01', '2026-12-31'
) on conflict (id) do nothing;

insert into public.warehouse_receipts (
  id, receipt_number, warehouse_id, client_id, agreement_id, representative_id,
  arrival_at, coffee_type, bag_count, net_weight_kg, vehicle_plate, status,
  prepared_by, approved_by, posted_at
)
select '50000000-0000-0000-0000-000000000001', 'GRN-2026-0040', warehouse.id,
  '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001', '2026-08-01 08:30:00+03', 'UNWASHED_UG',
  320, 19200, 'ET-3-48216', 'POSTED', '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001', '2026-08-01 09:10:00+03'
from public.warehouses warehouse where warehouse.code = 'GEL'
on conflict (id) do nothing;

insert into public.coffee_lots (
  id, lot_number, warehouse_id, client_id, receipt_id, coffee_type, bag_count,
  quantity_kg, section, status
)
select '60000000-0000-0000-0000-000000000001', 'HYK/GEL/2026/0040', warehouse.id,
  '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001',
  'UNWASHED_UG', 320, 19200, 'A-01 Arrival', 'ARRIVAL_IN_STORAGE'
from public.warehouses warehouse where warehouse.code = 'GEL'
on conflict (id) do nothing;

insert into public.stock_movements (
  id, lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta,
  reference_type, reference_id, reason, posted_by, occurred_at
)
select '70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', warehouse.id,
  '20000000-0000-0000-0000-000000000001', 'RECEIPT', 19200, 320,
  'WAREHOUSE_RECEIPT', '50000000-0000-0000-0000-000000000001', 'Local seed GRN posting',
  '10000000-0000-0000-0000-000000000001', '2026-08-01 09:10:00+03'
from public.warehouses warehouse where warehouse.code = 'GEL'
on conflict (id) do nothing;

insert into public.processing_requests (
  id, request_number, request_note_number, request_date, client_name, client_id, lot_reference, warehouse_receipt_id,
  lot_id, coffee_type, requested_preparation_type, grade, requested_bags, requested_kg,
  certifications, requester_name, checker_name, approver_name, notes,
  scanned_document_attached, status, created_by, approved_by
) values (
  '80000000-0000-0000-0000-000000000001', 'REQ-2026-0001', '00239', '2026-08-01', 'Guji Specialty Coffee PLC',
  '20000000-0000-0000-0000-000000000001', 'HYK/GEL/2026/0040',
  '50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001',
  'UNWASHED_UG', 'Export preparation', 'Grade 1', 160, 9600, array['Non-certified'],
  'Daniel Bekele', 'Warehouse Quality Desk', 'Meron Tadesse', 'Digitized from paper request note.',
  true, 'APPROVED', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001'
) on conflict (id) do nothing;

insert into public.dispatch_orders (
  id, dispatch_number, lot_id, client_id, representative_id, quantity_kg, bag_count,
  invoices_paid, documents_ready, weighbridge_ready, status, prepared_by, approved_by
) values (
  '90000000-0000-0000-0000-000000000001', 'DSP-2026-0018', '60000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
  1200, 20, true, true, true, 'APPROVED', '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001'
) on conflict (id) do nothing;

insert into public.invoices (
  id, invoice_number, client_id, tariff_version, issued_on, due_on, line_snapshot,
  subtotal_etb, tax_etb, status, created_by
) values (
  'a0000000-0000-0000-0000-000000000001', 'INV-2026-0082', '20000000-0000-0000-0000-000000000001',
  'TV-001', '2026-07-15', '2026-08-15', '[{"description":"Storage and handling","quantity":1,"rate_etb":145000}]',
  145000, 21750, 'ISSUED', '10000000-0000-0000-0000-000000000001'
) on conflict (id) do nothing;

insert into public.approvals (id, request_type, reference_id, requested_by)
values ('b0000000-0000-0000-0000-000000000001', 'CREDIT_RELEASE',
  '90000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;

insert into public.documents (
  id, document_number, document_type, reference_type, reference_id, object_path,
  file_name, mime_type, size_bytes, checksum_sha256, status, uploaded_by
) values (
  'c0000000-0000-0000-0000-000000000001', 'DOC-2026-0040', 'GRN_SCAN', 'WAREHOUSE_RECEIPT',
  '50000000-0000-0000-0000-000000000001', 'local/grn/GRN-2026-0040.pdf',
  'GRN-2026-0040.pdf', 'application/pdf', 482114, repeat('0', 64), 'POSTED',
  '10000000-0000-0000-0000-000000000002'
) on conflict (id) do nothing;

insert into public.audit_events (id, organization_id, actor_id, action, reference_type, reference_id, event_data, occurred_at)
select 'd0000000-0000-0000-0000-000000000001', organization.id,
  '10000000-0000-0000-0000-000000000001', 'GRN_POSTED', 'WAREHOUSE_RECEIPT',
  '50000000-0000-0000-0000-000000000001', '{"source":"local seed"}', '2026-08-01 09:10:00+03'
from public.organizations organization where organization.code = 'HAYKED'
on conflict (id) do nothing;
