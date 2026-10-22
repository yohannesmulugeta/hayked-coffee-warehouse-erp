-- Module read access is independent of operational write/approval roles.
-- Auth sign-ups must not gain the viewer role before an administrator approves them.
alter table public.profiles alter column active set default false;

create table private.view_catalog (
  view_key text primary key,
  assignable boolean not null default true
);

insert into private.view_catalog (view_key, assignable) values
  ('Dashboard', false), ('Clients', true), ('Warehouse Receipts', true),
  ('Coffee Lots', true), ('Processing', true), ('Laboratory', true),
  ('Dispatch', true), ('Labour', true), ('Finance', true), ('Reports', true),
  ('Approvals', true), ('Agreements', true), ('Representatives', true),
  ('Storage Loss', true), ('Ownership Transfers', true), ('Bag Control', true),
  ('Generator Requests', true), ('Documents', true), ('Audit History', true),
  ('Arrears Cases', true), ('Administration', false);

create table private.role_view_defaults (
  role text not null,
  view_key text not null references private.view_catalog(view_key),
  primary key (role, view_key)
);

insert into private.role_view_defaults (role, view_key)
select 'system_admin', view_key from private.view_catalog;
insert into private.role_view_defaults (role, view_key)
select 'warehouse_manager', unnest(array[
  'Dashboard','Clients','Warehouse Receipts','Coffee Lots','Processing','Laboratory',
  'Dispatch','Labour','Finance','Reports','Approvals','Agreements','Representatives',
  'Storage Loss','Ownership Transfers','Bag Control','Generator Requests','Documents',
  'Audit History','Arrears Cases'
]);
insert into private.role_view_defaults (role, view_key)
select 'warehouse_officer', unnest(array[
  'Dashboard','Clients','Warehouse Receipts','Coffee Lots','Processing','Laboratory',
  'Dispatch','Labour','Reports','Representatives','Storage Loss','Ownership Transfers',
  'Bag Control','Generator Requests','Documents'
]);
insert into private.role_view_defaults (role, view_key)
select 'processing_supervisor', unnest(array[
  'Dashboard','Clients','Coffee Lots','Processing','Laboratory','Labour','Reports',
  'Approvals','Storage Loss','Generator Requests','Documents'
]);
insert into private.role_view_defaults (role, view_key)
select 'finance_officer', unnest(array[
  'Dashboard','Clients','Coffee Lots','Laboratory','Finance','Reports','Approvals',
  'Agreements','Documents','Audit History','Arrears Cases'
]);
insert into private.role_view_defaults (role, view_key)
select 'auditor', unnest(array[
  'Dashboard','Clients','Coffee Lots','Laboratory','Reports','Agreements','Documents',
  'Audit History','Arrears Cases'
]);
insert into private.role_view_defaults (role, view_key)
select 'viewer', unnest(array[
  'Dashboard','Clients','Coffee Lots','Laboratory','Reports','Documents'
]);

create table private.user_view_overrides (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  view_key text not null references private.view_catalog(view_key),
  allowed boolean not null,
  changed_by uuid not null references public.profiles(id),
  changed_at timestamptz not null default now(),
  primary key (profile_id, view_key)
);

alter table private.view_catalog enable row level security;
alter table private.role_view_defaults enable row level security;
alter table private.user_view_overrides enable row level security;

revoke all on private.view_catalog, private.role_view_defaults, private.user_view_overrides
  from public, anon, authenticated;

create or replace function private.can_access_view(p_view_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when catalog.assignable then
      coalesce(override.allowed, defaults.view_key is not null)
    else defaults.view_key is not null end
    from public.profiles profile
    join private.view_catalog catalog on catalog.view_key = p_view_key
    left join private.role_view_defaults defaults
      on defaults.role = profile.role and defaults.view_key = catalog.view_key
    left join private.user_view_overrides override
      on override.profile_id = profile.id and override.view_key = catalog.view_key
    where profile.id = (select auth.uid()) and profile.active
  ), false);
$$;
revoke all on function private.can_access_view(text) from public, anon;
grant execute on function private.can_access_view(text) to authenticated;

create or replace function private.can_access_any_view(p_view_keys text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(bool_or(private.can_access_view(view_key)), false)
  from unnest(p_view_keys) view_key;
$$;
revoke all on function private.can_access_any_view(text[]) from public, anon;
grant execute on function private.can_access_any_view(text[]) to authenticated;

create or replace function public.get_my_view_access()
returns table (view_key text, allowed boolean)
language sql stable security definer set search_path = '' as $$
  select catalog.view_key, private.can_access_view(catalog.view_key)
  from private.view_catalog catalog
  where exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.active)
  order by catalog.view_key;
$$;

create or replace function public.list_admin_view_overrides()
returns table (profile_id uuid, view_key text, allowed boolean)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_role('system_admin');
  return query select o.profile_id, o.view_key, o.allowed
    from private.user_view_overrides o order by o.profile_id, o.view_key;
end;
$$;

create or replace function public.set_admin_view_override(
  p_profile_id uuid, p_view_key text, p_allowed boolean
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  previous_allowed boolean;
begin
  perform private.require_role('system_admin');
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'User profile not found.';
  end if;
  if not exists (select 1 from private.view_catalog where view_key = p_view_key and assignable) then
    raise exception 'Unsupported feature.';
  end if;
  select allowed into previous_allowed from private.user_view_overrides
    where profile_id = p_profile_id and view_key = p_view_key;
  if p_allowed is null then
    delete from private.user_view_overrides
      where profile_id = p_profile_id and view_key = p_view_key;
  else
    insert into private.user_view_overrides (profile_id, view_key, allowed, changed_by)
    values (p_profile_id, p_view_key, p_allowed, (select auth.uid()))
    on conflict (profile_id, view_key) do update
      set allowed = excluded.allowed, changed_by = excluded.changed_by, changed_at = now();
  end if;
  if previous_allowed is distinct from p_allowed then
    perform private.record_audit('USER_FEATURE_ACCESS_UPDATED', 'PROFILE', p_profile_id,
      jsonb_build_object('feature', p_view_key, 'previous', previous_allowed, 'allowed', p_allowed));
  end if;
end;
$$;

revoke all on function public.get_my_view_access() from public, anon;
revoke all on function public.list_admin_view_overrides() from public, anon;
revoke all on function public.set_admin_view_override(uuid, text, boolean) from public, anon;
grant execute on function public.get_my_view_access() to authenticated;
grant execute on function public.list_admin_view_overrides() to authenticated;
grant execute on function public.set_admin_view_override(uuid, text, boolean) to authenticated;

-- A permissive policy enables a grant for a role excluded by an older policy;
-- the restrictive policy closes older broad reads for denied users.
do $$
declare item record;
begin
  for item in
    select * from (values
      ('invoices', 'Finance'), ('payments', 'Finance'),
      ('storage_rent_records', 'Finance'), ('storage_billing_runs', 'Finance'),
      ('storage_billing_run_days', 'Finance'), ('tariff_versions', 'Finance|Agreements'),
      ('tariff_line_items', 'Finance|Agreements'), ('service_rate_catalog', 'Finance|Agreements'),
      ('empty_bag_charge_runs', 'Finance|Bag Control'), ('empty_bag_charge_days', 'Finance|Bag Control'),
      ('arrears_cases', 'Arrears Cases'), ('arrears_case_events', 'Arrears Cases'),
      ('audit_events', 'Audit History'), ('documents', 'Documents'),
      ('agreements', 'Agreements|Finance'), ('authorized_representatives', 'Representatives|Warehouse Receipts'),
      ('warehouse_receipts', 'Warehouse Receipts|Coffee Lots'),
      ('quantity_checks', 'Warehouse Receipts|Processing|Dispatch'),
      ('processing_requests', 'Processing|Approvals'), ('processing_request_lines', 'Processing'),
      ('processing_orders', 'Processing'), ('processing_order_inputs', 'Processing'),
      ('processing_intakes', 'Processing'), ('processing_outputs', 'Processing'),
      ('processing_output_sources', 'Processing'), ('machine_schedules', 'Processing'),
      ('coffee_transform_jobs', 'Processing'), ('coffee_transform_sources', 'Processing'),
      ('lab_samples', 'Laboratory'), ('lab_reports', 'Laboratory'),
      ('lab_report_deliveries', 'Laboratory'),
      ('dispatch_orders', 'Dispatch|Approvals'), ('dispatch_lines', 'Dispatch'),
      ('credit_overrides', 'Dispatch'), ('ecs_transfers', 'Dispatch'),
      ('ecx_checks', 'Dispatch'), ('stock_reservations', 'Dispatch|Processing'),
      ('labour_records', 'Labour'), ('labour_charge_settings', 'Labour|Finance'),
      ('manual_service_records', 'Labour|Finance'), ('service_events', 'Labour|Finance'),
      ('approvals', 'Approvals'), ('storage_losses', 'Storage Loss'),
      ('ownership_transfers', 'Ownership Transfers'),
      ('bag_inventory_movements', 'Bag Control'), ('bag_printing_orders', 'Bag Control'),
      ('empty_bag_events', 'Bag Control'), ('empty_bag_ledger_entries', 'Bag Control'),
      ('empty_bag_change_requests', 'Bag Control'),
      ('generator_usage_requests', 'Generator Requests')
    ) as mapped(table_name, view_key)
  loop
    execute format('create policy feature_read_allow on public.%I for select to authenticated using ((select private.can_access_any_view(string_to_array(%L, ''|''))))', item.table_name, item.view_key);
    execute format('create policy feature_read_gate on public.%I as restrictive for select to authenticated using ((select private.can_access_any_view(string_to_array(%L, ''|''))))', item.table_name, item.view_key);
  end loop;
end;
$$;
