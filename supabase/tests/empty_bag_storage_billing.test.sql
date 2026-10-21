begin;

create temporary table bag_charge_test_context as
select client.id as client_id, warehouse.id as warehouse_id, agreement.id as agreement_id
from public.clients client
join public.warehouses warehouse on warehouse.organization_id = client.organization_id
join public.agreements agreement on agreement.client_id = client.id
where client.active and warehouse.active and agreement.status = 'ACTIVE'
  and agreement.effective_from <= current_date - 45
  and (agreement.effective_to is null or agreement.effective_to >= current_date)
order by client.id limit 1;
grant select on bag_charge_test_context to authenticated;

do $$ begin
  if not exists (select 1 from bag_charge_test_context) then
    raise exception 'Seed client, warehouse and agreement are required.';
  end if;
end $$;

update public.tariff_versions
set active = true,
  verified_by_1 = '10000000-0000-0000-0000-000000000001',
  verified_by_2 = '10000000-0000-0000-0000-000000000002'
where version_code = (select tariff_version from public.agreements
  where id = (select agreement_id from bag_charge_test_context));

update public.processing_requests set grade = 'Grade 3'
where id = '80000000-0000-0000-0000-000000000002';
do $$ begin
  begin
    insert into public.service_events (
      client_id,service_type,description,quantity,unit_price,total_amount,
      reference_id,reference_type,service_date,unit_label,tariff_version
    )
    select order_record.client_id,'PROCESSING','Unsupported washed Grade 3 rate',1,1,1,
      order_record.id,'PROCESSING_ORDER',current_date,'bag','TARIFF-2026-V1'
    from public.processing_orders order_record
    where order_record.id = '81000000-0000-0000-0000-000000000002';
    raise exception 'Washed Grade 3 was given an Article 13.1 processing charge.';
  exception when others then
    if sqlerrm not like 'Agreement Article 13.1 has no washed Grade 3-5%' then raise; end if;
  end;
end $$;

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
do $$ declare c uuid; w uuid; begin
  select client_id, warehouse_id into c,w from bag_charge_test_context;
  perform public.post_empty_bag_event(c,'RECEIPT','JUTE',50,current_date-45,'TEST-BILL-OLD',
    null,null,null,w,'BILL-A','USABLE');
  perform public.post_empty_bag_event(c,'RECEIPT','JUTE',25,current_date-11,'TEST-BILL-NEW',
    null,null,null,w,'BILL-A','DAMAGED');
  perform public.post_empty_bag_event(c,'TRANSFER','JUTE',10,current_date-3,'TEST-BILL-MOVE',
    w,'BILL-A','USABLE',w,'BILL-B','USABLE');
  perform public.post_empty_bag_event(c,'ISSUE','JUTE',20,current_date-2,'TEST-BILL-ISSUE',
    w,'BILL-A','USABLE');
end $$;

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000005';
do $$
declare c uuid; a uuid; q jsonb; run uuid; event_id uuid;
begin
  select client_id,agreement_id into c,a from bag_charge_test_context;
  q := public.quote_empty_bag_charge(c,a,current_date-36,current_date-36,'STORAGE');
  if (q->>'amount')::numeric <> 0 then raise exception 'Receipt day 10 was not free: %',q; end if;
  q := public.quote_empty_bag_charge(c,a,current_date-35,current_date-35,'STORAGE');
  if (q->>'amount')::numeric <> 4 then raise exception 'Receipt day 11 did not use ETB 4: %',q; end if;
  q := public.quote_empty_bag_charge(c,a,current_date-6,current_date-6,'STORAGE');
  if (q->>'amount')::numeric <> 4 then raise exception 'Receipt day 40 did not use ETB 4: %',q; end if;
  q := public.quote_empty_bag_charge(c,a,current_date-5,current_date-5,'STORAGE');
  if (q->>'amount')::numeric <> 5 then raise exception 'Receipt day 41 did not use ETB 5: %',q; end if;
  q := public.quote_empty_bag_charge(c,a,current_date-1,current_date-1,'STORAGE');
  if (q->>'amount')::numeric <> 5 or jsonb_array_length(q->'rows') <> 2 then
    raise exception 'Cohort FIFO or proportional Article 16 amount is wrong: %', q;
  end if;
  if not exists (
    select 1 from jsonb_array_elements(q->'rows') row
    where (row->>'closingBags')::integer = 30 and (row->>'ageDay')::integer = 45
      and (row->>'amount')::numeric = 3
  ) or not exists (
    select 1 from jsonb_array_elements(q->'rows') row
    where (row->>'closingBags')::integer = 25 and (row->>'ageDay')::integer = 11
      and (row->>'amount')::numeric = 2
  ) then raise exception 'Receipt cohorts did not keep their own age: %', q; end if;
  q := public.quote_empty_bag_charge(c,a,current_date-1,current_date-1,'ARTICLE_16_4');
  if (q->>'amount')::numeric <> 100 then raise exception 'Article 16.4 quote is wrong: %', q; end if;
  run := public.prepare_empty_bag_charge(c,a,current_date-1,current_date-1,'STORAGE','COUNT-TEST-001');
  create temporary table bag_charge_test_run(id uuid) on commit drop;
  insert into bag_charge_test_run values (run);
  grant select on bag_charge_test_run to authenticated;
  begin
    perform public.prepare_empty_bag_charge(c,a,current_date-1,current_date-1,'STORAGE','COUNT-TEST-002');
    raise exception 'An overlapping storage charge was accepted.';
  exception when others then
    if sqlerrm not like 'These bag charge days are already%' then raise; end if;
  end;
end $$;

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
do $$ begin
  perform public.decide_empty_bag_charge((select id from bag_charge_test_run),true,'Physical count reviewed');
end $$;

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000005';
do $$ declare event_id uuid; c uuid; a uuid; run uuid; invoice jsonb; begin
  select client_id,agreement_id into c,a from bag_charge_test_context;
  event_id := public.post_empty_bag_charge((select id from bag_charge_test_run));
  if not exists (select 1 from public.service_events where id=event_id and total_amount=5
    and reference_type='EMPTY_BAG_CHARGE_RUN' and lot_id is null) then
    raise exception 'The reviewed storage charge did not create the right unbilled service.';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
  begin
    perform public.post_empty_bag_event(c,'ISSUE','JUTE',1,current_date-1,'TEST-BILL-BACKDATE',
      (select warehouse_id from bag_charge_test_context),'BILL-A','USABLE');
    raise exception 'A backdated movement changed a billed period.';
  exception when others then
    if sqlerrm not like 'This date has a pending or posted bag-storage calculation%' then raise; end if;
  end;
  perform pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);
  run := public.prepare_empty_bag_charge(c,a,current_date-1,current_date-1,'ARTICLE_16_4',
    'COLLECTION-NOTICE-001','Client bags remained after the documented collection notice.');
  create temporary table bag_penalty_test_run(id uuid) on commit drop;
  insert into bag_penalty_test_run values (run);
  grant select on bag_penalty_test_run to authenticated;
end $$;

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
do $$ begin
  perform public.decide_empty_bag_charge((select id from bag_penalty_test_run),true,
    'Collection notice and stored bags verified.');
end $$;

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000005';
do $$ declare event_id uuid; invoice jsonb; begin
  event_id := public.post_empty_bag_charge((select id from bag_penalty_test_run));
  if not exists (select 1 from public.service_events where id=event_id and total_amount=100) then
    raise exception 'The separately reviewed Article 16.4 charge was not posted.';
  end if;
  invoice := public.create_invoice_draft_from_services(array[
    (select service_event_id from public.empty_bag_charge_runs where id=(select id from bag_charge_test_run)),
    event_id
  ]);
  if (invoice->>'subtotal_etb')::numeric <> 105 then
    raise exception 'The invoice draft did not include both independent bag charges: %', invoice;
  end if;
end $$;

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000007';
do $$ declare c uuid; a uuid; begin
  select client_id,agreement_id into c,a from bag_charge_test_context;
  begin
    perform public.quote_empty_bag_charge(c,a,current_date-1,current_date-1,'STORAGE');
    raise exception 'A viewer quoted a bag charge.';
  exception when others then
    if sqlerrm not like 'You do not have permission%' then raise; end if;
  end;
end $$;

rollback;
