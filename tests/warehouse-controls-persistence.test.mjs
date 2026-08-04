import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { evaluateStorageLoss, bagPrintingQuote, generatorActualCost } from "../app/warehouse-control-rules.ts";
import { calculateStorage, storageRate } from "../app/finance-rules.ts";

test("warehouse controls migration enforces RLS, maker-checker, and stock movement integrity", () => {
  const migration = readdirSync("supabase/migrations").find((name) => name.endsWith("_warehouse_controls_and_billing.sql"));
  assert.ok(migration);
  const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");

  // Check tables exist
  for (const table of [
    "storage_losses",
    "bag_inventory_movements",
    "bag_printing_orders",
    "generator_usage_requests",
    "tariff_versions",
    "tariff_line_items",
    "storage_billing_runs",
    "service_events"
  ]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`, "i"));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }

  // Check RPC functions exist
  for (const rpc of [
    "post_storage_loss",
    "post_bag_printing_order",
    "post_generator_request",
    "calculate_and_save_storage_billing",
    "post_ecs_transfer",
    "receive_ecs_transfer",
    "post_ownership_transfer"
  ]) {
    assert.match(sql, new RegExp(`function public\\.${rpc}`, "i"));
  }

  // Check Maker-Checker & Duplicate keys
  assert.match(sql, /Maker-checker policy violation/i);
  assert.match(sql, /duplicate_key text not null unique/i);
  assert.match(sql, /Loss above 1\.5%/i);
  assert.doesNotMatch(sql, /service_role/i);
});

test("storage loss and bag control rule mechanics operate as expected", () => {
  const lossEval = evaluateStorageLoss({ balanceKg: 10000, lossKg: 150, evidence: true, managerApproved: true, exceptionApproved: false, wetCoffee: false, jointApprovalAttached: false });
  assert.equal(lossEval.valid, true);

  const bagQuote = bagPrintingQuote(160);
  assert.equal(bagQuote.valid, true);
  assert.equal(bagQuote.rate, 43.48);
  assert.equal(bagQuote.total, 6956.8);

  const genCost = generatorActualCost(50, 130);
  assert.equal(genCost, 6500);
});

test("storage rate and billing calculation engine functions correctly", () => {
  assert.equal(storageRate("NO_PROCESSING", 30), 5);
  assert.equal(storageRate("NO_PROCESSING", 95), 7);
  assert.equal(storageRate("WAITING_PROCESSING", 15), 0);
  assert.equal(storageRate("WAITING_PROCESSING", 30), 2.75);

  const billing = calculateStorage({
    client: "CL-001",
    lot: "LOT-001",
    category: "NO_PROCESSING",
    receivedDate: "2026-01-01",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-05",
    tariffVersion: "TARIFF-2026-V1",
    movements: [{ date: "2026-01-01", bagsDelta: 100, reference: "GRN-001" }]
  });

  assert.ok(billing.amount > 0);
  assert.ok(billing.billableBagDays > 0);
  assert.match(billing.duplicateKey, /CL-001\|LOT-001\|NO_PROCESSING\|2026-01-01\|2026-01-05\|TARIFF-2026-V1/);
});
