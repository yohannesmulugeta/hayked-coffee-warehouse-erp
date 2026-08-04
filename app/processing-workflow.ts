export type CoffeeProcessingType = "Washed" | "Unwashed / UG";

export type ProcessingRequestStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
export type ProcessingCertification = "Organic" | "RFA" | "C.A.F.E" | "Non-certified" | "Fairtrade" | "Other";

export type ProcessingRequest = {
  id: string;
  requestNumber?: string;
  clientDatabaseId?: string;
  lotDatabaseId?: string;
  receiptDatabaseId?: string;
  noteNumber: string;
  requestDate: string;
  client: string;
  lot: string;
  coffeeType: CoffeeProcessingType;
  preparationType: string;
  grade: string;
  requestedBags: number;
  requestedKg: number;
  certifications: ProcessingCertification[];
  otherCertification: string;
  requester: string;
  checker: string;
  approver: string;
  notes: string;
  scannedDocumentAttached: boolean;
  status: ProcessingRequestStatus;
  queuedAs?: string;
};

export type ProcessingRequestLine = {
  id?: string;
  lineNumber?: number;
  lotDatabaseId: string;
  lot: string;
  coffeeType: CoffeeProcessingType;
  preparationType: string;
  grade: string;
  requestedBags: number;
  requestedKg: number;
  certifications: ProcessingCertification[];
  specialInstruction: string;
  remark: string;
};

export type ProcessingOutputCategory = "ACCEPTED_CLIENT_COFFEE" | "CLIENT_REJECT" | "HAYKED_BYPRODUCT" | "REWORK" | "PROCESS_LOSS";

export type ProcessingOutputLine = {
  id?: string;
  lineNumber?: number;
  category: ProcessingOutputCategory;
  coffeeType: "WASHED" | "UNWASHED_UG";
  grade: string;
  preparation: string;
  bagCount: number;
  bagWeightKg: number | null;
  quantityKg: number;
  warehouseSection: string;
  certifications: ProcessingCertification[];
  weighingReference: string;
  evidencePath: string;
  reason: string;
};

export function validateProcessingRequest(request: ProcessingRequest) {
  const errors: string[] = [];
  if (!request.noteNumber.trim()) errors.push("Request note number is required.");
  if (!request.client.trim()) errors.push("Client is required.");
  if (!request.lot.trim()) errors.push("Warehouse receipt or lot number is required.");
  if (request.requestedKg <= 0) errors.push("Requested kg must be positive.");
  if (request.requestedBags <= 0) errors.push("Requested bags must be positive.");
  if (request.requester.trim() && request.approver.trim() && request.requester.trim().toLowerCase() === request.approver.trim().toLowerCase()) errors.push("Approver cannot be the same as requester.");
  return { valid: errors.length === 0, errors };
}

export function validateProcessingRequestLines(lines: ProcessingRequestLine[]) {
  const errors: string[] = [];
  if (!lines.length) errors.push("At least one coffee lot is required.");
  if (new Set(lines.map((line) => line.lotDatabaseId)).size !== lines.length) errors.push("A source lot can only appear once.");
  lines.forEach((line, index) => {
    if (!line.lotDatabaseId) errors.push(`Line ${index + 1}: select a source lot.`);
    if (!line.preparationType.trim()) errors.push(`Line ${index + 1}: preparation is required.`);
    if (line.requestedBags <= 0) errors.push(`Line ${index + 1}: requested bags must be positive.`);
    if (line.requestedKg <= 0) errors.push(`Line ${index + 1}: requested kg must be positive.`);
  });
  return { valid: errors.length === 0, errors };
}

export function evaluateOutputCompletion(inputKg: number, coffeeType: CoffeeProcessingType, lines: ProcessingOutputLine[], exceptionApproved: boolean) {
  const totals = Object.fromEntries((["ACCEPTED_CLIENT_COFFEE", "CLIENT_REJECT", "HAYKED_BYPRODUCT", "REWORK", "PROCESS_LOSS"] as ProcessingOutputCategory[]).map((category) => [category, 0])) as Record<ProcessingOutputCategory, number>;
  const errors: string[] = [];
  lines.forEach((line, index) => {
    if (line.quantityKg <= 0) errors.push(`Output line ${index + 1}: quantity must be positive.`);
    if (line.category !== "PROCESS_LOSS" && (!line.warehouseSection.trim() || !line.weighingReference.trim())) errors.push(`Output line ${index + 1}: section and weighing reference are required.`);
    if (line.category === "PROCESS_LOSS" && !line.reason.trim()) errors.push(`Output line ${index + 1}: loss reason is required.`);
    totals[line.category] += Math.max(0, line.quantityKg);
  });
  const outputKg = Object.values(totals).reduce((sum, value) => sum + value, 0);
  const varianceKg = inputKg - outputKg;
  const allowedPercent = coffeeType === "Washed" ? 22.5 : 2.5;
  const allowanceWeightKg = coffeeType === "Washed" ? totals.HAYKED_BYPRODUCT + totals.PROCESS_LOSS : totals.PROCESS_LOSS;
  const actualPercent = inputKg > 0 ? allowanceWeightKg / inputKg * 100 : 0;
  const aboveAllowance = actualPercent > allowedPercent + 0.0001;
  if (!lines.length) errors.push("At least one output line is required.");
  if (Math.abs(varianceKg) > 0.01) errors.push("Input and outputs must reconcile within 0.01 kg.");
  if (coffeeType === "Unwashed / UG" && totals.HAYKED_BYPRODUCT > 0 && !exceptionApproved) errors.push("Unwashed byproduct requires an approved rule.");
  if (aboveAllowance && !exceptionApproved) errors.push("Above-allowance completion requires independent approval.");
  return { totals, outputKg, varianceKg, allowedPercent, actualPercent, aboveAllowance, valid: errors.length === 0, errors };
}

export function transitionProcessingRequest(request: ProcessingRequest, status: ProcessingRequestStatus) {
  const allowed: Record<ProcessingRequestStatus, ProcessingRequestStatus[]> = {
    DRAFT: ["SUBMITTED"],
    SUBMITTED: ["APPROVED", "REJECTED"],
    APPROVED: [],
    REJECTED: [],
  };
  if (!allowed[request.status].includes(status)) throw new Error(`Processing request cannot move from ${request.status} to ${status}.`);
  const validation = validateProcessingRequest(request);
  if (!validation.valid) throw new Error(validation.errors[0]);
  return { ...request, status };
}

export function queueProcessingRequest(request: ProcessingRequest, queueId: string) {
  if (request.status !== "APPROVED") throw new Error("Only approved processing requests can be added to the queue.");
  if (request.queuedAs) throw new Error("This processing request is already queued.");
  return { ...request, queuedAs: queueId };
}

export type ProcessingCompletion = {
  coffeeType: CoffeeProcessingType;
  inputKg: number;
  acceptedKg: number;
  rejectsKg: Record<string, number>;
  byproductKg: number;
  processLossKg: number;
  weighingEvidence: boolean;
  exceptionApproved: boolean;
  unwashedByproductApproved?: boolean;
};

export function evaluateCompletion(completion: ProcessingCompletion) {
  const rejectsKg = Object.values(completion.rejectsKg).reduce((sum, value) => sum + value, 0);
  const outputKg = completion.acceptedKg + rejectsKg + completion.byproductKg + completion.processLossKg;
  const varianceKg = completion.inputKg - outputKg;
  const allowedPercent = completion.coffeeType === "Washed" ? 22.5 : 2.5;
  const allowanceWeightKg = completion.coffeeType === "Washed"
    ? completion.byproductKg + completion.processLossKg
    : completion.processLossKg;
  const actualPercent = completion.inputKg > 0 ? allowanceWeightKg / completion.inputKg * 100 : 0;
  const aboveAllowance = actualPercent > allowedPercent + 0.0001;
  const errors: string[] = [];

  if (completion.inputKg <= 0) errors.push("Processing input must be positive.");
  if ([completion.acceptedKg, completion.byproductKg, completion.processLossKg, ...Object.values(completion.rejectsKg)].some((value) => value < 0)) errors.push("Output quantities cannot be negative.");
  if (Math.abs(varianceKg) > 0.01) errors.push("Input and outputs must reconcile within 0.01 kg.");
  if (completion.coffeeType === "Unwashed / UG" && completion.byproductKg > 0 && !completion.unwashedByproductApproved) errors.push("Unwashed byproduct requires an effective approved rule.");
  if (aboveAllowance && !completion.exceptionApproved) errors.push("Above-allowance completion requires independent approval.");
  if (!completion.weighingEvidence) errors.push("Weighing evidence is required.");

  return {
    rejectsKg,
    outputKg,
    varianceKg,
    allowedPercent,
    actualPercent,
    aboveAllowance,
    yieldPercent: completion.inputKg > 0 ? completion.acceptedKg / completion.inputKg * 100 : 0,
    valid: errors.length === 0,
    errors,
  };
}
