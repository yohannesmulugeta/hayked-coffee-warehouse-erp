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

-- Additional local staff. Every local sample account uses HaykedLocal#2026.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'officer@hayked.local', crypt('HaykedLocal#2026', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Hana Tesfaye"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'processing@hayked.local', crypt('HaykedLocal#2026', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Samuel Girma"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'finance@hayked.local', crypt('HaykedLocal#2026', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Selam Worku"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'auditor@hayked.local', crypt('HaykedLocal#2026', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Rahel Alemu"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'viewer@hayked.local', crypt('HaykedLocal#2026', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Abebe Tadesse"}', now(), now(), '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
values
  ('officer@hayked.local', '10000000-0000-0000-0000-000000000003', '{"sub":"10000000-0000-0000-0000-000000000003","email":"officer@hayked.local","email_verified":true}', 'email', now(), now()),
  ('processing@hayked.local', '10000000-0000-0000-0000-000000000004', '{"sub":"10000000-0000-0000-0000-000000000004","email":"processing@hayked.local","email_verified":true}', 'email', now(), now()),
  ('finance@hayked.local', '10000000-0000-0000-0000-000000000005', '{"sub":"10000000-0000-0000-0000-000000000005","email":"finance@hayked.local","email_verified":true}', 'email', now(), now()),
  ('auditor@hayked.local', '10000000-0000-0000-0000-000000000006', '{"sub":"10000000-0000-0000-0000-000000000006","email":"auditor@hayked.local","email_verified":true}', 'email', now(), now()),
  ('viewer@hayked.local', '10000000-0000-0000-0000-000000000007', '{"sub":"10000000-0000-0000-0000-000000000007","email":"viewer@hayked.local","email_verified":true}', 'email', now(), now())
on conflict (provider_id, provider) do nothing;

update public.profiles set role = 'warehouse_officer', full_name = 'Hana Tesfaye' where id = '10000000-0000-0000-0000-000000000003';
update public.profiles set role = 'processing_supervisor', full_name = 'Samuel Girma' where id = '10000000-0000-0000-0000-000000000004';
update public.profiles set role = 'finance_officer', full_name = 'Selam Worku' where id = '10000000-0000-0000-0000-000000000005';
update public.profiles set role = 'auditor', full_name = 'Rahel Alemu' where id = '10000000-0000-0000-0000-000000000006';
update public.profiles set role = 'viewer', full_name = 'Abebe Tadesse' where id = '10000000-0000-0000-0000-000000000007';

insert into public.warehouses (id, organization_id, code, name, location, is_primary)
select '11000000-0000-0000-0000-000000000002', id, 'MOD', 'ECS Warehouse - Modjo', 'Modjo, Oromia', false
from public.organizations where code = 'HAYKED'
on conflict (id) do nothing;

insert into public.clients (id, organization_id, code, legal_name, tin, phone, email, created_by)
select sample.id::uuid, organization.id, sample.code, sample.name, sample.tin, sample.phone, sample.email,
  '10000000-0000-0000-0000-000000000001'::uuid
from public.organizations organization
cross join (values
  ('20000000-0000-0000-0000-000000000002', 'CL-0008', 'Sidama Highland Coffee', '0012738492', '+251 922 680 114', 'operations@sidama.example'),
  ('20000000-0000-0000-0000-000000000003', 'CL-0012', 'Biftu Buna Trading', '0016247853', '+251 933 418 602', 'operations@biftu.example')
) sample(id, code, name, tin, phone, email)
where organization.code = 'HAYKED'
on conflict (id) do nothing;

insert into public.agreements (id, client_id, agreement_number, effective_from, effective_to, status, default_bag_weight_kg, tariff_version, created_by)
values
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'AGR-2026-006', '2026-02-12', '2027-02-11', 'ACTIVE', 60, 'TARIFF-2026-V1', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'AGR-2026-009', '2026-03-22', '2027-03-21', 'ACTIVE', 60, 'TARIFF-2026-V1', '10000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.authorized_representatives (id, client_id, full_name, identity_number, phone, valid_from, valid_to)
values
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Dawit Bekele', 'ID-2026-0008', '+251 922 680 114', '2026-02-12', '2027-02-11'),
  ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'Helen Girma', 'ID-2026-0012', '+251 933 418 602', '2026-03-22', '2027-03-21')
on conflict (id) do nothing;

insert into public.warehouse_receipts (
  id, receipt_number, warehouse_id, client_id, agreement_id, representative_id, arrival_at,
  coffee_type, bag_count, net_weight_kg, vehicle_plate, status, prepared_by, approved_by,
  posted_at, section, driver_name, seal_number, weighbridge_reference, origin, grade,
  crop_year, bag_weight_kg, gross_weight_kg, tare_weight_kg, moisture_percent
)
select receipt.id::uuid, receipt.number, warehouse.id, receipt.client_id::uuid, receipt.agreement_id::uuid,
  receipt.representative_id::uuid, receipt.arrival_at::timestamptz, receipt.coffee_type, receipt.bags::integer,
  receipt.kg::numeric, receipt.plate, 'POSTED', '10000000-0000-0000-0000-000000000003'::uuid,
  '10000000-0000-0000-0000-000000000002'::uuid, receipt.posted_at::timestamptz,
  receipt.section, receipt.driver, receipt.seal, receipt.scale_ref, receipt.origin, receipt.grade,
  2025, 60, receipt.gross_kg::numeric, receipt.tare_kg::numeric, receipt.moisture::numeric
from public.warehouses warehouse
cross join (values
  ('50000000-0000-0000-0000-000000000002', 'GRN-2026-0041', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '2026-08-02 08:15:00+03', 'WASHED', 400, 24000, 'ET-3-77210', '2026-08-02 09:05:00+03', 'A-02 Arrival', 'Tesfaye Mamo', 'SEAL-SID-208', 'WB-2026-1182', 'Bensa, Sidama', 'Grade 1', 36240, 12240, 10.8),
  ('50000000-0000-0000-0000-000000000003', 'GRN-2026-0042', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', '2026-08-03 10:20:00+03', 'UNWASHED_UG', 200, 12000, 'ET-3-64109', '2026-08-03 11:10:00+03', 'A-03 Arrival', 'Kebede Lema', 'SEAL-BIF-144', 'WB-2026-1190', 'Limu, Oromia', 'UG', 24180, 12180, 11.5)
) receipt(id, number, client_id, agreement_id, representative_id, arrival_at, coffee_type, bags, kg, plate, posted_at, section, driver, seal, scale_ref, origin, grade, gross_kg, tare_kg, moisture)
where warehouse.code = 'GEL'
on conflict (id) do nothing;

insert into public.coffee_lots (id, lot_number, warehouse_id, client_id, receipt_id, coffee_type, ownership_type, lot_category, bag_count, quantity_kg, section, status)
select lot.id::uuid, lot.number, warehouse.id, lot.client_id::uuid, lot.receipt_id::uuid, lot.coffee_type,
  'CLIENT', 'ARRIVAL', lot.bags::integer, lot.kg::numeric, lot.section, lot.status
from public.warehouses warehouse
cross join (values
  ('60000000-0000-0000-0000-000000000002', 'HYK/GEL/2026/0041', '20000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 'WASHED', 400, 24000, 'A-02 Arrival', 'WAITING_PROCESSING'),
  ('60000000-0000-0000-0000-000000000003', 'HYK/GEL/2026/0042', '20000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000003', 'UNWASHED_UG', 150, 9000, 'A-03 Arrival', 'ARRIVAL_IN_STORAGE')
) lot(id, number, client_id, receipt_id, coffee_type, bags, kg, section, status)
where warehouse.code = 'GEL'
on conflict (id) do nothing;

-- A fresh Guji arrival keeps Arrival, Reject, and Processed source types
-- simultaneously available to demonstrate same-client multi-source selection.
insert into public.warehouse_receipts (
  id, receipt_number, warehouse_id, client_id, agreement_id, representative_id,
  arrival_at, coffee_type, bag_count, net_weight_kg, vehicle_plate, status,
  prepared_by, approved_by, posted_at, section, driver_name, seal_number,
  weighbridge_reference, origin, grade, crop_year, bag_weight_kg,
  gross_weight_kg, tare_weight_kg, moisture_percent
)
select '50000000-0000-0000-0000-000000000004', 'GRN-2026-0043', warehouse.id,
  '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001', '2026-08-06 08:20:00+03',
  'UNWASHED_UG', 50, 3000, 'ET-3-44043', 'POSTED',
  '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002',
  '2026-08-06 09:00:00+03', 'A-04 Arrival', 'Gemechu Tola', 'SEAL-GUJ-043',
  'WB-2026-1203', 'Guji, Oromia', 'Grade 1', 2025, 60, 3620, 620, 10.7
from public.warehouses warehouse where warehouse.code = 'GEL'
on conflict (id) do nothing;

insert into public.coffee_lots (
  id, lot_number, warehouse_id, client_id, receipt_id, coffee_type,
  ownership_type, lot_category, bag_count, quantity_kg, section, status
)
select '60000000-0000-0000-0000-000000000004', 'HYK/GEL/2026/0043', warehouse.id,
  '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000004',
  'UNWASHED_UG', 'CLIENT', 'ARRIVAL', 50, 3000, 'A-04 Arrival', 'ARRIVAL_IN_STORAGE'
from public.warehouses warehouse where warehouse.code = 'GEL'
on conflict (id) do nothing;

insert into public.stock_movements (
  id, lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta,
  reference_type, reference_id, reason, posted_by, occurred_at
)
select '70000000-0000-0000-0000-000000000010', '60000000-0000-0000-0000-000000000004',
  warehouse.id, '20000000-0000-0000-0000-000000000001', 'RECEIPT', 3000, 50,
  'WAREHOUSE_RECEIPT', '50000000-0000-0000-0000-000000000004',
  'Guji multi-source demo arrival', '10000000-0000-0000-0000-000000000003',
  '2026-08-06 09:00:00+03'
from public.warehouses warehouse where warehouse.code = 'GEL'
on conflict (id) do nothing;

update public.coffee_lots set bag_count = 160, quantity_kg = 9600, lot_category = 'ARRIVAL', status = 'PROCESSED'
where id = '60000000-0000-0000-0000-000000000001';

insert into public.processing_requests (
  id, request_number, request_note_number, request_date, client_name, client_id, lot_reference,
  warehouse_receipt_id, lot_id, coffee_type, requested_preparation_type, grade, requested_bags,
  requested_kg, certifications, requester_name, checker_name, approver_name, notes,
  scanned_document_attached, status, created_by, approved_by
) values
  ('80000000-0000-0000-0000-000000000002', 'REQ-2026-0002', '00240', '2026-08-03', 'Sidama Highland Coffee', '20000000-0000-0000-0000-000000000002', 'HYK/GEL/2026/0041', '50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', 'WASHED', 'Special preparation and grading', 'Grade 1', 200, 12000, array['Organic','RFA'], 'Hana Tesfaye', 'Samuel Girma', 'Daniel Bekele', 'Approved and waiting for an available processing line.', true, 'APPROVED', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002'),
  ('80000000-0000-0000-0000-000000000003', 'REQ-2026-0003', '00241', '2026-08-04', 'Biftu Buna Trading', '20000000-0000-0000-0000-000000000003', 'HYK/GEL/2026/0042', '50000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000003', 'UNWASHED_UG', 'Export cleaning and preparation', 'UG', 100, 6000, array['Non-certified'], 'Hana Tesfaye', 'Samuel Girma', 'Daniel Bekele', 'Submitted for independent approval.', true, 'SUBMITTED', '10000000-0000-0000-0000-000000000003', null)
on conflict (id) do nothing;

insert into public.processing_request_lines (id, request_id, line_number, lot_id, requested_preparation_type, grade, requested_bags, requested_kg, certifications, special_instruction, remark)
values
  ('82000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 1, '60000000-0000-0000-0000-000000000001', 'Export preparation', 'Grade 1', 160, 9600, array['Non-certified'], 'Preserve client ownership through all outputs.', 'Completed sample order'),
  ('82000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000002', 1, '60000000-0000-0000-0000-000000000002', 'Special preparation and grading', 'Grade 1', 200, 12000, array['Organic','RFA'], 'Keep certification identity segregated.', 'Queued sample order'),
  ('82000000-0000-0000-0000-000000000003', '80000000-0000-0000-0000-000000000003', 1, '60000000-0000-0000-0000-000000000003', 'Export cleaning and preparation', 'UG', 100, 6000, array['Non-certified'], 'Client monitor requested at intake.', 'Pending approval sample')
on conflict (id) do nothing;

insert into public.processing_orders (
  id, order_number, request_id, lot_id, client_id, queue_position, input_kg,
  accepted_client_kg, client_reject_kg, hayked_byproduct_kg, process_loss_kg,
  allowance_percent, status, prepared_by, approved_by, started_at, completed_at, completion_number
) values
  ('81000000-0000-0000-0000-000000000001', 'PRO-2026-0012', '80000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 1, 9600, 9000, 300, 150, 150, 2.5, 'POSTED', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '2026-08-02 07:30:00+03', '2026-08-02 16:45:00+03', 'CMP-2026-0012'),
  ('81000000-0000-0000-0000-000000000002', 'PRO-2026-0013', '80000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 2, 12000, 0, 0, 0, 0, 22.5, 'QUEUED', '10000000-0000-0000-0000-000000000003', null, null, null, null)
on conflict (id) do nothing;

update public.processing_requests set queued_order_id = '81000000-0000-0000-0000-000000000001' where id = '80000000-0000-0000-0000-000000000001';
update public.processing_requests set queued_order_id = '81000000-0000-0000-0000-000000000002' where id = '80000000-0000-0000-0000-000000000002';

insert into public.processing_order_inputs (id, order_id, request_line_id, lot_id, input_bags, input_kg)
values ('83000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 160, 9600)
on conflict (id) do nothing;

insert into public.processing_order_inputs (id, order_id, request_line_id, lot_id, input_bags, input_kg)
values ('83000000-0000-0000-0000-000000000002', '81000000-0000-0000-0000-000000000002', '82000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', 200, 12000)
on conflict (id) do nothing;

insert into public.stock_reservations (
  id, processing_order_id, lot_id, reserved_bags, reserved_kg, status, created_by
)
values (
  '92000000-0000-0000-0000-000000000002', '81000000-0000-0000-0000-000000000002',
  '60000000-0000-0000-0000-000000000002', 200, 12000, 'ACTIVE',
  '10000000-0000-0000-0000-000000000003'
)
on conflict (id) do nothing;

insert into public.processing_intakes (id, intake_number, order_id, intake_at, input_bags, input_kg, scale_reference, warehouse_issue_reference, machine_line, shift_name, received_by, client_monitor_present, client_monitor_name, intake_condition, evidence_path)
values ('84000000-0000-0000-0000-000000000001', 'INT-2026-0012', '81000000-0000-0000-0000-000000000001', '2026-08-02 07:30:00+03', 160, 9600, 'SCALE-PRO-882', 'ISSUE-2026-012', 'Line 2', 'Day', '10000000-0000-0000-0000-000000000004', true, 'Aster Kebede', 'Dry and sealed', 'local/sample/PRO-2026-0012-intake.pdf')
on conflict (id) do nothing;

insert into public.coffee_lots (id, lot_number, warehouse_id, client_id, parent_lot_id, source_processing_order_id, coffee_type, ownership_type, lot_category, bag_count, quantity_kg, section, status)
select output.id::uuid, output.number, warehouse.id, output.client_id::uuid, output.parent_id::uuid,
  '81000000-0000-0000-0000-000000000001'::uuid, 'UNWASHED_UG', output.owner_type,
  output.category, output.bags::integer, output.kg::numeric, output.section, output.status
from public.warehouses warehouse
cross join (values
  ('60000000-0000-0000-0000-000000000011', 'HYK/GEL/2026/0040-ACC', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'CLIENT', 'ACCEPTED_PROCESSED', 100, 6000, 'P-01 Processed', 'AWAITING_DISPATCH'),
  ('60000000-0000-0000-0000-000000000012', 'HYK/GEL/2026/0040-REJ', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'CLIENT', 'CLIENT_REJECT', 5, 300, 'R-01 Reject', 'PROCESSED'),
  ('60000000-0000-0000-0000-000000000013', 'HYK/GEL/2026/0040-BYP', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'HAYKED', 'HAYKED_BYPRODUCT', 3, 150, 'B-01 Byproduct', 'PROCESSED')
) output(id, number, client_id, parent_id, owner_type, category, bags, kg, section, status)
where warehouse.code = 'GEL'
on conflict (id) do nothing;

insert into public.processing_outputs (id, order_id, line_number, category, owner_type, coffee_type, grade, preparation, bag_count, bag_weight_kg, quantity_kg, warehouse_section, certifications, weighing_reference, evidence_path, reason, child_lot_id)
values
  ('85000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 1, 'ACCEPTED_CLIENT_COFFEE', 'CLIENT', 'UNWASHED_UG', 'Grade 1', 'Export prepared', 150, 60, 9000, 'P-01 Processed', array['Non-certified'], 'WB-PRO-1201', 'local/sample/PRO-2026-0012-output.pdf', null, '60000000-0000-0000-0000-000000000011'),
  ('85000000-0000-0000-0000-000000000002', '81000000-0000-0000-0000-000000000001', 2, 'CLIENT_REJECT', 'CLIENT', 'UNWASHED_UG', 'Reject', 'Separated', 5, 60, 300, 'R-01 Reject', array['Non-certified'], 'WB-PRO-1202', null, 'Quality reject returned to client ownership', '60000000-0000-0000-0000-000000000012'),
  ('85000000-0000-0000-0000-000000000003', '81000000-0000-0000-0000-000000000001', 3, 'HAYKED_BYPRODUCT', 'HAYKED', 'UNWASHED_UG', 'Byproduct', 'Separated', 3, 50, 150, 'B-01 Byproduct', array[]::text[], 'WB-PRO-1203', null, 'Agreement-allowed Hayked byproduct', '60000000-0000-0000-0000-000000000013'),
  ('85000000-0000-0000-0000-000000000004', '81000000-0000-0000-0000-000000000001', 4, 'PROCESS_LOSS', 'NONE', null, null, null, 0, null, 150, null, array[]::text[], 'WB-PRO-1204', 'local/sample/PRO-2026-0012-loss.pdf', 'Measured processing loss', null)
on conflict (id) do nothing;

insert into public.processing_output_sources (output_id, input_id)
select output.id, input.id
from public.processing_outputs output
join public.processing_order_inputs input on input.order_id = output.order_id
where output.order_id = '81000000-0000-0000-0000-000000000001'
on conflict do nothing;

insert into public.stock_movements (id, lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta, reference_type, reference_id, reason, posted_by, occurred_at)
select movement.id::uuid, movement.lot_id::uuid, warehouse.id, movement.client_id::uuid, movement.kind,
  movement.kg::numeric, movement.bags::integer, movement.reference_type, movement.reference_id::uuid,
  movement.reason, movement.user_id::uuid, movement.at::timestamptz
from public.warehouses warehouse
cross join (values
  ('70000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'RECEIPT', 24000, 400, 'WAREHOUSE_RECEIPT', '50000000-0000-0000-0000-000000000002', 'Sidama sample GRN posting', '10000000-0000-0000-0000-000000000003', '2026-08-02 09:05:00+03'),
  ('70000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'RECEIPT', 12000, 200, 'WAREHOUSE_RECEIPT', '50000000-0000-0000-0000-000000000003', 'Biftu sample GRN posting', '10000000-0000-0000-0000-000000000003', '2026-08-03 11:10:00+03'),
  ('70000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'PROCESS_INPUT', -9600, -160, 'PROCESSING_ORDER', '81000000-0000-0000-0000-000000000001', 'Coffee issued to processing', '10000000-0000-0000-0000-000000000004', '2026-08-02 07:30:00+03'),
  ('70000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000001', 'PROCESS_OUTPUT', 9000, 150, 'PROCESSING_ORDER', '81000000-0000-0000-0000-000000000001', 'Accepted processed output', '10000000-0000-0000-0000-000000000004', '2026-08-02 16:45:00+03'),
  ('70000000-0000-0000-0000-000000000006', '60000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000001', 'PROCESS_OUTPUT', 300, 5, 'PROCESSING_ORDER', '81000000-0000-0000-0000-000000000001', 'Client reject output', '10000000-0000-0000-0000-000000000004', '2026-08-02 16:45:00+03'),
  ('70000000-0000-0000-0000-000000000007', '60000000-0000-0000-0000-000000000013', null, 'PROCESS_OUTPUT', 150, 3, 'PROCESSING_ORDER', '81000000-0000-0000-0000-000000000001', 'Hayked byproduct output', '10000000-0000-0000-0000-000000000004', '2026-08-02 16:45:00+03')
) movement(id, lot_id, client_id, kind, kg, bags, reference_type, reference_id, reason, user_id, at)
where warehouse.code = 'GEL'
on conflict (id) do nothing;

insert into public.dispatch_orders (id, dispatch_number, lot_id, client_id, representative_id, quantity_kg, bag_count, invoices_paid, credit_approved, documents_ready, weighbridge_ready, status, prepared_by, approved_by, posted_at, dispatch_date, dispatch_reason, destination, documents_reference, weighbridge_reference)
values ('90000000-0000-0000-0000-000000000002', 'DSP-2026-0019', '60000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 3000, 50, false, true, true, true, 'POSTED', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '2026-08-04 15:20:00+03', '2026-08-04', 'Export release', 'Djibouti Port', 'DOC-DSP-2026-0019', 'WB-DSP-2026-448')
on conflict (id) do nothing;

insert into public.dispatch_lines (id, dispatch_id, line_number, lot_id, bag_count, quantity_kg)
values ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 1, '60000000-0000-0000-0000-000000000011', 50, 3000)
on conflict (id) do nothing;

insert into public.stock_reservations (id, dispatch_id, lot_id, reserved_bags, reserved_kg, status, created_by, released_at)
values ('92000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000011', 50, 3000, 'CONSUMED', '10000000-0000-0000-0000-000000000003', '2026-08-04 15:20:00+03')
on conflict (id) do nothing;

insert into public.stock_movements (id, lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta, reference_type, reference_id, reason, posted_by, occurred_at)
select '70000000-0000-0000-0000-000000000008', '60000000-0000-0000-0000-000000000011', warehouse.id,
  '20000000-0000-0000-0000-000000000001', 'DISPATCH', -3000, -50, 'DISPATCH_ORDER',
  '90000000-0000-0000-0000-000000000002', 'Approved sample dispatch',
  '10000000-0000-0000-0000-000000000003', '2026-08-04 15:20:00+03'
from public.warehouses warehouse where warehouse.code = 'GEL'
on conflict (id) do nothing;

insert into public.ecs_transfers (
  id, transfer_number, lot_id, client_id, source_warehouse_id, destination_warehouse_id,
  sent_kg, sent_bags, vehicle_plate, status, sent_at, prepared_by
)
select '94000000-0000-0000-0000-000000000001', 'ECS-2026-0003',
  '60000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003',
  source.id, destination.id, 3000, 50, 'ET-3-99541', 'IN_TRANSIT',
  '2026-08-05 08:10:00+03', '10000000-0000-0000-0000-000000000003'
from public.warehouses source, public.warehouses destination
where source.code = 'GEL' and destination.code = 'MOD'
on conflict (id) do nothing;

insert into public.stock_movements (
  id, lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta,
  reference_type, reference_id, reason, posted_by, occurred_at
)
select '70000000-0000-0000-0000-000000000009', '60000000-0000-0000-0000-000000000003',
  warehouse.id, '20000000-0000-0000-0000-000000000003', 'ECS_SEND', -3000, -50,
  'ECS_TRANSFER', '94000000-0000-0000-0000-000000000001', 'Sample ECS transfer sent to Modjo',
  '10000000-0000-0000-0000-000000000003', '2026-08-05 08:10:00+03'
from public.warehouses warehouse where warehouse.code = 'GEL'
on conflict (id) do nothing;

insert into public.credit_overrides (id, dispatch_id, amount_etb, expires_on, reason, document_reference, status, requested_by, decided_by, decided_at)
values ('93000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 91750, '2026-08-10', 'Approved export release while invoice balance is within agreed credit terms', 'DOC-CR-2026-019', 'APPROVED', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000005', '2026-08-04 12:00:00+03')
on conflict (id) do nothing;

update public.invoices set status = 'PARTIALLY_PAID' where id = 'a0000000-0000-0000-0000-000000000001';
insert into public.payments (id, payment_number, invoice_id, client_id, amount_etb, paid_at, bank_reference, recorded_by)
values ('a1000000-0000-0000-0000-000000000001', 'PAY-2026-0044', 'a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 75000, '2026-08-03 14:10:00+03', 'CBE-FT-8831041', '10000000-0000-0000-0000-000000000005')
on conflict (id) do nothing;

update public.tariff_versions set active = true, verified_by_1 = '10000000-0000-0000-0000-000000000005', verified_by_2 = '10000000-0000-0000-0000-000000000002'
where version_code = 'TARIFF-2026-V1';
insert into public.tariff_line_items (id, tariff_version_id, category, age_start_days, age_end_days, daily_rate_per_unit, certified)
select rate.id::uuid, tariff.id, rate.category, rate.start_day::integer, rate.end_day::integer, rate.amount::numeric, rate.certified::boolean
from public.tariff_versions tariff
cross join (values
  ('e1000000-0000-0000-0000-000000000001', 'NO_PROCESSING', 0, 30, 0.00, false),
  ('e1000000-0000-0000-0000-000000000002', 'NO_PROCESSING', 31, 60, 0.45, false),
  ('e1000000-0000-0000-0000-000000000003', 'WAITING_PROCESSING', 0, 15, 0.00, false),
  ('e1000000-0000-0000-0000-000000000004', 'WAITING_PROCESSING', 16, 60, 0.65, false),
  ('e1000000-0000-0000-0000-000000000005', 'PROCESSED_EXPORT', 0, 15, 0.00, false),
  ('e1000000-0000-0000-0000-000000000006', 'PROCESSED_EXPORT', 16, 60, 0.85, false)
) rate(id, category, start_day, end_day, amount, certified)
where tariff.version_code = 'TARIFF-2026-V1'
on conflict (id) do nothing;

insert into public.storage_billing_runs (id, run_number, client_id, lot_id, category, period_start, period_end, tariff_version, billable_bag_days, total_amount, duplicate_key, status, run_by)
values ('e2000000-0000-0000-0000-000000000001', 'SBR-2026-0008', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000011', 'PROCESSED_EXPORT', '2026-07-15', '2026-07-31', 'TARIFF-2026-V1', 2550, 2167.50, 'sample|guji|processed|2026-07', 'INVOICED', '10000000-0000-0000-0000-000000000005')
on conflict (id) do nothing;

insert into public.bag_printing_orders (id, order_number, client_id, lot_id, quantity, unit_rate, total_amount, status, prepared_by, approved_by)
values ('e4000000-0000-0000-0000-000000000001', 'BPO-2026-0007', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000011', 160, 43.48, 6956.80, 'APPROVED', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;

insert into public.generator_usage_requests (id, request_number, client_id, lot_id, processing_order_id, diesel_litres, unit_cost, total_cost, status, prepared_by, approved_by)
values ('e5000000-0000-0000-0000-000000000001', 'GEN-2026-0004', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 38, 128.50, 4883, 'APPROVED', '10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000005')
on conflict (id) do nothing;

insert into public.service_events (id, client_id, lot_id, service_type, description, quantity, unit_price, total_amount, reference_id, invoice_id, status)
values
  ('e3000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000011', 'STORAGE', 'Processed export storage - July', 1, 145000, 145000, 'e2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'INVOICED'),
  ('e3000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000011', 'BAG_PRINTING', 'Custom bag printing - 160 bags', 160, 43.48, 6956.80, 'e4000000-0000-0000-0000-000000000001', null, 'UNBILLED'),
  ('e3000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'GENERATOR', 'Generator diesel recovery - PRO-2026-0012', 38, 128.50, 4883, 'e5000000-0000-0000-0000-000000000001', null, 'UNBILLED')
on conflict (id) do nothing;

insert into public.labour_charge_settings (
  id, fixed_addition_etb, effective_from, active, created_by
)
values (
  'e6000000-0000-0000-0000-000000000001', 10, '2026-01-01', true,
  '10000000-0000-0000-0000-000000000001'
)
on conflict do nothing;

insert into public.labour_records (
  id, labour_number, work_date, client_id, lot_id, processing_order_id,
  activity, quantity, unit_label, internal_cost_etb, charge_addition_etb,
  client_charge_etb, note, external_reference, created_by
)
values (
  'e7000000-0000-0000-0000-000000000001', 'LAB-GEL-2026-0001', '2026-08-02',
  '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001',
  '81000000-0000-0000-0000-000000000001', 'Processing support', 100, 'bags',
  100, 10, 110, 'Demo labour cost and client charge remain separate.', 'LV-2026-0012',
  '10000000-0000-0000-0000-000000000003'
)
on conflict (id) do nothing;

insert into public.number_sequences (
  scope_key, organization_id, warehouse_id, document_type, calendar_year, last_value
)
select organization.id || '|' || warehouse.id || '|LABOUR|2026',
  organization.id, warehouse.id, 'LABOUR', 2026, 1
from public.organizations organization
join public.warehouses warehouse on warehouse.organization_id = organization.id
where organization.code = 'HAYKED' and warehouse.code = 'GEL'
on conflict (scope_key) do update
set last_value = greatest(public.number_sequences.last_value, excluded.last_value),
  updated_at = now();

insert into public.service_events (
  id, client_id, lot_id, service_type, description, quantity, unit_price,
  total_amount, reference_id, status
)
values (
  'e3000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001', 'LABOUR',
  'Labour Service - Processing support', 1, 110, 110,
  'e7000000-0000-0000-0000-000000000001', 'UNBILLED'
)
on conflict (id) do nothing;

update public.labour_records
set service_event_id = 'e3000000-0000-0000-0000-000000000004'
where id = 'e7000000-0000-0000-0000-000000000001';

insert into public.approvals (id, request_type, reference_id, requested_by, requested_at, status, decided_by, decided_at, decision_note)
values
  ('b0000000-0000-0000-0000-000000000002', 'PROCESSING_REQUEST', '80000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '2026-08-01 13:00:00+03', 'APPROVED', '10000000-0000-0000-0000-000000000001', '2026-08-01 14:00:00+03', 'Paper request and lot balance verified.'),
  ('b0000000-0000-0000-0000-000000000003', 'PROCESSING_REQUEST', '80000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', '2026-08-03 10:00:00+03', 'APPROVED', '10000000-0000-0000-0000-000000000002', '2026-08-03 10:30:00+03', 'Certification and available stock checked.'),
  ('b0000000-0000-0000-0000-000000000004', 'PROCESSING_REQUEST', '80000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', '2026-08-04 11:30:00+03', 'PENDING', null, null, null)
on conflict (id) do nothing;

insert into public.documents (id, document_number, document_type, reference_type, reference_id, object_path, file_name, mime_type, size_bytes, checksum_sha256, status, uploaded_by)
values
  ('c0000000-0000-0000-0000-000000000002', 'DOC-2026-0041', 'GRN_SCAN', 'WAREHOUSE_RECEIPT', '50000000-0000-0000-0000-000000000002', 'local/sample/GRN-2026-0041.pdf', 'GRN-2026-0041.pdf', 'application/pdf', 421508, repeat('1', 64), 'POSTED', '10000000-0000-0000-0000-000000000003'),
  ('c0000000-0000-0000-0000-000000000003', 'DOC-2026-00239', 'PROCESSING_EVIDENCE', 'PROCESSING_REQUEST', '80000000-0000-0000-0000-000000000001', 'local/sample/Request-00239.jpg', 'Request-00239.jpg', 'image/jpeg', 850224, repeat('2', 64), 'POSTED', '10000000-0000-0000-0000-000000000004'),
  ('c0000000-0000-0000-0000-000000000004', 'DOC-2026-DSP19', 'DISPATCH_RELEASE', 'DISPATCH_ORDER', '90000000-0000-0000-0000-000000000002', 'local/sample/DSP-2026-0019-release.pdf', 'DSP-2026-0019-release.pdf', 'application/pdf', 365440, repeat('3', 64), 'POSTED', '10000000-0000-0000-0000-000000000003')
on conflict (id) do nothing;

insert into public.audit_events (id, organization_id, actor_id, action, reference_type, reference_id, event_data, occurred_at)
select event.id::uuid, organization.id, event.actor_id::uuid, event.action, event.reference_type,
  event.reference_id::uuid, jsonb_build_object('business_reference', event.business_reference, 'sample', true), event.at::timestamptz
from public.organizations organization
cross join (values
  ('d0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 'GRN_POSTED', 'WAREHOUSE_RECEIPT', '50000000-0000-0000-0000-000000000002', 'GRN-2026-0041', '2026-08-02 09:05:00+03'),
  ('d0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004', 'PROCESSING_STARTED', 'PROCESSING_ORDER', '81000000-0000-0000-0000-000000000001', 'PRO-2026-0012', '2026-08-02 07:30:00+03'),
  ('d0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 'PROCESSING_COMPLETED', 'PROCESSING_ORDER', '81000000-0000-0000-0000-000000000001', 'CMP-2026-0012', '2026-08-02 16:45:00+03'),
  ('d0000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000005', 'PAYMENT_RECORDED', 'INVOICE', 'a0000000-0000-0000-0000-000000000001', 'PAY-2026-0044', '2026-08-03 14:10:00+03'),
  ('d0000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000002', 'DISPATCH_APPROVED', 'DISPATCH_ORDER', '90000000-0000-0000-0000-000000000002', 'DSP-2026-0019', '2026-08-04 12:15:00+03'),
  ('d0000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000003', 'DISPATCH_POSTED', 'DISPATCH_ORDER', '90000000-0000-0000-0000-000000000002', 'DSP-2026-0019', '2026-08-04 15:20:00+03'),
  ('d0000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000003', 'PROCESSING_REQUEST_SUBMITTED', 'PROCESSING_REQUEST', '80000000-0000-0000-0000-000000000003', 'REQ-2026-0003', '2026-08-04 11:30:00+03')
) event(id, actor_id, action, reference_type, reference_id, business_reference, at)
where organization.code = 'HAYKED'
on conflict (id) do nothing;
