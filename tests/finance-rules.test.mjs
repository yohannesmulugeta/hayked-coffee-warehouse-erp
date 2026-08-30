import assert from "node:assert/strict";
import test from "node:test";
import * as financeRules from "../app/finance-rules.ts";

const { allocatePayment, invoiceSnapshot } = financeRules;

test("finance snapshots reconcile", () => {
  const invoice = invoiceSnapshot([{ description: "Service", quantity: 10, unitPrice: 100 }], .15);
  assert.equal(invoice.total, 1150);
  assert.equal(allocatePayment(invoice.total, 150), 1000);
  assert.throws(() => allocatePayment(1000, 1001), /cannot exceed/i);
});

test("a fully paid invoice returns billing to the normal client account view", () => {
  assert.equal(typeof financeRules.paymentPostAction, "function");
  assert.deepEqual(financeRules.paymentPostAction("PAID"), {
    tab: "Client Accounts",
    resetFilters: true,
    keepInvoiceFocused: false,
  });
});

test("a partial payment keeps the exact invoice focused", () => {
  assert.equal(typeof financeRules.paymentPostAction, "function");
  assert.deepEqual(financeRules.paymentPostAction("PARTIALLY_PAID"), {
    tab: "Payments",
    resetFilters: false,
    keepInvoiceFocused: true,
  });
});

test("storage rent continues on the day after the last billed day", () => {
  assert.equal(typeof financeRules.nextStorageRentStart, "function");
  assert.equal(
    financeRules.nextStorageRentStart("2026-08-01", null),
    "2026-08-01",
  );
  assert.equal(
    financeRules.nextStorageRentStart("2026-08-01", "2026-08-31"),
    "2026-09-01",
  );
});

test("draft invoices are prepared work and never an outstanding debt", () => {
  assert.equal(typeof financeRules.invoiceOutstanding, "function");
  assert.equal(financeRules.invoiceOutstanding("DRAFT", 1200, 0), 0);
  assert.equal(financeRules.invoiceOutstanding("ISSUED", 1200, 200), 1000);
});

test("draft invoices use their preparation date in invoice filters", () => {
  assert.equal(typeof financeRules.invoiceActivityDate, "function");
  assert.equal(
    financeRules.invoiceActivityDate("DRAFT", null, "2026-08-30T09:15:00Z"),
    "2026-08-30T09:15:00Z",
  );
  assert.equal(
    financeRules.invoiceActivityDate("ISSUED", "2026-08-29", "2026-08-30T09:15:00Z"),
    "2026-08-29",
  );
});

test("draft invoices keep their draft label even though they are not debt", () => {
  assert.equal(typeof financeRules.invoiceDisplayStatus, "function");
  assert.equal(financeRules.invoiceDisplayStatus("DRAFT", 0), "DRAFT");
  assert.equal(financeRules.invoiceDisplayStatus("ISSUED", 0), "PAID");
  assert.equal(financeRules.invoiceDisplayStatus("ISSUED", 250), "ISSUED");
});
