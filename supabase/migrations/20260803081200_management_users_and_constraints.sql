create unique index processing_request_lines_request_lot_unique_idx
  on public.processing_request_lines (request_id, lot_id);

create or replace function public.list_admin_users()
returns table (id uuid, email text, full_name text, role text, active boolean, last_sign_in_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role('system_admin');
  return query
    select users.id, users.email::text, profiles.full_name, profiles.role, profiles.active, users.last_sign_in_at
    from auth.users users
    join public.profiles profiles on profiles.id = users.id
    order by profiles.full_name;
end;
$$;

revoke all on function public.list_admin_users() from public, anon;
grant execute on function public.list_admin_users() to authenticated;
