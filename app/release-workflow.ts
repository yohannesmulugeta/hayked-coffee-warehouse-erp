export type ReleaseReadiness = {
  availableKg: number;
  requestedKg: number;
  agreementActive: boolean;
  representativeValid: boolean;
  documentsReady: boolean;
  invoicesPaid: boolean;
  creditApproved: boolean;
  legalOrQualityHold: boolean;
  dispatchApproved: boolean;
  preparedBy: string;
  approvedBy: string;
  weighbridgeReady: boolean;
};

export function evaluateRelease(input: ReleaseReadiness) {
  const errors: string[] = [];
  if (input.requestedKg <= 0 || input.requestedKg > input.availableKg) errors.push("Requested dispatch exceeds available unreserved stock.");
  if (!input.agreementActive) errors.push("An active client agreement is required.");
  if (!input.representativeValid) errors.push("An authorized representative is required.");
  if (!input.documentsReady) errors.push("Required certificates and documents are incomplete.");
  if (!input.invoicesPaid && !input.creditApproved) errors.push("Unpaid release requires a valid credit approval.");
  if (input.legalOrQualityHold) errors.push("A legal or quality hold blocks release.");
  if (!input.dispatchApproved) errors.push("Dispatch approval is required.");
  if (input.preparedBy === input.approvedBy) errors.push("The preparer cannot approve their own dispatch.");
  if (!input.weighbridgeReady) errors.push("Weighbridge readiness is required.");
  return { ready: errors.length === 0, errors };
}

export function evaluateEcsReceipt(input: { sentKg: number; receivedKg: number; alreadyReceived: boolean; varianceApproved: boolean }) {
  const varianceKg = input.receivedKg - input.sentKg;
  const errors: string[] = [];
  if (input.sentKg <= 0 || input.receivedKg <= 0) errors.push("ECX quantities must be positive.");
  if (input.alreadyReceived) errors.push("The destination receipt has already been posted.");
  if (Math.abs(varianceKg) > 0.01 && !input.varianceApproved) errors.push("Quantity differences require explanation and approval.");
  return { valid: errors.length === 0, varianceKg, errors };
}

export function evaluateOwnershipTransfer(input: { sourceKg: number; transferKg: number; signedInstruction: boolean; sourceApproved: boolean; destinationAccepted: boolean; haykedApproved: boolean; hasHold: boolean }) {
  const errors: string[] = [];
  if (input.transferKg <= 0 || input.transferKg > input.sourceKg) errors.push("Transfer quantity exceeds available source stock.");
  if (!input.signedInstruction) errors.push("A signed transfer instruction is required.");
  if (!input.sourceApproved) errors.push("Source-client approval is required.");
  if (!input.destinationAccepted) errors.push("Destination-client acceptance is required.");
  if (!input.haykedApproved) errors.push("Independent Hayked approval is required.");
  if (input.hasHold) errors.push("An unpaid-release or legal hold blocks ownership transfer.");
  return { valid: errors.length === 0, sourceRemainingKg: input.sourceKg - input.transferKg, destinationKg: input.transferKg, physicalTotalKg: input.sourceKg, errors };
}
