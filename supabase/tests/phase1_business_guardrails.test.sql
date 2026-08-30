begin;
select plan(8);

reset role;

select throws_like(
  $sql$update public.processing_orders set status = 'IN_PROCESS' where order_number = 'PRO-2026-0013'$sql$,
  '%Processing cannot start until ECX is Passed or Not Required.%',
  'A historical queued order without an ECX decision cannot start'
);
select is(
  (select status from public.processing_orders where order_number = 'PRO-2026-0013'),
  'QUEUED',
  'The rejected ECX transition leaves the order queued'
);

update public.storage_billing_runs
set status = 'POSTED'
where id = 'e2000000-0000-0000-0000-000000000001';
select throws_like(
  $sql$update public.storage_billing_runs set status = 'INVOICED' where id = 'e2000000-0000-0000-0000-000000000001'$sql$,
  '%Storage billing cannot be invoiced without daily calculation evidence.%',
  'A storage run without daily evidence cannot be invoiced'
);
select is(
  (select status from public.storage_billing_runs where id = 'e2000000-0000-0000-0000-000000000001'),
  'POSTED',
  'The rejected storage invoice transition preserves the posted run'
);

select throws_like(
  $sql$update public.service_events set status = 'PREPARED' where service_type = 'LABOUR' and status = 'UNBILLED'$sql$,
  '%The LABOUR service rate is not yet approved for invoice preparation.%',
  'An unapproved labour rate cannot enter invoice preparation'
);
select is(
  (select count(*)::integer from public.service_events where service_type = 'LABOUR' and status = 'PREPARED'),
  0,
  'The rejected labour preparation changes no service status'
);

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';
select throws_like(
  $sql$select public.post_manual_service_record(
    '20000000-0000-0000-0000-000000000001', 'TRANSPORT', current_date,
    'Test transport service', 1, 'trip', 100,
    '10000000-0000-0000-0000-000000000002', null, 'TEST-RATE-EVIDENCE', 'Guardrail test'
  )$sql$,
  '%No independently verified catalog rate exists for this service, unit, and date.%',
  'A browser-entered manual price cannot bypass the empty approved rate catalog'
);
select is(
  (select count(*)::integer from public.manual_service_records where evidence_reference = 'TEST-RATE-EVIDENCE'),
  0,
  'A rejected manual price creates no service record'
);

select * from finish();
rollback;
