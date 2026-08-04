create or replace function public.update_grn_draft(
  receipt_id uuid,
  client_id uuid,
  agreement_id uuid,
  representative_id uuid,
  arrival_at timestamptz,
  coffee_type text,
  bag_count integer,
  net_weight_kg numeric,
  vehicle_plate text,
  section text,
  driver_name text,
  seal_number text,
  weighbridge_reference text,
  origin text,
  grade text,
  crop_year integer,
  bag_weight_kg numeric,
  gross_weight_kg numeric,
  tare_weight_kg numeric,
  moisture_percent numeric,
  wet_coffee boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  receipt public.warehouse_receipts;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'warehouse_officer');
  select * into receipt from public.warehouse_receipts where id = update_grn_draft.receipt_id for update;
  if not found then raise exception 'Warehouse receipt not found'; end if;
  if receipt.status <> 'DRAFT' then raise exception 'Only a draft GRN can be edited'; end if;
  if bag_count <= 0 or net_weight_kg <= 0 or bag_weight_kg <= 0 then raise exception 'Bags and weights must be positive'; end if;
  if gross_weight_kg <= 0 or tare_weight_kg < 0 or abs(gross_weight_kg - tare_weight_kg - net_weight_kg) > 0.01 then
    raise exception 'Net weight must equal gross weight minus tare weight';
  end if;
  if not exists (
    select 1 from public.clients c where c.id = update_grn_draft.client_id and c.active
  ) then raise exception 'Active client not found'; end if;
  if not exists (
    select 1 from public.agreements a where a.id = update_grn_draft.agreement_id and a.client_id = update_grn_draft.client_id and a.status = 'ACTIVE'
      and a.effective_from <= update_grn_draft.arrival_at::date and (a.effective_to is null or a.effective_to >= update_grn_draft.arrival_at::date)
  ) then raise exception 'A valid active client agreement is required'; end if;
  if not exists (
    select 1 from public.authorized_representatives r where r.id = update_grn_draft.representative_id and r.client_id = update_grn_draft.client_id and r.active
      and r.valid_from <= update_grn_draft.arrival_at::date and (r.valid_to is null or r.valid_to >= update_grn_draft.arrival_at::date)
  ) then raise exception 'A valid authorized representative is required'; end if;

  update public.warehouse_receipts set
    client_id = update_grn_draft.client_id,
    agreement_id = update_grn_draft.agreement_id,
    representative_id = update_grn_draft.representative_id,
    arrival_at = update_grn_draft.arrival_at,
    coffee_type = update_grn_draft.coffee_type,
    bag_count = update_grn_draft.bag_count,
    net_weight_kg = update_grn_draft.net_weight_kg,
    vehicle_plate = update_grn_draft.vehicle_plate,
    section = update_grn_draft.section,
    driver_name = update_grn_draft.driver_name,
    seal_number = update_grn_draft.seal_number,
    weighbridge_reference = update_grn_draft.weighbridge_reference,
    origin = update_grn_draft.origin,
    grade = update_grn_draft.grade,
    crop_year = update_grn_draft.crop_year,
    bag_weight_kg = update_grn_draft.bag_weight_kg,
    gross_weight_kg = update_grn_draft.gross_weight_kg,
    tare_weight_kg = update_grn_draft.tare_weight_kg,
    moisture_percent = update_grn_draft.moisture_percent,
    wet_coffee = update_grn_draft.wet_coffee
  where id = update_grn_draft.receipt_id;

  perform private.record_audit('GRN_DRAFT_UPDATED', 'WAREHOUSE_RECEIPT', update_grn_draft.receipt_id,
    jsonb_build_object('receipt_number', receipt.receipt_number));
  return jsonb_build_object('id', update_grn_draft.receipt_id, 'receipt_number', receipt.receipt_number, 'status', 'DRAFT');
end;
$$;
