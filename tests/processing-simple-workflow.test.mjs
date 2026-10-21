import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8").catch(() => "");
}

test("processing requests enter approval automatically and ECX remains optional", async () => {
  const [migration, data, processing, page] = await Promise.all([
    source("../supabase/migrations/20260901090000_simplify_processing_approval_flow.sql"),
    source("../lib/erp-data.ts"),
    source("../app/processing-operations.tsx"),
    source("../app/page.tsx"),
  ]);

  assert.match(migration, /create_and_submit_processing_request/);
  assert.match(migration, /approve_and_queue_processing_request/);
  assert.match(migration, /submit_processing_request/);
  assert.match(migration, /reject_processing_request/);
  assert.match(migration, /queue_approved_processing_request/);
  assert.match(migration, /drop trigger if exists processing_orders_require_ecx_before_start/);
  assert.match(migration, /approval_admin_override/);
  assert.match(migration, /admin_override/);
  assert.match(migration, /revoke all on function public\.create_processing_request\(jsonb, jsonb\).*authenticated/i);
  assert.match(migration, /revoke all on function public\.queue_processing_request\(uuid\).*authenticated/i);
  assert.match(migration, /revoke all on function public\.transition_processing_request\(uuid, text\).*authenticated/i);
  assert.doesNotMatch(migration, /Complete the ECX check.*before approval/);
  assert.match(data, /create_and_submit_processing_request/);
  assert.match(data, /approve_and_queue_processing_request/);
  assert.doesNotMatch(data, /processingRpc/);
  assert.match(processing, /Optional ECX information/);
  assert.match(processing, /decisionError/);
  assert.doesNotMatch(processing, /ECX:.*Action required/);
  assert.match(page, /role=\{profile\.role\} userId=\{profile\.id\}/);
});
