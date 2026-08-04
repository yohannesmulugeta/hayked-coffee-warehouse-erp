import assert from "node:assert/strict";
import test from "node:test";
import { activeOn, clientReadiness } from "../app/client-onboarding.ts";
import { advanceReceipt, postReceipt, reverseReceipt } from "../app/grn-workflow.ts";

const draft = {
  id: "GRN-TEST-0001",
  client: "Test Coffee PLC",
  agreement: "AGR-TEST-001",
  representative: "Test Representative",
  receivedAt: "2026-08-01T08:00",
  warehouse: "Main Warehouse",
  section: "A-01 Arrival",
  truckPlate: "ET-TEST",
  driverName: "Test Driver",
  sealNumber: "SL-TEST",
  weighbridgeRef: "WB-TEST",
  origin: "Guji",
  coffeeType: "Unwashed / UG",
  grade: "Grade 1",
  cropYear: 2026,
  bags: 320,
  bagWeightKg: 60,
  grossWeightKg: 19850,
  tareWeightKg: 650,
  netWeightKg: 19200,
  moisturePercent: 10.8,
  wetCoffee: false,
  receivedBy: "Manager",
  createdBy: "Clerk",
  status: "DRAFT",
};

test("GRN approval posts one lot and reverses through a compensating movement", () => {
  const submitted = advanceReceipt(draft);
  const approved = advanceReceipt(submitted);
  const posted = postReceipt(approved, "HYK/GEL/2026/TEST", []);

  assert.equal(posted.receipt.status, "POSTED");
  assert.equal(posted.lot.weightKg, 19200);
  assert.equal(posted.movement.weightDeltaKg, 19200);
  assert.throws(() => postReceipt(approved, "HYK/GEL/2026/TEST2", [posted.lot]), /already created/);

  const reversed = reverseReceipt(posted.receipt, posted.lot, "Duplicate physical receipt recorded in error");
  assert.equal(reversed.receipt.status, "REVERSED");
  assert.equal(reversed.lot.weightKg, 0);
  assert.equal(reversed.movement.weightDeltaKg, -19200);
});

test("client readiness requires currently valid agreement and representative records", () => {
  assert.equal(activeOn("2026-08-01", "2026-08-01", "2026-12-31", true), true);
  assert.equal(activeOn("2027-01-01", "2026-08-01", "2026-12-31", true), false);
  assert.equal(clientReadiness(true, true, true), "READY");
  assert.equal(clientReadiness(true, true, false), "INCOMPLETE");
});
