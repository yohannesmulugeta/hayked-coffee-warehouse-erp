begin;
select plan(12);

reset role;

select lives_ok(
  $sql$update public.processing_orders set status = 'IN_PROCESS' where order_number = 'PRO-2026-0013'$sql$,
  'An approved queued order can start without optional ECX information'
);
select is(
  (select status from public.processing_orders where order_number = 'PRO-2026-0013'),
  'IN_PROCESS',
  'ECX does not change the processing status transition'
);

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select lives_ok($sql$
  select set_config(
    'test.admin_request_id',
    (public.create_and_submit_processing_request(
      jsonb_build_object(
        'noteNumber', 'TEST-ADMIN-OVERRIDE-001', 'requestDate', current_date::text,
        'clientId', '20000000-0000-0000-0000-000000000001',
        'clientName', 'Guji Specialty Coffee PLC', 'certifications', '[]'::jsonb,
        'otherCertification', '', 'requester', 'Samuel Girma',
        'checker', 'Hana Tesfaye', 'approver', 'Daniel Bekele',
        'notes', 'Admin workflow override test', 'scannedDocumentAttached', false
      ),
      jsonb_build_array(
        jsonb_build_object(
          'lotId', '60000000-0000-0000-0000-000000000004',
          'preparationType', 'Admin workflow test', 'grade', 'Grade 1',
          'requestedBags', 1, 'requestedKg', 60, 'certifications', '[]'::jsonb
        )
      )
    ) ->> 'id'),
    true
  )
$sql$, 'An admin creates and submits a valid request atomically');
select lives_ok($sql$
  select set_config(
    'test.admin_order_id',
    (public.approve_and_queue_processing_request(current_setting('test.admin_request_id')::uuid) ->> 'id'),
    true
  )
$sql$, 'An admin can approve and queue their own request through the explicit override');
select is(
  (select approval_admin_override from public.processing_requests where id = current_setting('test.admin_request_id')::uuid),
  true,
  'The processing request records the admin override'
);
select is(
  (select admin_override from public.approvals where reference_id = current_setting('test.admin_request_id')::uuid and request_type = 'PROCESSING_REQUEST'),
  true,
  'The approval history records the admin override'
);

reset role;

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
