-- Keep the database rule aligned with the UI: joint approval is a wet-coffee
-- evidence flag, while every above-limit loss requires an independent exception approver.
create or replace function public.post_storage_loss(
  p_lot_id uuid,
  p_loss_kg numeric,
  p_evidence_attached boolean,
  p_manager_approved_by uuid,
  p_exception_approved_by uuid default null,
  p_wet_coffee_joint_approved boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_lot public.coffee_lots;
  v_percent numeric;
  v_loss_id uuid;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer');
  perform private.require_independent_profile(p_manager_approved_by, 'system_admin', 'warehouse_manager');
  select * into v_lot from public.coffee_lots where id = p_lot_id for update;
  if not found then raise exception 'Coffee lot not found.'; end if;
  if v_lot.status in ('CLOSED', 'DISPATCHED', 'REVERSED') then raise exception 'This coffee lot cannot receive a storage loss.'; end if;
  if p_loss_kg <= 0 or p_loss_kg > v_lot.quantity_kg then raise exception 'Loss must be positive and cannot exceed current lot quantity.'; end if;
  if not p_evidence_attached then raise exception 'Measurement evidence must be attached.'; end if;
  v_percent := p_loss_kg / v_lot.quantity_kg * 100;
  if v_percent > 1.5001 then
    perform private.require_independent_profile(p_exception_approved_by, 'system_admin', 'warehouse_manager');
    if p_exception_approved_by = p_manager_approved_by then raise exception 'Exception approval must be independent from manager approval.'; end if;
  end if;
  insert into public.storage_losses (
    lot_id, measured_balance_kg, loss_kg, loss_percent, evidence_attached,
    manager_approved_by, exception_approved_by, wet_coffee_joint_approved, prepared_by
  ) values (
    p_lot_id, v_lot.quantity_kg, p_loss_kg, round(v_percent, 3), true,
    p_manager_approved_by, p_exception_approved_by, p_wet_coffee_joint_approved, v_user_id
  ) returning id into v_loss_id;
  insert into public.stock_movements (
    lot_id, warehouse_id, client_id, movement_type, quantity_kg, bag_delta,
    reference_type, reference_id, reason, posted_by
  ) values (
    v_lot.id, v_lot.warehouse_id, v_lot.client_id, 'STORAGE_LOSS', -p_loss_kg, 0,
    'STORAGE_LOSS', v_loss_id, 'Measured storage loss', v_user_id
  );
  update public.coffee_lots
  set quantity_kg = quantity_kg - p_loss_kg,
      status = case when quantity_kg - p_loss_kg <= 0.01 then 'CLOSED' else status end
  where id = p_lot_id;
  perform private.record_audit('POST_STORAGE_LOSS', 'STORAGE_LOSS', v_loss_id,
    jsonb_build_object('lot_id', p_lot_id, 'loss_kg', p_loss_kg, 'loss_percent', round(v_percent, 3)));
  return v_loss_id;
end;
$$;

revoke all on function public.post_storage_loss(uuid, numeric, boolean, uuid, uuid, boolean) from public, anon;
grant execute on function public.post_storage_loss(uuid, numeric, boolean, uuid, uuid, boolean) to authenticated;
