-- Keep access changes and approval decisions inside audited, role-checked transactions.

create or replace function public.update_admin_profile(p_profile_id uuid, p_role text, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_active_admins integer;
begin
  perform private.require_role('system_admin');
  if p_role not in ('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'finance_officer', 'auditor', 'viewer') then
    raise exception 'Unsupported user role.';
  end if;
  select * into v_profile from public.profiles where id = p_profile_id for update;
  if not found then raise exception 'User profile not found.'; end if;
  if p_profile_id = (select auth.uid()) and (not p_active or p_role <> 'system_admin') then
    raise exception 'You cannot remove your own system administrator access.';
  end if;
  if v_profile.role = 'system_admin' and v_profile.active and (not p_active or p_role <> 'system_admin') then
    select count(*) into v_active_admins from public.profiles where role = 'system_admin' and active and id <> p_profile_id;
    if v_active_admins = 0 then raise exception 'At least one active system administrator is required.'; end if;
  end if;
  update public.profiles set role = p_role, active = p_active where id = p_profile_id;
  perform private.record_audit('USER_ACCESS_UPDATED', 'PROFILE', p_profile_id,
    jsonb_build_object('previous_role', v_profile.role, 'role', p_role, 'active', p_active));
  return jsonb_build_object('id', p_profile_id, 'role', p_role, 'active', p_active);
end;
$$;

create or replace function public.decide_approval(approval_id uuid, decision text, note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approval public.approvals;
  v_request public.processing_requests;
  v_dispatch public.dispatch_orders;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor', 'finance_officer');
  if decision not in ('APPROVED', 'REJECTED') then raise exception 'Decision must be APPROVED or REJECTED.'; end if;
  if nullif(btrim(note), '') is null then raise exception 'A decision note is required.'; end if;
  select * into v_approval from public.approvals where id = approval_id for update;
  if not found or v_approval.status <> 'PENDING' then raise exception 'Only a pending approval can be decided.'; end if;
  if v_approval.requested_by = (select auth.uid()) then raise exception 'The requester cannot decide the same approval.'; end if;

  if v_approval.request_type = 'PROCESSING_REQUEST' then
    select * into v_request from public.processing_requests where id = v_approval.reference_id for update;
    if not found or v_request.status <> 'SUBMITTED' then raise exception 'The processing request is not awaiting approval.'; end if;
    update public.processing_requests
    set status = decision, approved_by = case when decision = 'APPROVED' then (select auth.uid()) else null end
    where id = v_request.id;
  elsif v_approval.request_type = 'CREDIT_RELEASE' then
    select * into v_dispatch from public.dispatch_orders where id = v_approval.reference_id for update;
    if not found then raise exception 'The dispatch record was not found.'; end if;
    update public.dispatch_orders set credit_approved = (decision = 'APPROVED') where id = v_dispatch.id;
  elsif v_approval.request_type <> 'PROCESSING_EXCEPTION' then
    raise exception 'Unsupported approval type: %.', v_approval.request_type;
  end if;

  update public.approvals
  set status = decision, decided_by = (select auth.uid()), decided_at = now(), decision_note = btrim(note)
  where id = v_approval.id;
  perform private.record_audit('APPROVAL_' || decision, 'APPROVAL', v_approval.id,
    jsonb_build_object('request_type', v_approval.request_type, 'reference_id', v_approval.reference_id, 'note', btrim(note)));
  return jsonb_build_object('id', v_approval.id, 'status', decision);
end;
$$;

revoke update on public.profiles from authenticated;
revoke all on function public.update_admin_profile(uuid, text, boolean) from public, anon;
revoke all on function public.decide_approval(uuid, text, text) from public, anon;
grant execute on function public.update_admin_profile(uuid, text, boolean) to authenticated;
grant execute on function public.decide_approval(uuid, text, text) to authenticated;

alter table public.generator_usage_requests
  add column if not exists processing_order_id uuid references public.processing_orders(id);

create or replace function public.post_generator_request_v2(
  p_client_id uuid,
  p_processing_order_id uuid,
  p_diesel_litres numeric,
  p_unit_cost numeric,
  p_approved_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_order public.processing_orders;
  v_total numeric;
  v_request_id uuid;
  v_request_number text;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  perform private.require_independent_profile(p_approved_by, 'system_admin', 'warehouse_manager', 'finance_officer');
  select * into v_order from public.processing_orders where id = p_processing_order_id;
  if not found or v_order.client_id <> p_client_id then raise exception 'Select a processing order belonging to the client.'; end if;
  if v_order.status not in ('IN_PROCESS', 'POSTED') then raise exception 'Generator recovery requires an active or completed processing order.'; end if;
  if p_diesel_litres <= 0 or p_unit_cost <= 0 then raise exception 'Diesel litres and unit cost must be positive.'; end if;
  v_total := round(p_diesel_litres * p_unit_cost, 2);
  v_request_number := 'GEN-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISSMS');
  insert into public.generator_usage_requests (
    request_number, client_id, lot_id, processing_order_id, diesel_litres, unit_cost,
    total_cost, prepared_by, approved_by, status
  ) values (
    v_request_number, p_client_id, v_order.lot_id, v_order.id, p_diesel_litres,
    p_unit_cost, v_total, v_user_id, p_approved_by, 'APPROVED'
  ) returning id into v_request_id;
  insert into public.service_events (
    client_id, lot_id, service_type, description, quantity, unit_price, total_amount, reference_id
  ) values (
    p_client_id, v_order.lot_id, 'GENERATOR',
    'Generator diesel recovery for ' || v_order.order_number,
    p_diesel_litres, p_unit_cost, v_total, v_request_id
  );
  perform private.record_audit('GENERATOR_REQUEST_POSTED', 'GENERATOR_REQUEST', v_request_id,
    jsonb_build_object('processing_order_id', v_order.id, 'total_cost', v_total));
  return v_request_id;
end;
$$;

revoke all on function public.post_generator_request_v2(uuid, uuid, numeric, numeric, uuid) from public, anon;
grant execute on function public.post_generator_request_v2(uuid, uuid, numeric, numeric, uuid) to authenticated;
