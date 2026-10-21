import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { evaluateStorageLoss, bagPrintingQuote, filterServiceHistory, generatorActualCost, paginateServiceHistory } from "../app/warehouse-control-rules.ts";

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

test("service history is searchable, filterable, and limited to ten rows per page", () => {
  const rows = Array.from({ length: 14 }, (_, index) => ({
    id: `row-${index}`,
    type: index % 2 === 0 ? "LABOUR" : "SERVICE",
    date: `2026-08-${String(index + 1).padStart(2, "0")}`,
    searchText: index === 12 ? "guji special handling" : `client ${index}`,
  }));

  assert.deepEqual(
    filterServiceHistory(rows, { query: "guji", type: "ALL", from: "", to: "" }).map((row) => row.id),
    ["row-12"],
  );
  assert.equal(filterServiceHistory(rows, { query: "", type: "LABOUR", from: "2026-08-05", to: "2026-08-11" }).length, 4);
  assert.deepEqual(paginateServiceHistory(rows, 1).map((row) => row.id), rows.slice(0, 10).map((row) => row.id));
  assert.deepEqual(paginateServiceHistory(rows, 2).map((row) => row.id), rows.slice(10).map((row) => row.id));
});

test("labour and services exposes four focused workspaces", () => {
  const source = readFileSync("app/warehouse-controls.tsx", "utf8");
  assert.match(source, /role="tablist"/);
  for (const label of ["Labour", "Services", "Warehouse Rent", "History"]) {
    assert.match(source, new RegExp(`>${label}<`));
  }
  assert.match(source, /activeServiceTab === "HISTORY"/);
  assert.match(source, /Search reference, client, or activity/);
  assert.match(source, /10 per page/);
});

test("storage billing is tariff-authoritative and preserves daily calculation rows", () => {
  const migration = readdirSync("supabase/migrations").find((name) => name.endsWith("_client_billing_rate_authority.sql"));
  assert.ok(migration);
  const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");
  const finance = readFileSync("app/finance-operations.tsx", "utf8");

  assert.match(sql, /create table if not exists public\.storage_billing_run_days/i);
  assert.match(sql, /function private\.storage_billing_daily_rows/i);
  assert.match(sql, /function public\.quote_storage_billing/i);
  assert.match(sql, /function public\.calculate_and_save_storage_billing_v2/i);
  assert.match(sql, /revoke execute on function public\.calculate_and_save_storage_billing/i);
  assert.match(sql, /function public\.create_client_setup/i);
  assert.match(finance, /Show every day/);
  assert.doesNotMatch(finance, /2\.75/);
});
