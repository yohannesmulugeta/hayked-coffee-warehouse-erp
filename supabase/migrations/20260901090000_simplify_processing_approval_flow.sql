-- Submit valid processing requests for approval immediately and keep ECX optional.

drop trigger if exists processing_orders_require_ecx_before_start on public.processing_orders;
drop function if exists private.enforce_processing_ecx_before_start();

-- Admin self-decisions are explicit and auditable. Every other role retains
-- the independent maker-checker rule.
alter table public.processing_requests
  add column if not exists approval_admin_override boolean not null default false;
alter table public.approvals
  add column if not exists admin_override boolean not null default false;

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_catalog.pg_constraint
    where conrelid = 'public.processing_requests'::regclass
      and contype = 'c'
      and pg_catalog.pg_get_constraintdef(oid) ilike '%approved_by%created_by%'
  loop
    execute format(
      'alter table public.processing_requests drop constraint %I',
      constraint_record.conname
    );
  end loop;

  for constraint_record in
    select conname
    from pg_catalog.pg_constraint
    where conrelid = 'public.approvals'::regclass
      and contype = 'c'
      and pg_catalog.pg_get_constraintdef(oid) ilike '%decided_by%requested_by%'
  loop
    execute format(
      'alter table public.approvals drop constraint %I',
      constraint_record.conname
    );
  end loop;
end;
$$;

alter table public.processing_requests
  add constraint processing_requests_approval_actor_check
  check (
    approved_by is null
    or approved_by <> created_by
    or approval_admin_override
  );
alter table public.approvals
  add constraint approvals_decision_actor_check
  check (
    decided_by is null
    or decided_by <> requested_by
    or admin_override
  );

create or replace function public.transition_processing_request(request_id uuid, target_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.processing_requests;
  v_admin_override boolean := false;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  select * into v_request from public.processing_requests where id = request_id for update;
  if not found then raise exception 'Processing request not found'; end if;

  if v_request.status = 'DRAFT' and target_status = 'SUBMITTED' then
    update public.processing_requests set status = 'SUBMITTED' where id = request_id;
    insert into public.approvals (request_type, reference_id, requested_by)
    values ('PROCESSING_REQUEST', request_id, (select auth.uid()));
  elsif v_request.status = 'SUBMITTED' and target_status in ('APPROVED', 'REJECTED') then
    v_admin_override := v_request.created_by = (select auth.uid())
      and (select private.has_role('system_admin'));
    if v_request.created_by = (select auth.uid()) and not v_admin_override then
      raise exception 'The requester cannot decide the same request';
    end if;
    update public.processing_requests
    set status = target_status,
      approved_by = case when target_status = 'APPROVED' then (select auth.uid()) else null end,
      approval_admin_override = case when target_status = 'APPROVED' then v_admin_override else false end
    where id = request_id;
    update public.approvals
    set status = target_status, decided_by = (select auth.uid()), decided_at = now(),
      admin_override = v_admin_override
    where request_type = 'PROCESSING_REQUEST' and reference_id = request_id and status = 'PENDING';
  else
    raise exception 'Invalid processing request transition from % to %', v_request.status, target_status;
  end if;

  perform private.record_audit('PROCESSING_REQUEST_' || target_status, 'PROCESSING_REQUEST', request_id,
    jsonb_build_object('from', v_request.status, 'to', target_status, 'admin_override', v_admin_override));
  return jsonb_build_object('id', request_id, 'status', target_status);
end;
$$;

create or replace function public.create_and_submit_processing_request(p_header jsonb, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  v_result := public.create_processing_request(p_header, p_lines);
  perform public.transition_processing_request((v_result ->> 'id')::uuid, 'SUBMITTED');
  return v_result || jsonb_build_object('status', 'SUBMITTED');
end;
$$;

create or replace function public.approve_and_queue_processing_request(request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  perform public.transition_processing_request(request_id, 'APPROVED');
  v_result := public.queue_processing_request(request_id);
  return v_result || jsonb_build_object('request_status', 'APPROVED');
end;
$$;

create or replace function public.submit_processing_request(request_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.transition_processing_request(request_id, 'SUBMITTED');
$$;

create or replace function public.reject_processing_request(request_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.transition_processing_request(request_id, 'REJECTED');
$$;

create or replace function public.queue_approved_processing_request(request_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.queue_processing_request(request_id);
$$;

revoke all on function public.create_processing_request(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.queue_processing_request(uuid) from public, anon, authenticated;
revoke all on function public.transition_processing_request(uuid, text) from public, anon, authenticated;
revoke all on function public.create_and_submit_processing_request(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.approve_and_queue_processing_request(uuid) from public, anon, authenticated;
revoke all on function public.submit_processing_request(uuid) from public, anon, authenticated;
revoke all on function public.reject_processing_request(uuid) from public, anon, authenticated;
revoke all on function public.queue_approved_processing_request(uuid) from public, anon, authenticated;
grant execute on function public.create_and_submit_processing_request(jsonb, jsonb) to authenticated;
grant execute on function public.approve_and_queue_processing_request(uuid) to authenticated;
grant execute on function public.submit_processing_request(uuid) to authenticated;
grant execute on function public.reject_processing_request(uuid) to authenticated;
grant execute on function public.queue_approved_processing_request(uuid) to authenticated;
