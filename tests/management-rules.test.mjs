import assert from "node:assert/strict";
import test from "node:test";
import { advanceArrearsCase, appendAudit, approveRequest } from "../app/management-rules.ts";

test("management controls keep recovery separate and enforce independent approval", () => {
  const recovery = advanceArrearsCase("PAYMENT_REMINDER", "FORMAL_NOTICE");
  assert.equal(recovery.stage, "FORMAL_NOTICE");
  assert.equal(recovery.stockMovement, null);
  assert.throws(() => advanceArrearsCase("PAYMENT_REMINDER", "LEGAL_REVIEW"), /cannot move/i);
  assert.equal(approveRequest("Dawit Alemu", "Meron Tadesse").status, "APPROVED");
  assert.throws(() => approveRequest("Meron Tadesse", "meron tadesse"), /own request/i);

  const original = [{ id: "AUD-1", at: "now", actor: "A", action: "Created", reference: "REF-1" }];
  const updated = appendAudit(original, { id: "AUD-2", at: "later", actor: "B", action: "Approved", reference: "REF-1" });
  assert.equal(original.length, 1);
  assert.equal(updated.length, 2);
  assert.throws(() => appendAudit(updated, updated[0]), /already exists/i);
});
