import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

test("scanned documents and tariff verification migration enforces database security and RPC constraints", () => {
  const migration = readdirSync("supabase/migrations").find((name) => name.endsWith("_scanned_documents_and_tariff_verification.sql"));
  assert.ok(migration);
  const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");

  // Check table creation and RLS
  assert.match(sql, /create table if not exists public\.machine_schedules/i);
  assert.match(sql, /alter table public\.machine_schedules enable row level security/i);

  // Check RPC functions exist
  for (const rpc of [
    "verify_tariff_version",
    "schedule_processing_machine",
    "export_accounting_general_ledger"
  ]) {
    assert.match(sql, new RegExp(`function public\\.${rpc}`, "i"));
  }

  // Check 2-person tariff verification logic
  assert.match(sql, /verified_by_1 is null/i);
  assert.match(sql, /verified_by_1 = v_user_id/i);
  assert.match(sql, /Maker-checker policy violation: Tariff verification requires a second independent user/i);

  // Check General Ledger Double-Entry export
  assert.match(sql, /Accounts Receivable/i);
  assert.match(sql, /Warehouse Service Revenue/i);
  assert.match(sql, /Bank \/ Cash Operations/i);
  assert.doesNotMatch(sql, /service_role/i);
});
