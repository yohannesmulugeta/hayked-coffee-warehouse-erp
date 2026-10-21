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
test("warehouse billing dates cross midnight consistently in Addis Ababa", () => {
  assert.equal(financeRules.billingDate(0, new Date("2026-09-08T21:01:00Z")), "2026-09-09");
  assert.equal(financeRules.billingDate(-1, new Date("2026-09-08T21:01:00Z")), "2026-09-08");
});

test("account status exposes prepared work and rent awaiting review", () => {
  assert.equal(financeRules.billingAccountStatus(0, 899, 0, false), "DRAFT_PENDING");
  assert.equal(financeRules.billingAccountStatus(0, 0, 100, false), "UNBILLED_WORK");
  assert.equal(financeRules.billingAccountStatus(0, 0, 0, true), "RENT_REVIEW");
  assert.equal(financeRules.billingAccountStatus(50, 899, 0, true), "OUTSTANDING");
});

test("processing uses the receiving agreement even after a new agreement starts", () => {
  const data = {
    processingOrders: [{id:"order", lot_id:"lot"}], lots:[{id:"lot",receipt_id:"receipt"}],
    receipts:[{id:"receipt",agreement_id:"old"}], rentOverview:[],
    agreements:[
      {id:"old",client_id:"client",status:"EXPIRED",effective_from:"2026-01-01",effective_to:"2026-06-30",tariff_version:"OLD"},
      {id:"new",client_id:"client",status:"ACTIVE",effective_from:"2026-07-01",effective_to:null,tariff_version:"NEW"}
    ]
  };
  assert.equal(financeRules.serviceAgreementVersion(data,"client","2026-09-09","order"),"OLD");
  assert.equal(financeRules.serviceAgreementVersion(data,"client","2026-09-09",""),"NEW");
});
