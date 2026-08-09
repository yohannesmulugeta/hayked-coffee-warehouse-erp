-- Stock, approvals, dispatch, and finance must only change through role-checked RPCs.

revoke insert, update, delete on public.coffee_lots, public.stock_movements,
  public.processing_requests, public.processing_request_lines, public.processing_orders,
  public.processing_order_inputs, public.processing_intakes, public.processing_outputs,
  public.dispatch_orders, public.dispatch_lines, public.stock_reservations,
  public.ecs_transfers, public.ownership_transfers, public.invoices, public.payments,
  public.approvals, public.audit_events from authenticated;

do $$
declare
  function_record record;
begin
  for function_record in
    select namespace.nspname as schema_name, procedure.proname as function_name,
      pg_get_function_identity_arguments(procedure.oid) as argument_list
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'private') and procedure.prosecdef
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from public, anon',
      function_record.schema_name,
      function_record.function_name,
      function_record.argument_list
    );
  end loop;
end;
$$;
