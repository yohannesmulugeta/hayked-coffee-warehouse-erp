import assert from "node:assert/strict";
import test from "node:test";
import { bagPrintingQuote, evaluateStorageLoss, generatorActualCost } from "../app/warehouse-control-rules.ts";

test("warehouse controls enforce agreement limits and supported costs", () => {
  const ordinary = evaluateStorageLoss({ balanceKg: 10000, lossKg: 150, evidence: true, managerApproved: true, exceptionApproved: false, wetCoffee: false, jointApprovalAttached: false });
  assert.equal(ordinary.valid, true);
  assert.equal(ordinary.percent, 1.5);

  const above = evaluateStorageLoss({ balanceKg: 10000, lossKg: 151, evidence: true, managerApproved: true, exceptionApproved: false, wetCoffee: false, jointApprovalAttached: false });
  assert.equal(above.valid, false);

  assert.equal(bagPrintingQuote(49).valid, false);
  assert.equal(bagPrintingQuote(50).rate, 69.57);
  assert.equal(bagPrintingQuote(100).rate, 55.65);
  assert.equal(bagPrintingQuote(160).rate, 43.48);
  assert.equal(generatorActualCost(45, 128.5), 5782.5);
});
