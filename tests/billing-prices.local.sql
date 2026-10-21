-- Price -> new agreement -> service -> invoice -> payment, local only and rollback.
begin;
do $test$
declare actor uuid; reviewer uuid; org uuid; client uuid:=gen_random_uuid(); src uuid; price uuid;
 old_code text; code text:='TEST-PRICE-'||gen_random_uuid(); a uuid; ev uuid; inv uuid; q jsonb; n numeric;
begin
 select id,organization_id into actor,org from public.profiles where role='finance_officer' and active limit 1;
 select id into reviewer from public.profiles where role='system_admin' and active and organization_id=org limit 1;
 if actor is null or reviewer is null then raise exception 'Seed local finance and admin profiles first.'; end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select id,version_code into src,old_code from public.tariff_versions where active order by effective_from limit 1;
 insert into public.clients(id,organization_id,code,legal_name,created_by)
 values(client,org,'TEST-'||client,'Local billing regression',actor);
 insert into public.agreements(client_id,agreement_number,effective_from,status,tariff_version,created_by)
 values(client,'TEST-OLD-'||client,current_date-1,'ACTIVE',old_code,actor) returning id into a;
 price:=public.create_billing_price_version(src,code,current_date,'{}',
 '[{"service_code":"LOADING","description":"Local test loading","unit_label":"bag","unit_price":10}]',0.15);
 if (select active from public.tariff_versions where id=price) then raise exception 'Draft price activated early'; end if;
 perform public.verify_tariff_version(price);
 begin
  perform public.verify_tariff_version(price);
  raise exception 'FAIL same verifier accepted';
 exception when others then if sqlerrm not like '%second employee%' then raise; end if; end;
 perform set_config('request.jwt.claim.sub',reviewer::text,true);
 perform public.verify_tariff_version(price);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 if (select tariff_version from public.agreements where id=a)<>old_code then raise exception 'Existing agreement was repriced'; end if;
 insert into public.agreements(client_id,agreement_number,effective_from,status,tariff_version,created_by)
 values(client,'TEST-NEW-'||client,current_date,'ACTIVE',old_code,actor) returning id into a;
 if (select tariff_version from public.agreements where id=a)<>code then raise exception 'New agreement did not get new prices'; end if;
 raise notice 'PASS verified prices apply to new agreements only';
 begin
  perform public.post_manual_service_record(client,'LOADING',current_date,'Local test loading',15,'bag',1,reviewer,null,'LOCAL-TEST');
  raise exception 'FAIL caller price accepted';
 exception when others then if sqlerrm not ilike '%price%' and sqlerrm not ilike '%rate%' then raise; end if; end;
 q:=public.post_manual_service_record(client,'LOADING',current_date,'Local test loading',15,'bag',10,reviewer,null,'LOCAL-TEST');
 ev:=(q->>'service_event_id')::uuid;
 if (q->>'total_amount')::numeric<>150 then raise exception '15 x 10 did not produce 150'; end if;
 raise notice 'PASS service uses agreement price and rejects tampered rate';
 q:=public.create_invoice_draft_from_services(array[ev]); inv:=(q->>'id')::uuid;
 if (select subtotal_etb from public.invoices where id=inv)<>150 then raise exception 'Invoice subtotal mismatch'; end if;
 perform public.issue_prepared_invoice(inv,current_date+30);
 select total_etb into n from public.invoices where id=inv;
 if n<>172.50 then raise exception 'Invoice tax total should be 172.50, got %',n; end if;
 raise notice 'PASS invoice snapshots 150 subtotal plus configured 15 percent test tax';
 perform public.record_invoice_payment_v2(inv,50,'TEST-PAY-'||inv,now(),'CASH','Local test payer',null,'Rollback fixture');
 if (select status from public.invoices where id=inv)<>'PARTIALLY_PAID' then raise exception 'Partial payment status incorrect'; end if;
 select total_etb-(select sum(amount_etb) from public.payments where invoice_id=inv) into n from public.invoices where id=inv;
 if n<>122.50 then raise exception 'Partial payment balance incorrect'; end if;
 begin
  perform public.record_invoice_payment_v2(inv,50,'TEST-PAY-'||inv,now(),'CASH','Local test payer');
  raise exception 'FAIL duplicate payment accepted';
 exception when others then if sqlerrm not ilike '%reference%' then raise; end if; end;
 raise notice 'PASS partial payment and duplicate-reference protection';
 perform public.record_invoice_payment_v2(inv,122.50,'TEST-FINAL-'||inv,now(),'CASH','Local test payer');
 if (select status from public.invoices where id=inv)<>'PAID' then raise exception 'Final payment did not settle'; end if;
 raise notice 'PASS final payment settles the exact balance';
end $test$;
rollback;
