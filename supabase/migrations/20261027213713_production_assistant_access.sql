-- Separate production recording from approval, posting, and warehouse authority.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in (
  'system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor',
  'production_assistant', 'production_assistant_weighbridge',
  'finance_officer', 'auditor', 'viewer'
));

insert into private.role_view_defaults (role, view_key)
select role_name, view_key from (values
  ('production_assistant', 'Dashboard'),
  ('production_assistant', 'Clients'),
  ('production_assistant', 'Coffee Lots'),
  ('production_assistant', 'Processing'),
  ('production_assistant', 'Documents'),
  ('production_assistant_weighbridge', 'Dashboard'),
  ('production_assistant_weighbridge', 'Clients'),
  ('production_assistant_weighbridge', 'Coffee Lots'),
  ('production_assistant_weighbridge', 'Processing'),
  ('production_assistant_weighbridge', 'Dispatch'),
  ('production_assistant_weighbridge', 'Documents')
) as defaults(role_name, view_key);

-- The Processing screen needs these shared reference rows. All other feature
-- tables remain under the existing read gates from user_feature_access.
create policy production_assistant_staff_read on public.profiles for select to authenticated
  using ((select private.has_role('production_assistant', 'production_assistant_weighbridge')));
create policy production_assistant_client_read on public.clients for select to authenticated
  using ((select private.has_role('production_assistant', 'production_assistant_weighbridge'))
    and (select private.can_access_view('Processing')));
create policy production_assistant_lot_read on public.coffee_lots for select to authenticated
  using ((select private.has_role('production_assistant', 'production_assistant_weighbridge'))
    and (select private.can_access_view('Processing')));

-- Preserve each function's existing business rules while adding only the
-- initial role gate. Fail the migration if its expected source has drifted.
do $migration$
declare
  function_name text;
  definition text;
  existing_check text;
  replacement text;
begin
  for function_name in select unnest(array[
    'public.create_processing_request(jsonb,jsonb)',
    'public.transition_processing_request(uuid,text)',
    'public.list_eligible_processing_lots(uuid,text,text,integer)',
    'public.submit_quantity_check(text,uuid,numeric,integer,numeric,integer,text,text,jsonb)',
    'public.update_admin_profile(uuid,text,boolean)'
  ]) loop
    select pg_get_functiondef(function_name::regprocedure) into definition;
    if function_name like '%update_admin_profile%' then
      existing_check := $check$if p_role not in ('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'finance_officer', 'auditor', 'viewer') then$check$;
      replacement := $replace$if p_role not in ('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'production_assistant', 'production_assistant_weighbridge', 'finance_officer', 'auditor', 'viewer') then$replace$;
    elsif function_name like '%submit_quantity_check%' then
      existing_check := $check$perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor');$check$;
      replacement := $replace$perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'production_assistant', 'production_assistant_weighbridge');
  if (select private.has_role('production_assistant', 'production_assistant_weighbridge')) and p_stage not in ('PROCESSING_INTAKE', 'PROCESSING_OUTPUT') then
    raise exception 'Production assistants may record only processing quantity checks.';
  end if;$replace$;
    elsif function_name like '%list_eligible_processing_lots%' then
      existing_check := $check$perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'finance_officer', 'auditor', 'viewer');$check$;
      replacement := $replace$perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer', 'processing_supervisor', 'production_assistant', 'production_assistant_weighbridge', 'finance_officer', 'auditor', 'viewer');$replace$;
    elsif function_name like '%transition_processing_request%' then
      existing_check := $check$perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');$check$;
      replacement := $replace$perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor', 'production_assistant', 'production_assistant_weighbridge');
  if (select private.has_role('production_assistant', 'production_assistant_weighbridge')) and target_status <> 'SUBMITTED' then
    raise exception 'Production assistants cannot approve or reject processing requests.';
  end if;$replace$;
    else
      existing_check := $check$perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');$check$;
      replacement := $replace$perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor', 'production_assistant', 'production_assistant_weighbridge');$replace$;
    end if;
    if strpos(definition, existing_check) = 0 then
      raise exception 'Role gate changed in %, review before migrating.', function_name;
    end if;
    execute replace(definition, existing_check, replacement);
  end loop;
end;
$migration$;

-- A weighbridge operator may fill one field on an unapproved dispatch.
-- This function cannot edit document readiness, notes, stock, or approval.
create function public.record_dispatch_weighbridge(p_dispatch_id uuid, p_reference text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  dispatch public.dispatch_orders;
begin
  perform private.require_role('production_assistant_weighbridge');
  if length(btrim(coalesce(p_reference, ''))) < 3 then
    raise exception 'Enter a weighbridge reference of at least three characters.';
  end if;
  select * into dispatch from public.dispatch_orders where id = p_dispatch_id for update;
  if not found or dispatch.status not in ('DRAFT', 'AWAITING_APPROVAL') then
    raise exception 'Only an unapproved dispatch can receive a weighbridge reference.';
  end if;
  update public.dispatch_orders set weighbridge_reference = btrim(p_reference), weighbridge_ready = true
    where id = p_dispatch_id;
  perform private.record_audit('DISPATCH_WEIGHBRIDGE_RECORDED', 'DISPATCH_ORDER', p_dispatch_id,
    jsonb_build_object('dispatch_number', dispatch.dispatch_number, 'weighbridge_reference', btrim(p_reference)));
  return jsonb_build_object('id', p_dispatch_id, 'dispatch_number', dispatch.dispatch_number);
end;
$$;
revoke all on function public.record_dispatch_weighbridge(uuid,text) from public, anon;
grant execute on function public.record_dispatch_weighbridge(uuid,text) to authenticated;
