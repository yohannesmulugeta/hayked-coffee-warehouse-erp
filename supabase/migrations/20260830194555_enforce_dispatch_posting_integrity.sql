-- Posting is the last dispatch integrity boundary. Recheck every business total
-- here so an old record or a direct RPC call cannot bypass the UI/approval checks.
create or replace function public.post_dispatch_v2(p_dispatch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dispatch public.dispatch_orders;
  v_line public.dispatch_lines;
  v_lot public.coffee_lots;
  v_reservation public.stock_reservations;
  v_line_count integer;
  v_distinct_lot_count integer;
  v_reservation_count integer;
  v_line_bags integer;
  v_reserved_bags integer;
  v_line_kg numeric;
  v_reserved_kg numeric;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer');

  select * into v_dispatch
  from public.dispatch_orders
  where id = p_dispatch_id
  for update;

  if not found then
    raise exception 'Dispatch not found.';
  end if;
  if v_dispatch.status = 'POSTED' then
    return jsonb_build_object('id', v_dispatch.id, 'status', 'POSTED', 'duplicate', true);
  end if;
  if v_dispatch.status <> 'APPROVED'
    or v_dispatch.approved_by is null
    or v_dispatch.approved_by = v_dispatch.prepared_by then
    raise exception 'Independent approved dispatch is required.';
  end if;

  -- Lock the full posting set before calculating or moving stock.
  perform 1 from public.dispatch_lines
  where dispatch_id = v_dispatch.id
  order by line_number
  for update;
  perform 1 from public.stock_reservations
  where dispatch_id = v_dispatch.id and status = 'ACTIVE'
  order by id
  for update;
  perform 1 from public.coffee_lots
  where id in (
    select lot_id from public.dispatch_lines where dispatch_id = v_dispatch.id
  )
  order by id
  for update;

  select count(*), count(distinct lot_id), coalesce(sum(bag_count), 0), coalesce(sum(quantity_kg), 0)
  into v_line_count, v_distinct_lot_count, v_line_bags, v_line_kg
  from public.dispatch_lines
  where dispatch_id = v_dispatch.id;

  if v_line_count = 0 then
    raise exception 'At least one dispatch line is required before posting.';
  end if;
  if v_distinct_lot_count <> v_line_count then
    raise exception 'A dispatch lot can only appear once.';
  end if;
  if v_line_bags <= 0 or v_line_kg <= 0 then
    raise exception 'Dispatch bags and kilograms must be positive.';
  end if;
  if v_line_bags <> v_dispatch.bag_count or v_line_kg <> v_dispatch.quantity_kg then
    raise exception 'Dispatch line totals do not match the approved dispatch totals.';
  end if;
  if not exists (
    select 1 from public.dispatch_lines
    where dispatch_id = v_dispatch.id and lot_id = v_dispatch.lot_id
  ) then
    raise exception 'The dispatch primary lot is not included in its lines.';
  end if;

  select count(*), coalesce(sum(reserved_bags), 0), coalesce(sum(reserved_kg), 0)
  into v_reservation_count, v_reserved_bags, v_reserved_kg
  from public.stock_reservations
  where dispatch_id = v_dispatch.id and status = 'ACTIVE';

  if v_reservation_count <> v_line_count
    or v_reserved_bags <> v_line_bags
    or v_reserved_kg <> v_line_kg then
    raise exception 'Active stock reservations do not match the approved dispatch lines.';
  end if;
  if exists (
    select 1
    from public.dispatch_lines dispatch_line
    left join public.stock_reservations reservation
      on reservation.dispatch_id = dispatch_line.dispatch_id
      and reservation.lot_id = dispatch_line.lot_id
      and reservation.status = 'ACTIVE'
    where dispatch_line.dispatch_id = v_dispatch.id
    group by dispatch_line.id, dispatch_line.bag_count, dispatch_line.quantity_kg
    having count(reservation.id) <> 1
      or coalesce(sum(reservation.reserved_bags), 0) <> dispatch_line.bag_count
      or coalesce(sum(reservation.reserved_kg), 0) <> dispatch_line.quantity_kg
  ) then
    raise exception 'Every dispatch line requires one exact active reservation.';
  end if;

  for v_line in
    select * from public.dispatch_lines
    where dispatch_id = v_dispatch.id
    order by line_number
  loop
    select * into v_reservation
    from public.stock_reservations
    where dispatch_id = v_dispatch.id
      and lot_id = v_line.lot_id
      and status = 'ACTIVE';

    select * into v_lot
    from public.coffee_lots
    where id = v_line.lot_id;

    if not found
      or v_lot.client_id <> v_dispatch.client_id
      or v_lot.ownership_type <> 'CLIENT' then
      raise exception 'Every dispatch line must reference client-owned stock for this client.';
    end if;
    if v_lot.quantity_kg < v_line.quantity_kg or v_lot.bag_count < v_line.bag_count then
      raise exception 'Reserved lot stock is no longer sufficient.';
    end if;

    insert into public.stock_movements (
      lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta,
      reference_type, reference_id, reason, posted_by
    ) values (
      v_lot.id, v_lot.warehouse_id, v_lot.client_id, 'DISPATCH',
      -v_line.quantity_kg, -v_line.bag_count, 'DISPATCH_ORDER', v_dispatch.id,
      'Reserved dispatch posted', (select auth.uid())
    );

    update public.coffee_lots
    set quantity_kg = quantity_kg - v_line.quantity_kg,
      bag_count = bag_count - v_line.bag_count,
      status = case
        when quantity_kg - v_line.quantity_kg <= 0.01 then 'DISPATCHED'
        else 'AWAITING_DISPATCH'
      end
    where id = v_lot.id;

    update public.stock_reservations
    set status = 'CONSUMED', released_at = now()
    where id = v_reservation.id;
  end loop;

  update public.dispatch_orders
  set status = 'POSTED', posted_at = now()
  where id = v_dispatch.id;

  perform private.record_audit(
    'DISPATCH_POSTED',
    'DISPATCH_ORDER',
    v_dispatch.id,
    jsonb_build_object(
      'quantity_kg', v_dispatch.quantity_kg,
      'bag_count', v_dispatch.bag_count,
      'line_count', v_line_count
    )
  );

  return jsonb_build_object('id', v_dispatch.id, 'status', 'POSTED');
end;
$$;

revoke all on function public.post_dispatch_v2(uuid) from public, anon;
grant execute on function public.post_dispatch_v2(uuid) to authenticated;
