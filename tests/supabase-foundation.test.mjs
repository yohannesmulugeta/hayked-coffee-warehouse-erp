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


