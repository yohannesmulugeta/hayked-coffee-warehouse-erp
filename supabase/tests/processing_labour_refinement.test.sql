begin;
select plan(51);

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';

select is(
  (select count(distinct source_type)::integer from public.list_eligible_processing_lots('20000000-0000-0000-0000-000000000001', null, null, 50)),
  3,
  'Guji exposes Arrival, Reject, and Processed eligible source types'
);
select ok(exists(select 1 from public.list_eligible_processing_lots('20000000-0000-0000-0000-000000000001', 'ARRIVAL', 'GRN-2026-0043', 10)), 'Arrival can be found by GRN');
select ok(exists(select 1 from public.list_eligible_processing_lots('20000000-0000-0000-0000-000000000001', 'REJECT', 'PRO-2026-0012', 10)), 'Reject can be found by processing order');
select ok(exists(select 1 from public.list_eligible_processing_lots('20000000-0000-0000-0000-000000000001', 'PROCESSED', 'HYK/GEL/2026/0040-ACC', 10)), 'Processed coffee can be found by lot number');
select is((select count(*)::integer from public.list_eligible_processing_lots('20000000-0000-0000-0000-000000000001', null, null, 50) where lot_category not in ('ARRIVAL', 'CLIENT_REJECT', 'ACCEPTED_PROCESSED')), 0, 'Other lot categories are not eligible');

select lives_ok($sql$
  select set_config(
    'test.request_id',
    (public.create_and_submit_processing_request(
      jsonb_build_object(
        'noteNumber', 'TEST-MULTI-001', 'requestDate', current_date::text,
        'clientId', '20000000-0000-0000-0000-000000000001',
        'clientName', 'Guji Specialty Coffee PLC', 'certifications', '[]'::jsonb,
        'otherCertification', '', 'requester', 'Samuel Girma',
        'checker', 'Hana Tesfaye', 'approver', 'Daniel Bekele',
        'notes', 'Arrival plus Reject plus Processed integration test',
        'scannedDocumentAttached', true
      ),
      jsonb_build_array(
        jsonb_build_object('lotId', '60000000-0000-0000-0000-000000000004', 'preparationType', 'Repeat processing', 'grade', 'Grade 1', 'requestedBags', 10, 'requestedKg', 600, 'certifications', '[]'::jsonb),
        jsonb_build_object('lotId', '60000000-0000-0000-0000-000000000012', 'preparationType', 'Repeat processing', 'grade', 'Reject', 'requestedBags', 1, 'requestedKg', 60, 'certifications', '[]'::jsonb),
        jsonb_build_object('lotId', '60000000-0000-0000-0000-000000000011', 'preparationType', 'Repeat processing', 'grade', 'Grade 1', 'requestedBags', 10, 'requestedKg', 600, 'certifications', '[]'::jsonb)
      )
    ) ->> 'id'),
    true
  )
$sql$, 'A same-client Arrival plus Reject plus Processed request is created');
select is((select count(*)::integer from public.processing_request_lines where request_id = current_setting('test.request_id')::uuid), 3, 'The request stores three unique input lines');
select is((select count(distinct lot.client_id)::integer from public.processing_request_lines line join public.coffee_lots lot on lot.id = line.lot_id where line.request_id = current_setting('test.request_id')::uuid), 1, 'All request inputs belong to one client');
select is((select status from public.processing_requests where id = current_setting('test.request_id')::uuid), 'SUBMITTED', 'Multi-source request submits automatically');
select lives_ok(
  $sql$select public.create_ecx_check(current_setting('test.request_id')::uuid, current_date, 'NOT_REQUIRED', null, 'Test inspector', 'Integration test exemption')$sql$,
  'Multi-source request records an ECX decision before approval'
);

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select lives_ok($sql$
  select set_config('test.order_id', (public.approve_and_queue_processing_request(current_setting('test.request_id')::uuid) ->> 'id'), true)
$sql$, 'Independent manager approval atomically creates the order and reservations');
select is((select status from public.processing_requests where id = current_setting('test.request_id')::uuid), 'APPROVED', 'The approved request has no approved-but-unqueued intermediate state');
select is((select count(*)::integer from public.stock_reservations where processing_order_id = current_setting('test.order_id')::uuid and status = 'ACTIVE'), 3, 'Every source lot receives an active processing reservation');
select is((select available_kg::numeric from public.list_eligible_processing_lots('20000000-0000-0000-0000-000000000001', 'ARRIVAL', 'HYK/GEL/2026/0043', 10)), 2400::numeric, 'Available stock excludes the processing reservation');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';
select lives_ok($sql$
  select public.start_processing_order_with_intake(
    current_setting('test.order_id')::uuid,
    jsonb_build_object(
      'intakeAt', now()::text, 'inputBags', 21, 'inputKg', 1260,
      'scaleReference', 'TEST-SCALE-001', 'warehouseIssueReference', 'TEST-WI-001',
      'machineLine', 'Test line', 'shiftName', 'Day',
      'clientMonitorPresent', false, 'clientMonitorName', '',
      'intakeCondition', 'Good', 'evidencePath', 'TEST-EVIDENCE-001'
    )
  )
$sql$, 'Starting a multi-lot order deducts all inputs in one transaction');
select is((select count(*)::integer from public.stock_movements where reference_id = current_setting('test.order_id')::uuid and movement_type = 'PROCESS_INPUT'), 3, 'Start creates one PROCESS_INPUT movement per source lot');
select is((select count(*)::integer from public.stock_reservations where processing_order_id = current_setting('test.order_id')::uuid and status = 'CONSUMED'), 3, 'Start consumes every processing reservation');
select is((select count(*)::integer from public.processing_order_inputs input join public.coffee_lots lot on lot.id = input.lot_id where input.order_id = current_setting('test.order_id')::uuid and (abs(lot.quantity_kg - (select coalesce(sum(movement.quantity_kg), 0) from public.stock_movements movement where movement.lot_id = lot.id)) > 0.001 or lot.bag_count <> (select coalesce(sum(movement.bag_delta), 0) from public.stock_movements movement where movement.lot_id = lot.id))), 0, 'Cached source balances reconcile after multi-lot start');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select lives_ok($sql$
  select public.complete_processing_order_v2(
    current_setting('test.order_id')::uuid,
    jsonb_build_array(
      jsonb_build_object('category', 'ACCEPTED_CLIENT_COFFEE', 'coffeeType', 'UNWASHED_UG', 'grade', 'Grade 1', 'preparation', 'Repeat processed', 'bagCount', 19, 'bagWeightKg', 60, 'quantityKg', 1150, 'warehouseSection', 'P-TEST', 'certifications', '[]'::jsonb, 'weighingReference', 'TEST-OUT-001', 'evidencePath', '', 'reason', ''),
      jsonb_build_object('category', 'CLIENT_REJECT', 'coffeeType', 'UNWASHED_UG', 'grade', 'Reject', 'preparation', 'Separated', 'bagCount', 1, 'bagWeightKg', 60, 'quantityKg', 80, 'warehouseSection', 'R-TEST', 'certifications', '[]'::jsonb, 'weighingReference', 'TEST-OUT-002', 'evidencePath', '', 'reason', 'Reusable reject'),
      jsonb_build_object('category', 'PROCESS_LOSS', 'coffeeType', 'UNWASHED_UG', 'grade', '', 'preparation', '', 'bagCount', 0, 'quantityKg', 30, 'certifications', '[]'::jsonb, 'weighingReference', '', 'evidencePath', '', 'reason', 'Measured loss')
    ), 'Measured loss', null, false
  )
$sql$, 'Completion creates processed and reject inventory plus recorded loss');
select is((select count(*)::integer from public.processing_outputs where order_id = current_setting('test.order_id')::uuid and category = 'ACCEPTED_CLIENT_COFFEE' and child_lot_id is not null), 1, 'Processed output becomes a real Processed lot');
select is((select count(*)::integer from public.processing_outputs where order_id = current_setting('test.order_id')::uuid and category = 'CLIENT_REJECT' and child_lot_id is not null), 1, 'Reusable reject output becomes a real Reject lot');
select is((select count(*)::integer from public.processing_output_sources source join public.processing_outputs output on output.id = source.output_id where output.order_id = current_setting('test.order_id')::uuid), 9, 'Every output records all three contributing input lots');

select set_config('test.processed_lot_id', (select child_lot_id::text from public.processing_outputs where order_id = current_setting('test.order_id')::uuid and category = 'ACCEPTED_CLIENT_COFFEE'), true);
select set_config('test.reject_lot_id', (select child_lot_id::text from public.processing_outputs where order_id = current_setting('test.order_id')::uuid and category = 'CLIENT_REJECT'), true);
select ok(public.validate_processing_source_lot(current_setting('test.processed_lot_id')::uuid, '20000000-0000-0000-0000-000000000001', 100), 'Processed output can be reprocessed');
select ok(public.validate_processing_source_lot(current_setting('test.reject_lot_id')::uuid, '20000000-0000-0000-0000-000000000001', 50), 'Reject output can be reprocessed');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';
select lives_ok($sql$
  select set_config(
    'test.request2_id',
    (public.create_and_submit_processing_request(
      jsonb_build_object('noteNumber', 'TEST-REPROCESS-002', 'requestDate', current_date::text, 'clientId', '20000000-0000-0000-0000-000000000001', 'clientName', 'Guji Specialty Coffee PLC', 'certifications', '[]'::jsonb, 'otherCertification', '', 'requester', 'Samuel Girma', 'checker', 'Hana Tesfaye', 'approver', 'Daniel Bekele', 'notes', 'Repeated processing test', 'scannedDocumentAttached', true),
      jsonb_build_array(
        jsonb_build_object('lotId', current_setting('test.processed_lot_id'), 'preparationType', 'Second processing', 'grade', 'Grade 1', 'requestedBags', 2, 'requestedKg', 100, 'certifications', '[]'::jsonb),
        jsonb_build_object('lotId', current_setting('test.reject_lot_id'), 'preparationType', 'Second processing', 'grade', 'Reject', 'requestedBags', 1, 'requestedKg', 50, 'certifications', '[]'::jsonb)
      )
    ) ->> 'id'), true
  )
$sql$, 'A second order can combine prior Processed and Reject output lots');
select is((select count(*)::integer from public.processing_request_lines where request_id = current_setting('test.request2_id')::uuid), 2, 'Second request retains both repeated-processing sources');
select is((select status from public.processing_requests where id = current_setting('test.request2_id')::uuid), 'SUBMITTED', 'Second request submits automatically');
select lives_ok(
  $sql$select public.create_ecx_check(current_setting('test.request2_id')::uuid, current_date, 'NOT_REQUIRED', null, 'Test inspector', 'Integration test exemption')$sql$,
  'Second request records an ECX decision before approval'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select lives_ok($sql$select set_config('test.order2_id', (public.approve_and_queue_processing_request(current_setting('test.request2_id')::uuid) ->> 'id'), true)$sql$, 'Second request is independently approved and reserves both output lots');
select is((select status from public.processing_requests where id = current_setting('test.request2_id')::uuid), 'APPROVED', 'Second approval and queueing complete atomically');
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';
select lives_ok($sql$select public.start_processing_order_with_intake(current_setting('test.order2_id')::uuid, jsonb_build_object('intakeAt', now()::text, 'inputBags', 3, 'inputKg', 150, 'scaleReference', 'TEST-SCALE-002', 'warehouseIssueReference', 'TEST-WI-002', 'machineLine', 'Test line', 'shiftName', 'Day', 'clientMonitorPresent', false, 'clientMonitorName', '', 'intakeCondition', 'Good', 'evidencePath', 'TEST-EVIDENCE-002'))$sql$, 'Second processing consumes Processed and Reject lots');
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select lives_ok($sql$select public.complete_processing_order_v2(current_setting('test.order2_id')::uuid, jsonb_build_array(jsonb_build_object('category', 'ACCEPTED_CLIENT_COFFEE', 'coffeeType', 'UNWASHED_UG', 'grade', 'Grade 1', 'preparation', 'Second processed', 'bagCount', 2, 'bagWeightKg', 60, 'quantityKg', 126.25, 'warehouseSection', 'P-TEST-2', 'certifications', '[]'::jsonb, 'weighingReference', 'TEST-OUT-003', 'evidencePath', '', 'reason', ''), jsonb_build_object('category', 'CLIENT_REJECT', 'coffeeType', 'UNWASHED_UG', 'grade', 'Reject', 'preparation', 'Separated', 'bagCount', 1, 'bagWeightKg', 20, 'quantityKg', 20, 'warehouseSection', 'R-TEST-2', 'certifications', '[]'::jsonb, 'weighingReference', 'TEST-OUT-004', 'evidencePath', '', 'reason', 'Reusable reject'), jsonb_build_object('category', 'PROCESS_LOSS', 'quantityKg', 3.75, 'bagCount', 0, 'certifications', '[]'::jsonb, 'reason', 'Measured loss')), 'Measured loss', null, false)$sql$, 'Repeated processing completes within the existing tolerance');
select set_config('test.final_lot_id', (select child_lot_id::text from public.processing_outputs where order_id = current_setting('test.order2_id')::uuid and category = 'ACCEPTED_CLIENT_COFFEE'), true);
select is((select count(*)::integer from public.processing_output_sources source join public.processing_outputs output on output.id = source.output_id where output.child_lot_id = current_setting('test.final_lot_id')::uuid), 2, 'Final processed lot records both immediate source lots');
select is((with recursive ancestors(lot_id) as (select input.lot_id from public.processing_outputs output join public.processing_output_sources source on source.output_id = output.id join public.processing_order_inputs input on input.id = source.input_id where output.child_lot_id = current_setting('test.final_lot_id')::uuid union select prior_input.lot_id from ancestors ancestor join public.processing_outputs prior_output on prior_output.child_lot_id = ancestor.lot_id join public.processing_output_sources prior_source on prior_source.output_id = prior_output.id join public.processing_order_inputs prior_input on prior_input.id = prior_source.input_id) select count(distinct lot_id)::integer from ancestors where lot_id in ('60000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000012', '60000000-0000-0000-0000-000000000011')), 3, 'Recursive traceability reaches every original Arrival, Reject, and Processed source');
select is((select count(*)::integer from public.coffee_lots lot where (lot.source_processing_order_id in (current_setting('test.order_id')::uuid, current_setting('test.order2_id')::uuid) or lot.id in ('60000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000012', '60000000-0000-0000-0000-000000000011')) and (abs(lot.quantity_kg - (select coalesce(sum(movement.quantity_kg), 0) from public.stock_movements movement where movement.lot_id = lot.id)) > 0.001 or lot.bag_count <> (select coalesce(sum(movement.bag_delta), 0) from public.stock_movements movement where movement.lot_id = lot.id))), 0, 'Repeated processing leaves cached and ledger balances reconciled');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';
select lives_ok($sql$
  select set_config(
    'test.rollback_request_id',
    (public.create_and_submit_processing_request(
      jsonb_build_object('noteNumber', 'TEST-ROLLBACK-003', 'requestDate', current_date::text, 'clientId', '20000000-0000-0000-0000-000000000001', 'clientName', 'Guji Specialty Coffee PLC', 'certifications', '[]'::jsonb, 'otherCertification', '', 'requester', 'Samuel Girma', 'checker', 'Hana Tesfaye', 'approver', 'Daniel Bekele', 'notes', 'Atomic failure rollback test', 'scannedDocumentAttached', true),
      jsonb_build_array(
        jsonb_build_object('lotId', '60000000-0000-0000-0000-000000000004', 'preparationType', 'Rollback proof', 'grade', 'Grade 1', 'requestedBags', 2, 'requestedKg', 100, 'certifications', '[]'::jsonb),
        jsonb_build_object('lotId', '60000000-0000-0000-0000-000000000011', 'preparationType', 'Rollback proof', 'grade', 'Grade 1', 'requestedBags', 2, 'requestedKg', 100, 'certifications', '[]'::jsonb)
      )
    ) ->> 'id'), true
  )
$sql$, 'A two-lot request is created for the atomic rollback proof');
select is((select status from public.processing_requests where id = current_setting('test.rollback_request_id')::uuid), 'SUBMITTED', 'Rollback-proof request submits automatically');
select lives_ok(
  $sql$select public.create_ecx_check(current_setting('test.rollback_request_id')::uuid, current_date, 'NOT_REQUIRED', null, 'Test inspector', 'Integration test exemption')$sql$,
  'Rollback-proof request records an ECX decision before approval'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select lives_ok($sql$select set_config('test.rollback_order_id', (public.approve_and_queue_processing_request(current_setting('test.rollback_request_id')::uuid) ->> 'id'), true)$sql$, 'Rollback-proof request is approved and reserves both lots atomically');
select is((select status from public.processing_requests where id = current_setting('test.rollback_request_id')::uuid), 'APPROVED', 'Rollback-proof approval has a queued order');
reset role;
update public.stock_reservations
set status = 'RELEASED', released_at = now()
where processing_order_id = current_setting('test.rollback_order_id')::uuid
  and lot_id = '60000000-0000-0000-0000-000000000011';
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';
select throws_like(
  $sql$select public.start_processing_order_with_intake(current_setting('test.rollback_order_id')::uuid, jsonb_build_object('intakeAt', now()::text, 'inputBags', 4, 'inputKg', 200, 'scaleReference', 'TEST-SCALE-ROLLBACK', 'warehouseIssueReference', 'TEST-WI-ROLLBACK', 'machineLine', 'Test line', 'shiftName', 'Day', 'clientMonitorPresent', false, 'clientMonitorName', '', 'intakeCondition', 'Good', 'evidencePath', 'TEST-EVIDENCE-ROLLBACK'))$sql$,
  '%Active processing reservation is missing or no longer matches lot%',
  'A missing second-lot reservation aborts the multi-lot start'
);
select is((select count(*)::integer from public.stock_movements where reference_id = current_setting('test.rollback_order_id')::uuid and movement_type = 'PROCESS_INPUT'), 0, 'Failure on the second lot rolls back the first lot movement too');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
select lives_ok($sql$select set_config('test.labour1_id', (public.post_labour_entry('20000000-0000-0000-0000-000000000001', current_date, 'Integration labour', 100, 'bags', 100, '60000000-0000-0000-0000-000000000004', null, null, 'Test labour', 'TEST-LAB-001') ->> 'id'), true)$sql$, 'Internal labour cost can be recorded');
select is((select internal_cost_etb from public.labour_records where id = current_setting('test.labour1_id')::uuid), 100::numeric, 'Internal labour cost remains 100 ETB');
select is((select charge_addition_etb from public.labour_records where id = current_setting('test.labour1_id')::uuid), 10::numeric, 'The current configurable addition is copied as 10 ETB');
select is((select client_charge_etb from public.labour_records where id = current_setting('test.labour1_id')::uuid), 110::numeric, 'Client labour charge is frozen at 110 ETB');
select ok(exists(select 1 from public.service_events where reference_id = current_setting('test.labour1_id')::uuid and service_type = 'LABOUR' and total_amount = 110 and description = 'Labour Service - Integration labour'), 'Client service event exposes only the final 110 ETB charge');

reset role;
update public.labour_charge_settings set active = false, effective_to = current_date where active;
insert into public.labour_charge_settings (fixed_addition_etb, effective_from, active, created_by)
values (15, current_date, true, '10000000-0000-0000-0000-000000000001');
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
select lives_ok($sql$select set_config('test.labour2_id', (public.post_labour_entry('20000000-0000-0000-0000-000000000001', current_date, 'Later labour', 1, 'job', 100, null, null, null, 'Changed demo setting', 'TEST-LAB-002') ->> 'id'), true)$sql$, 'A changed addition applies to new labour only');
select is((select client_charge_etb from public.labour_records where id = current_setting('test.labour1_id')::uuid), 110::numeric, 'Historical labour charge remains 110 ETB');
select is((select client_charge_etb from public.labour_records where id = current_setting('test.labour2_id')::uuid), 115::numeric, 'New labour charge uses the new 15 ETB addition');
select is((select count(*)::integer from public.service_events where service_type = 'LABOUR' and reference_id = current_setting('test.labour1_id')::uuid), 1, 'One labour record creates exactly one billable event');

select * from finish();
rollback;
