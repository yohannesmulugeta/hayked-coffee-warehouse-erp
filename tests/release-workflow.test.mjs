import assert from "node:assert/strict";
import test from "node:test";
import { evaluateEcsReceipt, evaluateOwnershipTransfer, evaluateRelease } from "../app/release-workflow.ts";

test("release, ECS, and ownership controls block unsafe transactions", () => {
  const release = evaluateRelease({ availableKg: 18600, requestedKg: 18600, agreementActive: true, representativeValid: true, documentsReady: true, invoicesPaid: false, creditApproved: false, legalOrQualityHold: false, dispatchApproved: true, preparedBy: "Clerk", approvedBy: "Manager", weighbridgeReady: true });
  assert.equal(release.ready, false);
  assert.match(release.errors.join(" "), /credit approval/i);

  assert.equal(evaluateEcsReceipt({ sentKg: 12000, receivedKg: 12000, alreadyReceived: true, varianceApproved: false }).valid, false);

  const transfer = evaluateOwnershipTransfer({ sourceKg: 19200, transferKg: 6000, signedInstruction: true, sourceApproved: true, destinationAccepted: true, haykedApproved: true, hasHold: false });
  assert.equal(transfer.valid, true);
  assert.equal(transfer.sourceRemainingKg + transfer.destinationKg, transfer.physicalTotalKg);
});
