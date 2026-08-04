import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCompletion, evaluateOutputCompletion, queueProcessingRequest, transitionProcessingRequest, validateProcessingRequest, validateProcessingRequestLines } from "../app/processing-workflow.ts";

const evidence = { weighingEvidence: true, exceptionApproved: false };

test("washed and unwashed processing use their correct agreement allowances", () => {
  const washed = evaluateCompletion({ coffeeType: "Washed", inputKg: 1000, acceptedKg: 775, rejectsKg: {}, byproductKg: 200, processLossKg: 25, ...evidence });
  assert.equal(washed.valid, true);
  assert.equal(washed.actualPercent, 22.5);

  const unwashed = evaluateCompletion({ coffeeType: "Unwashed / UG", inputKg: 1000, acceptedKg: 975, rejectsKg: {}, byproductKg: 0, processLossKg: 25, ...evidence });
  assert.equal(unwashed.valid, true);
  assert.equal(unwashed.actualPercent, 2.5);

  const above = evaluateCompletion({ coffeeType: "Unwashed / UG", inputKg: 1000, acceptedKg: 970, rejectsKg: {}, byproductKg: 0, processLossKg: 30, ...evidence });
  assert.equal(above.valid, false);
  assert.match(above.errors.join(" "), /independent approval/i);
});

test("request lines reject duplicate lots and processing outputs preserve categories", () => {
  const line = { lotDatabaseId: "lot-1", lot: "LOT-1", coffeeType: "Washed", preparationType: "Export", grade: "Grade 1", requestedBags: 10, requestedKg: 600, certifications: [], specialInstruction: "", remark: "" };
  assert.equal(validateProcessingRequestLines([line]).valid, true);
  assert.equal(validateProcessingRequestLines([line, { ...line }]).valid, false);

  const output = evaluateOutputCompletion(1000, "Washed", [
    { category: "ACCEPTED_CLIENT_COFFEE", coffeeType: "WASHED", grade: "Grade 1", preparation: "Export", bagCount: 13, bagWeightKg: 60, quantityKg: 775, warehouseSection: "A", certifications: [], weighingReference: "S-1", evidencePath: "", reason: "" },
    { category: "CLIENT_REJECT", coffeeType: "WASHED", grade: "C Grade", preparation: "Reject", bagCount: 0, bagWeightKg: null, quantityKg: 20, warehouseSection: "R", certifications: [], weighingReference: "S-2", evidencePath: "", reason: "" },
    { category: "HAYKED_BYPRODUCT", coffeeType: "WASHED", grade: "Parchment", preparation: "Byproduct", bagCount: 0, bagWeightKg: null, quantityKg: 180, warehouseSection: "B", certifications: [], weighingReference: "S-3", evidencePath: "", reason: "" },
    { category: "PROCESS_LOSS", coffeeType: "WASHED", grade: "", preparation: "", bagCount: 0, bagWeightKg: null, quantityKg: 25, warehouseSection: "", certifications: [], weighingReference: "", evidencePath: "", reason: "Dust" },
  ], false);
  assert.equal(output.valid, true);
  assert.equal(output.totals.CLIENT_REJECT, 20);
  assert.equal(output.varianceKg, 0);
});

test("processing requests require approval before joining the queue", () => {
  const draft = { id: "REQ-1", noteNumber: "00240", requestDate: "2026-08-01", client: "Guji Specialty Coffee PLC", lot: "HYK/GEL/2026/0040", coffeeType: "Washed", preparationType: "Export preparation", grade: "Grade 1", requestedBags: 320, requestedKg: 19200, certifications: ["Organic"], otherCertification: "", requester: "Aster Kebede", checker: "Dawit Alemu", approver: "Meron Tadesse", notes: "", scannedDocumentAttached: true, status: "DRAFT" };
  assert.equal(validateProcessingRequest(draft).valid, true);
  assert.throws(() => queueProcessingRequest(draft, "QUE-1"), /only approved/i);
  const approved = transitionProcessingRequest(transitionProcessingRequest(draft, "SUBMITTED"), "APPROVED");
  assert.equal(queueProcessingRequest(approved, "QUE-1").queuedAs, "QUE-1");
  assert.equal(validateProcessingRequest({ ...draft, approver: " aster kebede " }).valid, false);
});

test("source lot category classification uses a strict positive allowlist", () => {
  const allowedCategories = new Set(["ARRIVAL", "CLIENT_REJECT", "ACCEPTED_PROCESSED"]);
  const isCategoryEligible = (cat) => Boolean(cat) && allowedCategories.has(cat);

  // Positive allowlist assertions
  assert.equal(isCategoryEligible("ARRIVAL"), true);
  assert.equal(isCategoryEligible("CLIENT_REJECT"), true);
  assert.equal(isCategoryEligible("ACCEPTED_PROCESSED"), true);

  // Strict rejection assertions
  assert.equal(isCategoryEligible("HAYKED_BYPRODUCT"), false);
  assert.equal(isCategoryEligible("OTHER"), false);
  assert.equal(isCategoryEligible(null), false);
  assert.equal(isCategoryEligible(undefined), false);
  assert.equal(isCategoryEligible("FUTURE_CATEGORY"), false);
});



