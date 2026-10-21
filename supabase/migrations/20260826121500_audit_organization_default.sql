-- Forward repair for databases that applied the billing authority migration before its audit default was added.
create or replace function private.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id from public.profiles where id = (select auth.uid())
$$;

revoke all on function private.current_organization_id() from public, anon, authenticated;
alter table public.audit_events alter column organization_id set default private.current_organization_id();
