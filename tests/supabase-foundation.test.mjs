import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

test("Supabase foundation protects warehouse records", () => {
  const migration = readdirSync("supabase/migrations").find((name) => name.endsWith("_hayked_warehouse_foundation.sql"));
  assert.ok(migration);
  const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /stock_movements_immutable/i);
  assert.match(sql, /audit_events_immutable/i);
  assert.match(sql, /requested_by <> \(select auth\.uid\(\)\)/i);
  assert.match(sql, /abs\(input_kg - accepted_client_kg - client_reject_kg - hayked_byproduct_kg - process_loss_kg\) <= 0\.01/i);
  assert.match(sql, /invoices_paid or credit_approved/i);
  assert.match(sql, /'erp-documents', 'erp-documents', false/i);
  assert.doesNotMatch(sql, /service_role/i);
});

test("processing request migration enforces approval and role controls", () => {
  const migration = readdirSync("supabase/migrations").find((name) => name.endsWith("_processing_requests.sql"));
  assert.ok(migration);
  const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");
  assert.match(sql, /status in \('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'\)/i);
  assert.match(sql, /queued_order_id is null or status = 'APPROVED'/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /private\.has_role\('system_admin', 'warehouse_manager', 'processing_supervisor'\)/i);
});

test("operational core posts through atomic audited functions", () => {
  const migration = readdirSync("supabase/migrations").find((name) => name.endsWith("_persistent_operational_core.sql"));
  assert.ok(migration);
  const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");
  for (const name of ["transition_grn", "queue_processing_request", "start_processing_order", "complete_processing_order", "post_dispatch", "record_invoice_payment", "decide_approval"]) {
    assert.match(sql, new RegExp(`function public\\.${name}`, "i"));
  }
  assert.match(sql, /processing_orders_completion_lock/i);
  assert.match(sql, /private\.record_audit/i);
  assert.match(sql, /revoke update on public\.warehouse_receipts/i);
  assert.doesNotMatch(sql, /service_role/i);
});

test("connected workflow migration numbers records and limits GRN edits to drafts", () => {
  const migration = readdirSync("supabase/migrations").find((name) => name.endsWith("_phase1_connected_workflow.sql"));
  assert.ok(migration);
  const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");
  assert.match(sql, /function public\.next_erp_number/i);
  assert.match(sql, /add column request_number text/i);
  assert.match(sql, /function public\.update_grn_draft/i);
  assert.match(sql, /receipt\.status <> 'DRAFT'/i);
  assert.match(sql, /enable row level security/i);
  assert.doesNotMatch(sql, /service_role/i);
  const seedMigration = readdirSync("supabase/migrations").find((name) => name.endsWith("_seed_existing_grn_numbers.sql"));
  assert.ok(seedMigration);
  const seedSql = readFileSync(`supabase/migrations/${seedMigration}`, "utf8");
  assert.match(seedSql, /greatest\(public\.number_sequences\.last_value, excluded\.last_value\)/i);
});

test("processing output migration persists lines, intake, outputs, and idempotent postings", () => {
  const migration = readdirSync("supabase/migrations").find((name) => name.endsWith("_processing_documents_and_outputs.sql"));
  assert.ok(migration);
  const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");
  for (const table of ["processing_request_lines", "processing_order_inputs", "processing_intakes", "processing_outputs"]) {
    assert.match(sql, new RegExp(`create table public\\.${table}`, "i"));
  }
  for (const rpc of ["create_processing_request", "start_processing_order_with_intake", "complete_processing_order_v2"]) {
    assert.match(sql, new RegExp(`function public\\.${rpc}`, "i"));
  }
  assert.match(sql, /stock_movements_processing_input_once_idx/i);
  assert.match(sql, /processing outputs must reconcile to input within 0\.01 kg/i);
  assert.match(sql, /if processing\.status = 'POSTED'.*duplicate.*true/is);
  assert.doesNotMatch(sql, /service_role/i);
});

test("dispatch migration reserves stock and posts every line idempotently", () => {
  const migration = readdirSync("supabase/migrations").find((name) => name.endsWith("_dispatch_reservations_and_release.sql"));
  assert.ok(migration);
  const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");
  for (const table of ["dispatch_lines", "stock_reservations", "credit_overrides"]) assert.match(sql, new RegExp(`create table public\\.${table}`, "i"));
  for (const rpc of ["create_dispatch_draft", "submit_dispatch", "decide_credit_override", "approve_dispatch", "post_dispatch_v2"]) assert.match(sql, new RegExp(`function public\\.${rpc}`, "i"));
  assert.match(sql, /stock_movements_dispatch_once_idx/i);
  assert.match(sql, /requested dispatch quantity exceeds unreserved stock/i);
  assert.match(sql, /if dispatch\.status = 'POSTED'.*duplicate.*true/is);
  assert.match(sql, /an active agreement is required/i);
  assert.doesNotMatch(sql, /service_role/i);
});

test("administration exposes auth emails only through an admin RPC", () => {
  const migration = readdirSync("supabase/migrations").find((name) => name.endsWith("_management_users_and_constraints.sql"));
  assert.ok(migration);
  const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");
  assert.match(sql, /function public\.list_admin_users/i);
  assert.match(sql, /private\.require_role\('system_admin'\)/i);
  assert.match(sql, /processing_request_lines_request_lot_unique_idx/i);
});

test("processing lot eligibility migration adds lot_category, queries eligible lots, and blocks invalid sources", () => {
  const migration = readdirSync("supabase/migrations").find((name) => name.endsWith("_processing_lot_eligibility.sql"));
  assert.ok(migration);
  const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");
  assert.match(sql, /add column if not exists lot_category text/i);
  assert.match(sql, /function public\.list_eligible_processing_lots/i);
  assert.match(sql, /function public\.validate_processing_source_lot/i);
  assert.match(sql, /ARRIVAL.*CLIENT_REJECT.*ACCEPTED_PROCESSED/i);
  assert.match(sql, /Hayked-owned byproduct lots cannot be used/i);
  assert.doesNotMatch(sql, /service_role/i);
});

test("corrective migration removes unsafe default and enforces allowlist in start_processing_order_with_intake", () => {
  const migration = readdirSync("supabase/migrations").find((name) => name.endsWith("_remove_unsafe_lot_category_default.sql"));
  assert.ok(migration);
  const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");
  assert.match(sql, /alter column lot_category drop default/i);
  assert.match(sql, /function public\.start_processing_order_with_intake/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /Ineligible source lot category/i);
  assert.doesNotMatch(sql, /service_role/i);
});

test("operational integrity repair makes stock and finance postings authoritative", () => {
  const migration = readdirSync("supabase/migrations").find((name) => name.endsWith("_operational_integrity_repairs.sql"));
  assert.ok(migration);
  const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");
  const completion = sql.slice(sql.indexOf("create or replace function public.complete_processing_order_v2"), sql.indexOf("-- Storage loss"));

  assert.match(sql, /drop function if exists public\.complete_processing_order_v2\(uuid, jsonb, jsonb\)/i);
  assert.match(sql, /set quantity_kg = quantity_kg - v_input\.input_kg[\s\S]*bag_count = bag_count - v_input\.input_bags/i);
  assert.doesNotMatch(completion, /'PROCESS_INPUT'/i);
  assert.match(completion, /insert into public\.processing_outputs/i);
  assert.match(completion, /PROCESSING_EXCEPTION/i);
  assert.match(sql, /'REVERSED'\s*\)/i);
  assert.match(sql, /'STORAGE_LOSS'.*'ECS_SEND'.*'ECS_RECEIVE'.*'OWNERSHIP_OUT'.*'OWNERSHIP_IN'/is);
  assert.match(sql, /drop policy if exists "Staff access storage_losses"/i);
  assert.match(sql, /revoke insert, update, delete on public\.storage_losses/i);
  assert.match(sql, /Payment exceeds the outstanding invoice balance/i);
  assert.match(sql, /status in \('ISSUED', 'PARTIALLY_PAID', 'PAID'\)/i);
  assert.match(sql, /function public\.cancel_dispatch/i);
  assert.match(sql, /valid_to is null or v_dispatch_date <= valid_to/i);
  assert.doesNotMatch(sql, /service_role/i);
});

test("database lint repairs keep callable result types and storage rules aligned", () => {
  const lintMigration = readdirSync("supabase/migrations").find((name) => name.endsWith("_database_lint_repairs.sql"));
  const lossMigration = readdirSync("supabase/migrations").find((name) => name.endsWith("_storage_loss_rule_alignment.sql"));
  assert.ok(lintMigration);
  assert.ok(lossMigration);
  const lintSql = readFileSync(`supabase/migrations/${lintMigration}`, "utf8");
  const lossSql = readFileSync(`supabase/migrations/${lossMigration}`, "utf8");
  assert.match(lintSql, /total_reserved_bags[\s\S]*::integer/i);
  assert.match(lintSql, /lower\(p\.bank_reference\)/i);
  assert.match(lintSql, /array\[\]::uuid\[\]/i);
  assert.match(lossSql, /p_exception_approved_by = p_manager_approved_by/i);
  assert.doesNotMatch(lossSql, /requires written joint approval/i);
});

test("admin and approval repair keeps decisions atomic and protects administrator access", () => {
  const migration = readdirSync("supabase/migrations").find((name) => name.endsWith("_admin_and_approval_workflow.sql"));
  assert.ok(migration);
  const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");
  assert.match(sql, /function public\.update_admin_profile/i);
  assert.match(sql, /At least one active system administrator is required/i);
  assert.match(sql, /function public\.decide_approval/i);
  assert.match(sql, /update public\.processing_requests[\s\S]*set status = decision/i);
  assert.match(sql, /function public\.post_generator_request_v2/i);
  assert.match(sql, /processing_order_id uuid references public\.processing_orders/i);
  assert.doesNotMatch(sql, /service_role/i);
});

test("authoritative write boundary blocks direct ledger writes and public RPC execution", () => {
  const migration = readdirSync("supabase/migrations").find((name) => name.endsWith("_authoritative_write_boundaries.sql"));
  assert.ok(migration);
  const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");
  assert.match(sql, /revoke insert, update, delete on public\.coffee_lots, public\.stock_movements/i);
  assert.match(sql, /public\.processing_requests[\s\S]*public\.dispatch_orders[\s\S]*public\.invoices/i);
  assert.match(sql, /where namespace\.nspname in \('public', 'private'\) and procedure\.prosecdef/i);
  assert.match(sql, /revoke execute on function %I\.%I\(%s\) from public, anon/i);
});

test("processing traceability refinement shares reservations, preserves lineage, and freezes labour charges", () => {
  const migration = readdirSync("supabase/migrations").find((name) => name.endsWith("_processing_traceability_labour_refinement.sql"));
  assert.ok(migration);
  const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");

  assert.match(sql, /add column processing_order_id uuid references public\.processing_orders/i);
  assert.match(sql, /num_nonnulls\(dispatch_id, processing_order_id\) = 1/i);
  assert.match(sql, /create table public\.processing_output_sources/i);
  assert.match(sql, /create table public\.labour_charge_settings/i);
  assert.match(sql, /create table public\.labour_records/i);
  assert.match(sql, /client_charge_etb = internal_cost_etb \+ charge_addition_etb/i);
  assert.match(sql, /function public\.list_eligible_processing_lots/i);
  assert.match(sql, /function public\.post_labour_entry/i);
  assert.match(sql, /Active processing reservation is missing or no longer matches lot/i);
  assert.match(sql, /insert into public\.processing_output_sources/i);
  assert.doesNotMatch(sql, /service_role/i);
});

test("simplified workflows keep client edits, payment details, readiness fixes and ECX approval authoritative", () => {
  const migration = readdirSync("supabase/migrations").find((name) => name.endsWith("_simplify_erp_workflows.sql"));
  assert.ok(migration);
  const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");

  for (const rpc of ["update_client_profile", "update_dispatch_readiness", "record_invoice_payment_v2", "transition_processing_request"]) {
    assert.match(sql, new RegExp(`function public\\.${rpc}`, "i"));
  }
  assert.match(sql, /payment_method text not null default 'BANK_TRANSFER'/i);
  assert.match(sql, /target_status = 'APPROVED' and not exists[\s\S]*check_record\.result in \('PASSED', 'NOT_REQUIRED'\)/i);
  assert.match(sql, /payment reference has already been recorded/i);
  assert.match(sql, /Payment exceeds the outstanding invoice balance/i);
  assert.match(sql, /revoke all on function public\.update_client_profile/i);
  assert.match(sql, /grant execute on function public\.record_invoice_payment_v2/i);
  assert.doesNotMatch(sql, /service_role/i);
});
