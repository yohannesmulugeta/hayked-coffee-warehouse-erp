import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { daysOverdue, lotStatusLabel, lotTypeLabel, notificationTarget, stockMatches } from "../app/ux-rules.ts";

const baseLot = {
  lotNumber: "LOT-001",
  sourceGrn: "GRN-001",
  client: "Guji Coffee",
  coffee: "Washed",
  grade: "Grade 1",
  section: "A-01",
  bags: 10,
  weightKg: 600,
  status: "ARRIVAL_IN_STORAGE",
  lotCategory: "ARRIVAL",
  ownershipType: "CLIENT",
};

test("coffee stock keeps type and workflow status separate", () => {
  assert.equal(lotTypeLabel(baseLot), "Arrival");
  assert.equal(lotStatusLabel(baseLot.status), "Available");
  assert.equal(lotStatusLabel("IN_PROCESS"), "In Processing");
  assert.equal(stockMatches(baseLot, "Arrival", "Available", "Guji Coffee", "GRN-001"), true);
  assert.equal(stockMatches(baseLot, "Processed", "Available", "Guji Coffee", ""), false);
});

test("actionable attention labels route to the correct workspace", () => {
  assert.deepEqual(notificationTarget("Pending approvals"), { view: "Approvals" });
  assert.deepEqual(notificationTarget("Agreements expiring"), { view: "Agreements" });
  assert.equal(notificationTarget("Processing exceptions").view, "Processing");
  assert.deepEqual(notificationTarget("Open invoices"), { view: "Finance" });
});

test("overdue days never become negative", () => {
  const today = new Date("2026-08-09T12:00:00Z");
  assert.equal(daysOverdue("2026-08-01", today), 8);
  assert.equal(daysOverdue("2026-08-20", today), 0);
});

test("dashboard exposes actionable navigation without the day-shift strip", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /className="shift-strip"/);
  assert.match(source, /No items need your attention\./);
  assert.match(source, /notificationTarget\(item\.label\)/);
  assert.match(source, /stockType: "Arrival"/);
  assert.match(source, /processingState: "Ready to Start"/);
});

test("client onboarding and stock views retain the required daily controls", async () => {
  const source = await readFile(new URL("../app/core-operations.tsx", import.meta.url), "utf8");
  assert.match(source, /Client details/);
  assert.match(source, /Agreement/);
  assert.match(source, /Authorized representatives/);
  assert.match(source, /Add representative/i);
  assert.match(source, /createClientSetup/);
  assert.match(source, /<span>Type<\/span>/);
  assert.match(source, /<span>Status<\/span>/);
  assert.match(source, /stockMatches/);
});

test("processing, storage loss, billing, reports and audit use guided workspaces", async () => {
  const [processing, storage, finance, management] = await Promise.all([
    readFile(new URL("../app/processing-operations.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/warehouse-controls.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/finance-operations.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/management-operations.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(processing, /Waiting Approval/);
  assert.match(processing, /Ready to Start/);
  assert.match(processing, /AddInputLotDialog/);
  assert.match(storage, /System quantity/);
  assert.match(storage, /Physical measurement/);
  assert.match(storage, /postStorageLoss/);
  assert.match(finance, /Unbilled Services/);
  assert.match(finance, /serviceEvents/);
  assert.match(finance, /daysOverdue/);
  assert.match(finance, /Current outstanding always shows the complete account balance/);
  assert.match(finance, /Show changes only/);
  assert.match(management, /loadReportTable/);
  assert.match(management, /Export CSV/);
  assert.match(management, /Search reference, user, action/);
  assert.doesNotMatch(management, /<span>Event ID<\/span>/);
});
