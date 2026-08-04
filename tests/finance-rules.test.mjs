import assert from "node:assert/strict";
import test from "node:test";
import { allocatePayment, calculateStorage, invoiceSnapshot } from "../app/finance-rules.ts";

test("storage replays movements and finance snapshots reconcile", () => {
  const storage = calculateStorage({ client: "Client", lot: "LOT-1", category: "WAITING_PROCESSING", receivedDate: "2026-07-01", periodStart: "2026-07-01", periodEnd: "2026-07-31", tariffVersion: "TV-001", movements: [{ date: "2026-07-01", bagsDelta: 320, reference: "GRN-1" }, { date: "2026-07-25", bagsDelta: -100, reference: "DSP-1" }] });
  assert.equal(storage.billableBagDays, 2820);
  assert.equal(storage.amount, 7755);

  const invoice = invoiceSnapshot([{ description: "Service", quantity: 10, unitPrice: 100 }], .15);
  assert.equal(invoice.total, 1150);
  assert.equal(allocatePayment(invoice.total, 150), 1000);
  assert.throws(() => allocatePayment(1000, 1001), /cannot exceed/i);
});
