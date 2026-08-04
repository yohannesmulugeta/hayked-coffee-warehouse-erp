export type ArrearsStage = "MONITORING" | "PAYMENT_REMINDER" | "FORMAL_NOTICE" | "MANAGEMENT_REVIEW" | "LEGAL_REVIEW" | "AGREED_SETTLEMENT" | "CLOSED";

const nextStage: Partial<Record<ArrearsStage, ArrearsStage>> = {
  MONITORING: "PAYMENT_REMINDER",
  PAYMENT_REMINDER: "FORMAL_NOTICE",
  FORMAL_NOTICE: "MANAGEMENT_REVIEW",
  MANAGEMENT_REVIEW: "LEGAL_REVIEW",
  LEGAL_REVIEW: "AGREED_SETTLEMENT",
  AGREED_SETTLEMENT: "CLOSED",
};

export function nextArrearsStage(stage: ArrearsStage) {
  return nextStage[stage] ?? null;
}

export function advanceArrearsCase(current: ArrearsStage, target: ArrearsStage) {
  if (nextArrearsStage(current) !== target) throw new Error(`Arrears case cannot move from ${current} to ${target}.`);
  return { stage: target, stockMovement: null } as const;
}

export function approveRequest(requestedBy: string, approvedBy: string) {
  if (!approvedBy.trim()) throw new Error("An approver is required.");
  if (requestedBy.trim().toLowerCase() === approvedBy.trim().toLowerCase()) throw new Error("The requester cannot approve their own request.");
  return { status: "APPROVED" as const, approvedBy };
}

export type AuditEntry = { id: string; at: string; actor: string; action: string; reference: string };

export function appendAudit(log: readonly AuditEntry[], entry: AuditEntry) {
  if (log.some((item) => item.id === entry.id)) throw new Error("Audit event already exists.");
  return [...log, entry];
}
