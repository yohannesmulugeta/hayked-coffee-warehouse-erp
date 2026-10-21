begin;
select plan(1);

create temporary table empty_bag_test_context as
select client.id as client_id, warehouse.id as warehouse_id
from public.clients client
join public.warehouses warehouse on warehouse.organization_id = client.organization_id
where client.active and warehouse.active
limit 1;
grant select on empty_bag_test_context to authenticated;

do $$
begin
  if not exists (select 1 from empty_bag_test_context) then
    raise exception 'The empty-bag test needs an active seed client and warehouse.';
  end if;
  if has_table_privilege('authenticated', 'public.empty_bag_events', 'INSERT') then
    raise exception 'Authenticated users must post custody through the guarded function.';
  end if;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';

do $$
declare
  c uuid;
  w uuid;
  source_count integer;
  moved_count integer;
begin
  select client_id, warehouse_id into c, w from empty_bag_test_context;
  perform public.post_empty_bag_event(
    p_client_id => c, p_event_type => 'RECEIPT', p_bag_type => 'JUTE',
    p_quantity => 100, p_business_date => current_date,
    p_document_reference => 'TEST-EMPTY-BAG-RECEIPT',
    p_destination_warehouse_id => w, p_destination_location => 'TEST-A1',
    p_destination_condition => 'USABLE'
  );
  select bag_count into source_count from public.empty_bag_balances
  where client_id = c and warehouse_id = w and location_code = 'TEST-A1';
  if source_count <> 100 then raise exception 'Receipt did not create a 100-bag balance.'; end if;

  perform public.post_empty_bag_event(
    p_client_id => c, p_event_type => 'ISSUE', p_bag_type => 'JUTE',
    p_quantity => 40, p_business_date => current_date,
    p_document_reference => 'TEST-EMPTY-BAG-ISSUE',
    p_source_warehouse_id => w, p_source_location => 'TEST-A1',
    p_source_condition => 'USABLE'
  );
  perform public.post_empty_bag_event(
    p_client_id => c, p_event_type => 'TRANSFER', p_bag_type => 'JUTE',
    p_quantity => 20, p_business_date => current_date,
    p_document_reference => 'TEST-EMPTY-BAG-TRANSFER',
    p_source_warehouse_id => w, p_source_location => 'TEST-A1',
    p_source_condition => 'USABLE',
    p_destination_warehouse_id => w, p_destination_location => 'TEST-A2',
    p_destination_condition => 'USABLE'
  );
  select bag_count into source_count from public.empty_bag_balances
  where client_id = c and warehouse_id = w and location_code = 'TEST-A1';
  select bag_count into moved_count from public.empty_bag_balances
  where client_id = c and warehouse_id = w and location_code = 'TEST-A2' and condition = 'USABLE';
  if source_count <> 40 or moved_count <> 20 then
    raise exception 'Issue and transfer balances did not reconcile: %, %.', source_count, moved_count;
  end if;

  begin
    perform public.post_empty_bag_event(
      p_client_id => c, p_event_type => 'ISSUE', p_bag_type => 'JUTE',
      p_quantity => 41, p_business_date => current_date,
      p_document_reference => 'TEST-EMPTY-BAG-OVERSPEND',
      p_source_warehouse_id => w, p_source_location => 'TEST-A1',
      p_source_condition => 'USABLE'
    );
    raise exception 'Overspending a bag location was accepted.';
  exception when others then
    if sqlerrm not like 'Only 40 bags are available%' then raise; end if;
  end;

  begin
    perform public.post_empty_bag_event(
      p_client_id => c, p_event_type => 'RECEIPT', p_bag_type => 'JUTE',
      p_quantity => 100, p_business_date => current_date,
      p_document_reference => 'test-empty-bag-receipt',
      p_destination_warehouse_id => w, p_destination_location => 'TEST-A1',
      p_destination_condition => 'USABLE'
    );
    raise exception 'A duplicate receipt reference was accepted.';
  exception when unique_violation then null;
  end;

  begin
    perform public.request_empty_bag_change(
      p_client_id => c, p_event_type => 'ADJUST_IN', p_bag_type => 'JUTE',
      p_quantity => 2, p_business_date => current_date,
      p_document_reference => 'TEST-EMPTY-BAG-UNAPPROVED',
      p_destination_warehouse_id => w, p_destination_location => 'TEST-A2',
      p_destination_condition => 'USABLE'
    );
    raise exception 'A count adjustment without a reason was accepted.';
  exception when others then
    if sqlerrm not like 'Provide a valid count or condition change%' then raise; end if;
  end;

  perform public.request_empty_bag_change(
    p_client_id => c, p_event_type => 'RECLASSIFY', p_bag_type => 'JUTE',
    p_quantity => 5, p_business_date => current_date,
    p_document_reference => 'TEST-EMPTY-BAG-DAMAGE',
    p_source_warehouse_id => w, p_source_location => 'TEST-A2',
    p_source_condition => 'USABLE',
    p_destination_warehouse_id => w, p_destination_location => 'TEST-A2',
    p_destination_condition => 'DAMAGED', p_reason => 'Damaged bags counted'
  );
  perform public.request_empty_bag_change(
    p_client_id => c, p_event_type => 'ADJUST_OUT', p_bag_type => 'JUTE',
    p_quantity => 1, p_business_date => current_date,
    p_document_reference => 'TEST-EMPTY-BAG-REJECT',
    p_source_warehouse_id => w, p_source_location => 'TEST-A1',
    p_source_condition => 'USABLE', p_reason => 'Unconfirmed count variance'
  );
  select coalesce(sum(bag_count), 0)::integer into moved_count from public.empty_bag_balances
  where client_id = c and warehouse_id = w and location_code = 'TEST-A2' and condition = 'DAMAGED';
  if moved_count <> 0 then raise exception 'A pending condition change altered the balance.'; end if;

  begin
    perform public.decide_empty_bag_change(
      (select id from public.empty_bag_change_requests
       where document_reference = 'TEST-EMPTY-BAG-DAMAGE'), true
    );
    raise exception 'The requester approved their own change.';
  exception when others then
    if sqlerrm not like 'You do not have permission%' then raise; end if;
  end;

end;
$$;

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
do $$
declare c uuid; w uuid; damaged_count integer; opening_count integer; movement_count integer; closing_count integer;
begin
  select client_id, warehouse_id into c, w from empty_bag_test_context;
  perform public.decide_empty_bag_change(
    (select id from public.empty_bag_change_requests
     where document_reference = 'TEST-EMPTY-BAG-DAMAGE'), true
  );
  select bag_count into damaged_count from public.empty_bag_balances
  where client_id = c and warehouse_id = w and location_code = 'TEST-A2' and condition = 'DAMAGED';
  if damaged_count <> 5 then raise exception 'Manager-approved damage change did not post.'; end if;
  perform public.decide_empty_bag_change(
    (select id from public.empty_bag_change_requests
     where document_reference = 'TEST-EMPTY-BAG-REJECT'), false,
    'No verified physical count'
  );
  if exists (select 1 from public.empty_bag_events
      where document_reference = 'TEST-EMPTY-BAG-REJECT') then
    raise exception 'A rejected count change posted a movement.';
  end if;
  if not exists (select 1 from public.empty_bag_change_requests
      where document_reference = 'TEST-EMPTY-BAG-REJECT' and status = 'REJECTED') then
    raise exception 'The rejected count request did not retain its decision.';
  end if;
  select opening_bags, movement_bags, closing_bags
    into opening_count, movement_count, closing_count
  from public.empty_bag_daily_statement(c, current_date, current_date);
  if opening_count <> 0 or movement_count <> 60 or closing_count <> 60 then
    raise exception 'Daily custody statement did not reconcile: %, %, %.',
      opening_count, movement_count, closing_count;
  end if;
  begin
    perform public.quote_storage_billing(c, null, 'EMPTY_BAGS', current_date, current_date, false, 'TARIFF-2026-V1');
    raise exception 'Coffee-lot empty-bag billing was not blocked.';
  exception when others then
    if sqlerrm not like 'Use the separate empty-bag custody ledger%' then raise; end if;
  end;
end;
$$;

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000007';
do $$
declare c uuid; w uuid;
begin
  select client_id, warehouse_id into c, w from empty_bag_test_context;
  begin
    perform public.post_empty_bag_event(
      p_client_id => c, p_event_type => 'RECEIPT', p_bag_type => 'JUTE',
      p_quantity => 1, p_business_date => current_date,
      p_document_reference => 'TEST-EMPTY-BAG-VIEWER',
      p_destination_warehouse_id => w, p_destination_location => 'TEST-A1',
      p_destination_condition => 'USABLE'
    );
    raise exception 'A viewer posted a custody movement.';
  exception when others then
    if sqlerrm not like 'You do not have permission%' then raise; end if;
  end;
end;
$$;

reset role;
select pass('Empty-bag custody movements, approvals, and access checks passed');
select * from finish();
rollback;
