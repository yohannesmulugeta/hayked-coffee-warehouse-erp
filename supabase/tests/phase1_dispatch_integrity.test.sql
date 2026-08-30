begin;
select plan(8);

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select set_config(
  'test.initial_dispatch_lot_kg',
  (select quantity_kg::text from public.coffee_lots where id = '60000000-0000-0000-0000-000000000001'),
  true
);

select throws_like(
  $sql$select public.post_dispatch_v2('90000000-0000-0000-0000-000000000001')$sql$,
  '%At least one dispatch line is required before posting.%',
  'An approved dispatch with no lines cannot be posted'
);
select is(
  (select status from public.dispatch_orders where id = '90000000-0000-0000-0000-000000000001'),
  'APPROVED',
  'A rejected empty posting leaves the dispatch approved'
);
select is(
  (select count(*)::integer from public.stock_movements where reference_type = 'DISPATCH_ORDER' and reference_id = '90000000-0000-0000-0000-000000000001'),
  0,
  'A rejected empty posting creates no stock movement'
);

reset role;
insert into public.dispatch_lines (dispatch_id, line_number, lot_id, bag_count, quantity_kg)
values ('90000000-0000-0000-0000-000000000001', 1, '60000000-0000-0000-0000-000000000001', 20, 1200);
insert into public.stock_reservations (dispatch_id, lot_id, reserved_bags, reserved_kg, created_by)
values ('90000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 20, 1200, '10000000-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';

select lives_ok(
  $sql$select public.post_dispatch_v2('90000000-0000-0000-0000-000000000001')$sql$,
  'An approved dispatch posts after exact lines and reservations exist'
);
select is(
  (select status from public.dispatch_orders where id = '90000000-0000-0000-0000-000000000001'),
  'POSTED',
  'Successful posting marks the dispatch posted'
);
select is(
  (select quantity_kg from public.stock_movements where reference_type = 'DISPATCH_ORDER' and reference_id = '90000000-0000-0000-0000-000000000001'),
  -1200::numeric,
  'Successful posting records the exact stock movement'
);
select is(
  (select status from public.stock_reservations where dispatch_id = '90000000-0000-0000-0000-000000000001'),
  'CONSUMED',
  'Successful posting consumes the reservation'
);
select is(
  (select quantity_kg from public.coffee_lots where id = '60000000-0000-0000-0000-000000000001'),
  current_setting('test.initial_dispatch_lot_kg')::numeric - 1200,
  'Successful posting reduces the cached lot balance exactly once'
);

select * from finish();
rollback;
