-- Local regression scenario; all fixture changes are rolled back.
-- Requires a seeded local database with an active finance profile and a receiving agreement.
begin;
do $test$
declare
 actor uuid; reviewer uuid; client uuid; warehouse uuid; agreement uuid; receipt uuid:=gen_random_uuid();
 lot uuid:=gen_random_uuid(); child uuid:=gen_random_uuid(); rent uuid:=gen_random_uuid(); run uuid; t text; processing uuid;
 d date:=(now() at time zone 'Africa/Addis_Ababa')::date-25; q jsonb; n numeric;
begin
 select id into actor from public.profiles where role='finance_officer' and active limit 1;
 select id into reviewer from public.profiles where role='system_admin' and active and id<>actor limit 1;
 if actor is null then raise exception 'Seed a local finance profile first.'; end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select r.client_id,r.warehouse_id,r.agreement_id,a.tariff_version into client,warehouse,agreement,t
 from public.warehouse_receipts r join public.agreements a on a.id=r.agreement_id
 join public.profiles p on p.id=actor join public.clients c on c.id=r.client_id and c.organization_id=p.organization_id
 where a.tariff_version='TARIFF-2026-V1' limit 1;
 if agreement is null then raise exception 'Seed an agreement using TARIFF-2026-V1 first.'; end if;
 insert into public.warehouse_receipts(id,receipt_number,warehouse_id,client_id,agreement_id,arrival_at,coffee_type,bag_count,net_weight_kg,vehicle_plate,prepared_by)
 values(receipt,'TEST-RENT-'||receipt,warehouse,client,agreement,d+time '09:00','WASHED',15,900,'LOCAL-TEST',actor);
 insert into public.coffee_lots(id,lot_number,warehouse_id,client_id,receipt_id,coffee_type,bag_count,quantity_kg,section,created_at)
 values(lot,'TEST-RENT-'||lot,warehouse,client,receipt,'WASHED',15,900,'TEST',d+time '09:00');
 insert into public.stock_movements(lot_id,warehouse_id,client_id,movement_type,quantity_kg,bag_delta,reference_type,reference_id,posted_by,occurred_at)
 values(lot,warehouse,client,'RECEIPT',900,15,'WAREHOUSE_RECEIPT',receipt,actor,d-1+time '23:00');
 insert into public.storage_rent_records(id,rent_number,client_id,lot_id,storage_category,charge_start_on,recorded_by)
 values(rent,'TEST-RENT-'||rent,client,lot,'NO_PROCESSING',d,actor);
 q:=public.quote_storage_billing(client,lot,'NO_PROCESSING',d,d,false,t);
 if (q->>'amount')::numeric<>75 then raise exception '15 bags must cost 75; got %',q; end if;
 raise notice 'PASS arrival date includes early-posted receipt';
 insert into public.stock_movements(lot_id,warehouse_id,client_id,movement_type,quantity_kg,bag_delta,reference_type,reference_id,posted_by,occurred_at)
 values(lot,warehouse,client,'PROCESS_INPUT',-600,-10,'PROCESSING_ORDER',gen_random_uuid(),actor,d+1+time '09:00');
 q:=public.quote_storage_billing(client,lot,'NO_PROCESSING',d+1,d+1,false,t);
 if (q->>'amount')::numeric<>25 then raise exception '5 remaining bags must cost 25; got %',q; end if;
 raise notice 'PASS 15 bags minus 10 processed becomes 5 from intake day';
 select id into processing from public.processing_orders where client_id=client limit 1;
 if processing is null then raise exception 'Seed a local processing order for the fixture client.'; end if;
 insert into public.coffee_lots(id,lot_number,warehouse_id,client_id,receipt_id,parent_lot_id,coffee_type,bag_count,quantity_kg,section,created_at,lot_category,source_processing_order_id)
 values(child,'TEST-CHILD-'||child,warehouse,client,receipt,lot,'WASHED',9,540,'TEST',d+1+time '12:00','ACCEPTED_PROCESSED',processing);
 insert into public.stock_movements(lot_id,warehouse_id,client_id,movement_type,quantity_kg,bag_delta,reference_type,reference_id,posted_by,occurred_at)
 values(child,warehouse,client,'PROCESS_OUTPUT',540,9,'PROCESSING_ORDER',gen_random_uuid(),actor,d+1+time '12:00');
 perform private.inherit_processed_storage(lot);
 select count(*) into n from public.storage_rent_records where lot_id=child and inherited_from_id=rent;
 if n<>1 then raise exception 'Output must inherit exactly one rent instruction'; end if;
 raise notice 'PASS processing output automatically inherits rent exactly once';
 q:=public.quote_storage_billing(client,child,'PROCESSED_EXPORT',d+15,d+15,false,t);
 if (q->>'amount')::numeric<>0 then raise exception 'Processed stage day 15 must be free'; end if;
 q:=public.quote_storage_billing(client,child,'PROCESSED_EXPORT',d+16,d+16,false,t);
 if (q->>'amount')::numeric<>27 then raise exception 'Processed stage day 16 must cost 27, got %',q; end if;
 raise notice 'PASS processed stage day 15 free and day 16 chargeable';
 run:=public.calculate_and_save_storage_billing_v2(client,child,'PROCESSED_EXPORT',d+1,d+16,false,t);
 update public.storage_billing_runs set status='INVOICED' where id=run;
 raise notice 'PASS free and paid daily evidence reconciles at invoicing';
 begin
  perform public.calculate_and_save_storage_billing_v2(client,child,'PROCESSED_EXPORT',d+16,d+17,false,t);
  raise exception 'FAIL overlap accepted';
 exception when others then if sqlerrm not like '%already been billed%' then raise; end if; end;
 raise notice 'PASS overlapping days rejected';
 begin
  perform public.calculate_and_save_storage_billing_v2(client,lot,'NO_PROCESSING',current_date,current_date,false,t);
  raise exception 'FAIL today accepted';
 exception when others then if sqlerrm not like '%through yesterday%' then raise; end if; end;
 raise notice 'PASS today remains an estimate';
 q:=public.quote_storage_billing(client,lot,'NO_PROCESSING',d,d+1,false,t);
 if (q->>'amount')::numeric<>100 then raise exception 'Historical period must remain 75 + 25'; end if;
 raise notice 'PASS movement does not reprice earlier days';
 insert into public.stock_movements(lot_id,warehouse_id,client_id,movement_type,quantity_kg,bag_delta,reference_type,reference_id,posted_by,occurred_at)
 values(lot,warehouse,client,'DISPATCH',-300,-5,'DISPATCH',gen_random_uuid(),actor,d+2+time '09:00');
 q:=public.quote_storage_billing(client,lot,'NO_PROCESSING',d+2,d+2,false,t);
 if (q->>'amount')::numeric<>0 then raise exception 'Dispatched balance must stop rent'; end if;
 raise notice 'PASS dispatch stops rent from departure day';
 run:=public.calculate_and_save_storage_billing_v2(client,lot,'NO_PROCESSING',d+2,d+2,false,t);
 select count(*) into n from public.service_events where reference_id=run;
 if n<>0 then raise exception 'Zero rent must not create invoice work'; end if;
 raise notice 'PASS zero rent records evidence without a charge';
end $test$;
rollback;
