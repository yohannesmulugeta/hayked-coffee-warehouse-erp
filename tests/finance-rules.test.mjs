import assert from "node:assert/strict";
import test from "node:test";
import { allocatePayment, invoiceSnapshot } from "../app/finance-rules.ts";

test("finance snapshots reconcile", () => {
  const invoice = invoiceSnapshot([{ description: "Service", quantity: 10, unitPrice: 100 }], .15);
  assert.equal(invoice.total, 1150);
  assert.equal(allocatePayment(invoice.total, 150), 1000);
  assert.throws(() => allocatePayment(1000, 1001), /cannot exceed/i);
});
