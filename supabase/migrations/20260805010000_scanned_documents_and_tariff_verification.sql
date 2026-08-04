-- Migration: 20260805010000_scanned_documents_and_tariff_verification.sql
-- Purpose: Machine scheduling, two-person tariff verification, and accounting GL double-entry export

-- 1. Table for Machine Scheduling
create table if not exists public.machine_schedules (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.processing_orders(id),
  machine_name text not null check (machine_name in ('HULLER_1', 'HULLER_2', 'CLEANER_1', 'COLOR_SORTER_1', 'GRAVITY_SEPARATOR_1')),
  shift_name text not null check (shift_name in ('MORNING', 'AFTERNOON', 'NIGHT')),
  scheduled_date date not null,
  allocated_hours numeric(6,2) not null check (allocated_hours > 0 and allocated_hours <= 12),
  capacity_kg_per_hr numeric(10,2) not null check (capacity_kg_per_hr > 0),
  scheduled_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.machine_schedules enable row level security;
create policy "Staff access machine_schedules" on public.machine_schedules for all to authenticated using (true) with check (true);

-- 2. Two-Person Tariff Verification RPC
create or replace function public.verify_tariff_version(
  p_tariff_version_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_tariff public.tariff_versions;
  v_status text;
begin
  v_user_id := (select auth.uid());
  perform private.require_role('system_admin', 'finance_officer', 'warehouse_manager');

  select * into v_tariff from public.tariff_versions where id = p_tariff_version_id;
  if not found then raise exception 'Tariff version record not found.'; end if;

  if v_tariff.verified_by_1 is null then
    update public.tariff_versions
    set verified_by_1 = v_user_id
    where id = p_tariff_version_id;
    v_status := 'PARTIALLY_VERIFIED';
  elsif v_tariff.verified_by_1 = v_user_id then
    raise exception 'Maker-checker policy violation: Tariff verification requires a second independent user.';
  elsif v_tariff.verified_by_2 is null then
    update public.tariff_versions
    set verified_by_2 = v_user_id,
        active = true
    where id = p_tariff_version_id;
    v_status := 'FULLY_VERIFIED';
  else
    v_status := 'ALREADY_VERIFIED';
  end if;

  perform private.record_audit('VERIFY_TARIFF', 'tariff_versions', p_tariff_version_id, jsonb_build_object('status', v_status, 'verifier', v_user_id));
  return v_status;
end;
$$;

-- 3. Schedule Machine Shift RPC
create or replace function public.schedule_processing_machine(
  p_order_id uuid,
  p_machine_name text,
  p_shift_name text,
  p_scheduled_date date,
  p_allocated_hours numeric,
  p_capacity_kg_per_hr numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_order public.processing_orders;
  v_schedule_id uuid;
begin
  v_user_id := (select auth.uid());
  perform private.require_role('system_admin', 'processing_supervisor', 'warehouse_manager');

  select * into v_order from public.processing_orders where id = p_order_id;
  if not found then raise exception 'Processing order not found.'; end if;

  insert into public.machine_schedules (
    order_id, machine_name, shift_name, scheduled_date, allocated_hours, capacity_kg_per_hr, scheduled_by
  ) values (
    p_order_id, p_machine_name, p_shift_name, p_scheduled_date, p_allocated_hours, p_capacity_kg_per_hr, v_user_id
  ) returning id into v_schedule_id;

  return v_schedule_id;
end;
$$;

-- 4. General Ledger Double-Entry Summary Export RPC
create or replace function public.export_accounting_general_ledger(
  p_start_date date,
  p_end_date date
)
returns table (
  account_code text,
  account_name text,
  debit_etb numeric(16,2),
  credit_etb numeric(16,2),
  entry_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role('system_admin', 'finance_officer');

  return query
  with invoice_summary as (
    select
      coalesce(sum(subtotal_etb + tax_etb), 0) as total_receivable,
      coalesce(sum(subtotal_etb), 0) as total_revenue,
      coalesce(sum(tax_etb), 0) as total_tax,
      count(*)::integer as inv_count
    from public.invoices
    where created_at::date between p_start_date and p_end_date
  ),
  payment_summary as (
    select
      coalesce(sum(amount_etb), 0) as total_cash,
      count(*)::integer as pay_count
    from public.payments
    where created_at::date between p_start_date and p_end_date
  )
  select '1100'::text as account_code, 'Accounts Receivable'::text as account_name, inv.total_receivable as debit_etb, 0.00::numeric(16,2) as credit_etb, inv.inv_count as entry_count
  from invoice_summary inv
  union all
  select '4000'::text, 'Warehouse Service Revenue'::text, 0.00::numeric(16,2), inv.total_revenue, inv.inv_count
  from invoice_summary inv
  union all
  select '2200'::text, 'VAT / Tax Payable'::text, 0.00::numeric(16,2), inv.total_tax, inv.inv_count
  from invoice_summary inv
  union all
  select '1010'::text, 'Bank / Cash Operations'::text, pay.total_cash, 0.00::numeric(16,2), pay.pay_count
  from payment_summary pay
  union all
  select '1100'::text, 'Accounts Receivable (Settlements)'::text, 0.00::numeric(16,2), pay.total_cash, pay.pay_count
  from payment_summary pay;
end;
$$;

grant execute on function public.verify_tariff_version to authenticated;
grant execute on function public.schedule_processing_machine to authenticated;
grant execute on function public.export_accounting_general_ledger to authenticated;
