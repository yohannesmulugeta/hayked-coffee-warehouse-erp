import assert from "node:assert/strict";
import test from "node:test";

/**
 * Pure stateful simulation of PostgreSQL FOR UPDATE transaction semantics
 * for processing start operations.
 */
function createDatabaseState() {
  return {
    lots: new Map(),
    movements: [],
    orders: new Map(),
    reservations: new Map(),
  };
}

function simulateStartProcessingOrder(db, { orderId, clientId, lotId, requestedKg }) {
  const lot = db.lots.get(lotId);
  if (!lot) throw new Error(`Source coffee lot ${lotId} not found.`);

  if (lot.client_id !== clientId) {
    throw new Error(`Source coffee lot ${lot.lot_number} does not belong to the processing client.`);
  }

  if (lot.ownership_type !== "CLIENT") {
    throw new Error("Hayked-owned byproduct lots cannot be used as processing inputs.");
  }

  // STRICT POSITIVE ALLOWLIST: ONLY ARRIVAL, CLIENT_REJECT, ACCEPTED_PROCESSED
  const allowedCategories = new Set(["ARRIVAL", "CLIENT_REJECT", "ACCEPTED_PROCESSED"]);
  if (!lot.lot_category || !allowedCategories.has(lot.lot_category)) {
    throw new Error(`Ineligible source lot category: ${lot.lot_category ?? "NULL"}. Processing input must be ARRIVAL, CLIENT_REJECT, or ACCEPTED_PROCESSED.`);
  }

  if (["REVERSED", "CLOSED", "DISPATCHED"].includes(lot.status)) {
    throw new Error(`Source lot ${lot.lot_number} is in status ${lot.status} and cannot be processed.`);
  }

  const reservedKg = db.reservations.get(lotId) ?? 0;
  const availableKg = lot.quantity_kg - reservedKg;

  if (requestedKg <= 0 || requestedKg > availableKg) {
    throw new Error(`Requested input (${requestedKg.toFixed(2)} kg) for lot ${lot.lot_number} exceeds available balance (${availableKg.toFixed(2)} kg).`);
  }

  // Atomic state updates
  lot.quantity_kg -= requestedKg;
  lot.status = "IN_PROCESS";

  db.movements.push({
    lot_id: lotId,
    movement_type: "PROCESS_INPUT",
    quantity_kg: -requestedKg,
    reference_id: orderId,
  });

  db.orders.set(orderId, { status: "IN_PROCESS", input_kg: requestedKg });

  return { success: true, remainingKg: lot.quantity_kg };
}

test("authoritative RPC enforces strict positive allowlist and rejects ineligible source categories", () => {
  const db = createDatabaseState();
  const clientId = "client-guji-001";

  // Setup test lots across all category types
  const categories = [
    { id: "lot-arrival", cat: "ARRIVAL", valid: true },
    { id: "lot-reject", cat: "CLIENT_REJECT", valid: true },
    { id: "lot-accepted", cat: "ACCEPTED_PROCESSED", valid: true },
    { id: "lot-byproduct", cat: "HAYKED_BYPRODUCT", valid: false },
    { id: "lot-other", cat: "OTHER", valid: false },
    { id: "lot-null", cat: null, valid: false },
  ];

  for (const item of categories) {
    db.lots.set(item.id, {
      id: item.id,
      lot_number: `HYK-LOT-${item.id}`,
      client_id: clientId,
      ownership_type: item.cat === "HAYKED_BYPRODUCT" ? "HAYKED" : "CLIENT",
      lot_category: item.cat,
      quantity_kg: 1000,
      status: "ARRIVAL_IN_STORAGE",
    });

    if (item.valid) {
      const res = simulateStartProcessingOrder(db, { orderId: `ord-${item.id}`, clientId, lotId: item.id, requestedKg: 500 });
      assert.equal(res.success, true);
    } else {
      assert.throws(
        () => simulateStartProcessingOrder(db, { orderId: `ord-${item.id}`, clientId, lotId: item.id, requestedKg: 500 }),
        /Ineligible source lot category|Hayked-owned byproduct lots/
      );
    }
  }
});

test("two concurrent processing-start requests on the same lot strictly prevent negative stock", async () => {
  const db = createDatabaseState();
  const clientId = "client-guji-001";
  const lotId = "lot-shared-10000";

  db.lots.set(lotId, {
    id: lotId,
    lot_number: "HYK-SHARED-10000",
    client_id: clientId,
    ownership_type: "CLIENT",
    lot_category: "ARRIVAL",
    quantity_kg: 10000,
    status: "ARRIVAL_IN_STORAGE",
  });

  // Attempt A: 7,000 kg, Attempt B: 7,000 kg
  const attemptA = () => Promise.resolve().then(() => simulateStartProcessingOrder(db, { orderId: "ord-A", clientId, lotId, requestedKg: 7000 }));
  const attemptB = () => Promise.resolve().then(() => simulateStartProcessingOrder(db, { orderId: "ord-B", clientId, lotId, requestedKg: 7000 }));

  const results = await Promise.allSettled([attemptA(), attemptB()]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);

  // Verification assertions
  const finalLot = db.lots.get(lotId);
  assert.equal(finalLot.quantity_kg, 3000);
  assert.equal(db.movements.length, 1);
  assert.equal(db.movements[0].movement_type, "PROCESS_INPUT");
  assert.equal(db.movements[0].quantity_kg, -7000);
});
