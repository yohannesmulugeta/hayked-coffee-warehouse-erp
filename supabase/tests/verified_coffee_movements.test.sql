begin;

create temporary table verified_coffee_test (name text primary key, id uuid not null);
grant all on verified_coffee_test to authenticated;

do $$
begin
  if has_table_privilege('authenticated', 'public.quantity_checks', 'INSERT')
    or has_table_privilege('authenticated', 'public.coffee_transform_jobs', 'INSERT') then
    raise exception 'Guarded stock checks and transformations cannot allow direct staff writes.';
  end if;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';

do $$
declare v_id uuid;
begin
  v_id := public.submit_coffee_transform('REBAG',
    '20000000-0000-0000-0000-000000000001',
    '[{"lotId":"60000000-0000-0000-0000-000000000004","bags":1,"kg":60}]',
    2, 60, 'TEST-A1', 'TEST-SCALE-REBAG', 'Change one 60 kg bag into two 30 kg bags');
  insert into verified_coffee_test values ('rebag', v_id);
  begin
    perform public.submit_coffee_transform('REBAG',
      '20000000-0000-0000-0000-000000000001',
      '[{"lotId":"60000000-0000-0000-0000-000000000004","bags":1,"kg":60}]',
      2, 60, 'TEST-A1', 'TEST-SCALE-REBAG', 'Duplicate weighing ticket must fail');
    raise exception 'Duplicate transformation evidence was accepted.';
  exception when unique_violation then null;
  end;
end;
$$;

-- A receipt with a measured shortage needs declared and actual quantities, evidence, and another approver.
reset role;
do $$
declare v_id uuid;
begin
  insert into public.warehouse_receipts (receipt_number, warehouse_id, client_id,
    agreement_id, representative_id, arrival_at, coffee_type, bag_count,
    net_weight_kg, vehicle_plate, status, prepared_by, section, wet_coffee,
    certification_status, certification_schemes)
  select 'TEST-GRN-' || gen_random_uuid()::text, warehouse_id, client_id,
    agreement_id, representative_id, now(), coffee_type, 50, 3000,
    'TEST-PLATE', 'SUBMITTED', '10000000-0000-0000-0000-000000000003', section,
    wet_coffee, certification_status, certification_schemes
  from public.warehouse_receipts where id = '50000000-0000-0000-0000-000000000004'
  returning id into v_id;
  insert into verified_coffee_test values ('arrival', v_id);
end;
$$;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';

do $$
declare v_receipt uuid; v_check uuid;
begin
  select id into v_receipt from verified_coffee_test where name = 'arrival';
  begin
    perform public.transition_grn(v_receipt, 'APPROVED', null, null);
    raise exception 'Direct receipt approval bypassed the quantity check.';
  exception when others then
    if sqlerrm = 'Direct receipt approval bypassed the quantity check.' then raise; end if;
  end;
  v_check := public.submit_quantity_check('ARRIVAL', v_receipt, 3060, 51,
    3000, 50, 'TEST-ARRIVAL-SCALE', 'One bag missing at physical receipt', '{}'::jsonb);
  insert into verified_coffee_test values ('arrival_check', v_check);
end;
$$;

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
do $$
declare v_receipt uuid; v_check uuid; v_status text; v_kg numeric;
begin
  select id into v_receipt from verified_coffee_test where name = 'arrival';
  select id into v_check from verified_coffee_test where name = 'arrival_check';
  perform public.decide_quantity_check(v_check, 'APPROVED', 'Compared signed arrival and scale ticket');
  select status into v_status from public.warehouse_receipts where id = v_receipt;
  if v_status <> 'APPROVED' then raise exception 'Verified receipt did not advance.'; end if;
  perform public.transition_grn(v_receipt, 'POSTED', 'TEST-LOT-' || v_receipt::text, null);
  select quantity_kg into v_kg from public.coffee_lots where receipt_id = v_receipt;
  if v_kg <> 3000 then raise exception 'Receipt posted declared quantity instead of measured quantity.'; end if;
end;
$$;

-- An exit shortage is approved as a discrepancy but must not dispatch stock.
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
do $$
declare v_check uuid;
begin
  v_check := public.submit_quantity_check('DISPATCH_EXIT',
    '90000000-0000-0000-0000-000000000001', null, null,
    1140, 19, 'TEST-EXIT-SCALE', 'One bag short at gate count', '{}'::jsonb);
  insert into verified_coffee_test values ('dispatch_check', v_check);
end;
$$;

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
do $$
declare v_check uuid; v_status text; v_movements integer;
begin
  select id into v_check from verified_coffee_test where name = 'dispatch_check';
  perform public.decide_quantity_check(v_check, 'APPROVED', 'Gate count and scale ticket independently checked');
  select status into v_status from public.dispatch_orders where id = '90000000-0000-0000-0000-000000000001';
  select count(*) into v_movements from public.stock_movements
    where reference_type = 'DISPATCH_ORDER' and reference_id = '90000000-0000-0000-0000-000000000001';
  if v_status <> 'APPROVED' or v_movements <> 0 then
    raise exception 'Mismatched dispatch was posted instead of held.';
  end if;
  perform public.cancel_dispatch('90000000-0000-0000-0000-000000000001', 'Physical gate shortage needs new dispatch');
  select status into v_status from public.dispatch_orders where id = '90000000-0000-0000-0000-000000000001';
  if v_status <> 'CANCELLED' then raise exception 'Held dispatch could not be cancelled.'; end if;
end;
$$;

-- An exact exit check posts a complete dispatch, and direct posting is blocked.
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
do $$
declare v_id uuid;
begin
  v_id := (public.create_dispatch_draft(
    jsonb_build_object('clientId', '20000000-0000-0000-0000-000000000003',
      'representativeId', '40000000-0000-0000-0000-000000000003',
      'dispatchDate', current_date, 'documentsReference', 'TEST-RELEASE-DOC',
      'weighbridgeReference', 'TEST-WB-EXIT', 'reason', 'Test release'),
    '[{"lotId":"60000000-0000-0000-0000-000000000003","bagCount":1,"quantityKg":60}]'::jsonb) ->> 'id')::uuid;
  insert into verified_coffee_test values ('exact_dispatch', v_id);
  perform public.submit_dispatch(v_id);
end;
$$;

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
do $$
declare v_id uuid;
begin
  select id into v_id from verified_coffee_test where name = 'exact_dispatch';
  perform public.approve_dispatch(v_id);
end;
$$;

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
do $$
declare v_id uuid; v_check uuid;
begin
  select id into v_id from verified_coffee_test where name = 'exact_dispatch';
  begin
    perform public.post_dispatch_v2(v_id);
    raise exception 'Direct dispatch posting bypassed the quantity check.';
  exception when others then
    if sqlerrm = 'Direct dispatch posting bypassed the quantity check.' then raise; end if;
  end;
  v_check := public.submit_quantity_check('DISPATCH_EXIT', v_id, null, null,
    60, 1, 'TEST-EXIT-COUNT-EXACT', null, '{}'::jsonb);
  insert into verified_coffee_test values ('exact_dispatch_check', v_check);
end;
$$;

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
do $$
declare v_id uuid; v_check uuid; v_status text; v_movements integer;
begin
  select id into v_id from verified_coffee_test where name = 'exact_dispatch';
  select id into v_check from verified_coffee_test where name = 'exact_dispatch_check';
  perform public.decide_quantity_check(v_check, 'APPROVED', 'Gate scale and count match the release');
  select status into v_status from public.dispatch_orders where id = v_id;
  select count(*) into v_movements from public.stock_movements
    where reference_type = 'DISPATCH_ORDER' and reference_id = v_id and movement_type = 'DISPATCH';
  if v_status <> 'POSTED' or v_movements <> 1 then
    raise exception 'Exact verified dispatch did not post one movement.';
  end if;
  perform private.assert_lot_reconciled('60000000-0000-0000-0000-000000000003');
end;
$$;

-- Even a manager cannot approve the transformation they recorded.
do $$
declare v_id uuid; v_status text;
begin
  v_id := public.submit_coffee_transform('REBAG',
    '20000000-0000-0000-0000-000000000003',
    '[{"lotId":"60000000-0000-0000-0000-000000000003","bags":1,"kg":60}]',
    2, 60, 'TEST-A4', 'TEST-SELF-SCALE', 'Test independent reviewer requirement');
  insert into verified_coffee_test values ('self_approval', v_id);
  begin
    perform public.decide_coffee_transform(v_id, 'APPROVED', 'Attempted self approval');
    raise exception 'Self approval was accepted.';
  exception when others then
    if sqlerrm = 'Self approval was accepted.' then raise; end if;
  end;
  select status into v_status from public.coffee_transform_jobs where id = v_id;
  if v_status <> 'PENDING' then raise exception 'A denied self approval changed job status.'; end if;
end;
$$;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
do $$
declare v_id uuid;
begin
  select id into v_id from verified_coffee_test where name = 'self_approval';
  perform public.decide_coffee_transform(v_id, 'REJECTED', 'Independent test review rejected the job');
end;
$$;

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';

do $$
declare v_id uuid; v_output uuid; v_kg numeric; v_bags integer; v_movements integer;
begin
  select id into v_id from verified_coffee_test where name = 'rebag';
  v_output := (public.decide_coffee_transform(v_id, 'APPROVED', 'Scale and bag count independently checked') ->> 'output_lot_id')::uuid;
  insert into verified_coffee_test values ('rebag_output', v_output);
  select quantity_kg, bag_count into v_kg, v_bags from public.coffee_lots where id = v_output;
  select count(*) into v_movements from public.stock_movements where reference_type = 'COFFEE_TRANSFORM' and reference_id = v_id;
  if v_kg <> 60 or v_bags <> 2 or v_movements <> 2 then
    raise exception 'Rebagging failed to create balanced source and output movements.';
  end if;
  perform private.assert_lot_reconciled(v_output);
  perform private.assert_lot_reconciled('60000000-0000-0000-0000-000000000004');
end;
$$;

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';

do $$
declare v_id uuid; v_rebag uuid;
begin
  select id into v_rebag from verified_coffee_test where name = 'rebag_output';
  v_id := public.submit_coffee_transform('BLEND',
    '20000000-0000-0000-0000-000000000001',
    jsonb_build_array(
      jsonb_build_object('lotId', '60000000-0000-0000-0000-000000000004', 'bags', 1, 'kg', 60),
      jsonb_build_object('lotId', v_rebag, 'bags', 2, 'kg', 60)),
    2, 120, 'TEST-A2', 'TEST-SCALE-BLEND', 'Blend two measured sources for test');
  insert into verified_coffee_test values ('blend', v_id);
end;
$$;

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';

do $$
declare v_id uuid; v_output uuid; v_kg numeric; v_movements integer;
begin
  select id into v_id from verified_coffee_test where name = 'blend';
  v_output := (public.decide_coffee_transform(v_id, 'APPROVED', 'Both sources and output independently checked') ->> 'output_lot_id')::uuid;
  select quantity_kg into v_kg from public.coffee_lots where id = v_output;
  select count(*) into v_movements from public.stock_movements where reference_type = 'COFFEE_TRANSFORM' and reference_id = v_id;
  if v_kg <> 120 or v_movements <> 3 then raise exception 'Blending did not preserve traceable balance.'; end if;
  perform private.assert_lot_reconciled(v_output);
end;
$$;

-- The existing queued sample order exercises the new intake gate without persisting changes.
savepoint cancel_unstarted_order;
do $$
declare v_status text; v_reservations integer;
begin
  perform public.cancel_queued_processing_order(
    '81000000-0000-0000-0000-000000000002', 'Test measured intake shortage');
  select status into v_status from public.processing_orders
    where id = '81000000-0000-0000-0000-000000000002';
  select count(*) into v_reservations from public.stock_reservations
    where processing_order_id = '81000000-0000-0000-0000-000000000002' and status = 'ACTIVE';
  if v_status <> 'REVERSED' or v_reservations <> 0 then
    raise exception 'Unstarted order cancellation did not release reserved coffee.';
  end if;
end;
$$;
rollback to savepoint cancel_unstarted_order;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';

do $$
declare v_id uuid;
begin
  begin
    perform public.start_processing_order_with_intake(
      '81000000-0000-0000-0000-000000000002',
      '{"inputBags":200,"inputKg":12000,"scaleReference":"TEST-SCALE","warehouseIssueReference":"TEST-ISSUE","machineLine":"TEST","shiftName":"DAY","intakeCondition":"GOOD","intakeAt":"2026-10-21T12:00:00Z","clientMonitorPresent":false}'::jsonb);
    raise exception 'Direct processing start bypassed the quantity check.';
  exception when others then
    if sqlerrm = 'Direct processing start bypassed the quantity check.' then raise; end if;
  end;
  v_id := public.submit_quantity_check('PROCESSING_INTAKE',
    '81000000-0000-0000-0000-000000000002', null, null,
    12000, 200, 'TEST-SCALE-INTAKE', null,
    '{"inputBags":200,"inputKg":12000,"scaleReference":"TEST-SCALE","warehouseIssueReference":"TEST-ISSUE","machineLine":"TEST","shiftName":"DAY","intakeCondition":"GOOD","intakeAt":"2026-10-21T12:00:00Z","clientMonitorPresent":false}'::jsonb);
  insert into verified_coffee_test values ('intake', v_id);
end;
$$;

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';

do $$
declare v_id uuid; v_status text;
begin
  select id into v_id from verified_coffee_test where name = 'intake';
  perform public.decide_quantity_check(v_id, 'APPROVED', 'Actual intake count and weight checked');
  select status into v_status from public.processing_orders where id = '81000000-0000-0000-0000-000000000002';
  if v_status <> 'IN_PROCESS' then raise exception 'Approved intake did not start the order.'; end if;
end;
$$;

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';

do $$
declare v_id uuid;
begin
  v_id := public.submit_quantity_check('PROCESSING_OUTPUT',
    '81000000-0000-0000-0000-000000000002', null, null,
    11800, 197, 'TEST-SCALE-OUTPUT', '200 kg independently measured process loss',
    '{"lossReason":"Measured processing loss","exceptionApproved":false,"lines":[{"category":"ACCEPTED_CLIENT_COFFEE","quantityKg":11800,"bagCount":197,"coffeeType":"WASHED","warehouseSection":"TEST-A3","weighingReference":"TEST-WB-OUTPUT"},{"category":"PROCESS_LOSS","quantityKg":200,"bagCount":0,"reason":"Measured processing loss"}]}'::jsonb);
  insert into verified_coffee_test values ('output', v_id);
end;
$$;

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';

do $$
declare v_id uuid; v_status text; v_kg numeric;
begin
  select id into v_id from verified_coffee_test where name = 'output';
  perform public.decide_quantity_check(v_id, 'APPROVED', 'Output weighing and process loss verified');
  select status, accepted_client_kg into v_status, v_kg from public.processing_orders
  where id = '81000000-0000-0000-0000-000000000002';
  if v_status <> 'POSTED' or v_kg <> 11800 then raise exception 'Approved processing output did not reconcile.'; end if;
end;
$$;

rollback;
