with receipt_sequences as (
  select warehouse.organization_id, warehouse.id as warehouse_id,
    extract(year from receipt.arrival_at)::integer as calendar_year,
    max(coalesce(nullif(substring(receipt.receipt_number from '([0-9]+)$'), ''), '0')::bigint) as last_value
  from public.warehouse_receipts receipt
  join public.warehouses warehouse on warehouse.id = receipt.warehouse_id
  where warehouse.code = 'GEL'
  group by warehouse.organization_id, warehouse.id, extract(year from receipt.arrival_at)
)
insert into public.number_sequences (
  scope_key, organization_id, warehouse_id, document_type, calendar_year, last_value
)
select organization_id || '|' || warehouse_id || '|GRN|' || calendar_year,
  organization_id, warehouse_id, 'GRN', calendar_year, last_value
from receipt_sequences
on conflict (scope_key) do update
set last_value = greatest(public.number_sequences.last_value, excluded.last_value), updated_at = now();
