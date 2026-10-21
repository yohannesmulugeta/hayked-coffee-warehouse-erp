begin;
select plan(10);

select is(
  (select active from public.tariff_versions where version_code = 'TARIFF-2026-V1'),
  true,
  'Agreement 001/2018 storage tariff is active without employee verification'
);

update public.tariff_versions
set active = true, verified_by_1 = null, verified_by_2 = null
where version_code = 'TARIFF-2026-V1';

insert into public.stock_movements (
  lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta,
  reference_type, reference_id, reason, posted_by, occurred_at
)
select
  lot.id, lot.warehouse_id, lot.client_id, 'ADJUSTMENT', -600, 0,
  'STORAGE_RENT_TEST', gen_random_uuid(), 'Test kg-only deduction',
  '10000000-0000-0000-0000-000000000001', '2026-09-01 08:00:00+00'
from public.coffee_lots lot
where lot.lot_number = 'HYK/GEL/2026/0042';

create temporary table storage_quote_result (quote jsonb);
grant select, insert on storage_quote_result to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';

do $$
begin
  insert into storage_quote_result (quote)
  select public.quote_storage_billing(
    client.id,
    lot.id,
    'REJECT',
    '2026-08-31',
    '2026-09-01',
    false,
    'TARIFF-2026-V1'
  )
  from public.coffee_lots lot
  join public.clients client on client.id = lot.client_id
  where lot.lot_number = 'HYK/GEL/2026/0042';
exception when others then
  insert into storage_quote_result (quote) values (null);
end;
$$;

select isnt((select quote from storage_quote_result), null::jsonb,
  'An active storage tariff works without verifier identities');
select is((select quote ->> 'billingBasis' from storage_quote_result), 'EQUIVALENT_BAG_FROM_KG',
  'Coffee rent uses remaining kilograms converted to equivalent bags');
select is((select (quote ->> 'bagWeightKg')::numeric from storage_quote_result), 60::numeric,
  'The client agreement supplies the 60 kg bag weight');
select is((select (quote #>> '{rows,0,closingKg}')::numeric from storage_quote_result), 9000::numeric,
  'The first rent day starts from the remaining 9,000 kg');
select is((select (quote #>> '{rows,0,units}')::numeric from storage_quote_result), 150::numeric,
  '9,000 kg is billed as 150 equivalent 60 kg bags');
select is((select (quote #>> '{rows,1,movementKg}')::numeric from storage_quote_result), -600::numeric,
  'A kg-only stock deduction appears on its movement day');
select is((select (quote #>> '{rows,1,closingKg}')::numeric from storage_quote_result), 8400::numeric,
  'The kg-only deduction reduces the closing balance to 8,400 kg');
select is((select (quote #>> '{rows,1,units}')::numeric from storage_quote_result), 140::numeric,
  'The next daily charge uses 140 equivalent bags');
select is((select (quote ->> 'amount')::numeric from storage_quote_result), 1160::numeric,
  'The two daily charges total ETB 1,160 after the deduction');

select * from finish();
rollback;
