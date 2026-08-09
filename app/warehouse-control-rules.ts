export function evaluateStorageLoss(input: { balanceKg: number; lossKg: number; evidence: boolean; managerApproved: boolean; exceptionApproved: boolean; wetCoffee: boolean; jointApprovalAttached: boolean }) {
  const percent = input.balanceKg > 0 ? input.lossKg / input.balanceKg * 100 : 0;
  const aboveLimit = percent > 1.5 + 0.0001;
  const errors: string[] = [];
  if (input.balanceKg <= 0 || input.lossKg <= 0 || input.lossKg > input.balanceKg) errors.push("Loss must be positive and cannot exceed the measured balance.");
  if (!input.evidence) errors.push("Measurement evidence is required.");
  if (!input.managerApproved) errors.push("Warehouse manager approval is required.");
  if (aboveLimit && !input.exceptionApproved) errors.push("Loss above 1.5% requires independent exception approval.");
  if (aboveLimit && input.wetCoffee && !input.jointApprovalAttached) errors.push("Wet-coffee exception requires written joint approval.");
  return { percent, aboveLimit, valid: errors.length === 0, errors };
}

export function bagPrintingQuote(quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 50) return { valid: false, rate: 0, total: 0 };
  const rate = quantity >= 160 ? 43.48 : quantity >= 100 ? 55.65 : 69.57;
  return { valid: true, rate, total: Math.round(quantity * rate * 100) / 100 };
}

export function generatorActualCost(dieselLitres: number, unitCost: number) {
  if (dieselLitres <= 0 || unitCost <= 0) return 0;
  return Math.round(dieselLitres * unitCost * 100) / 100;
}

export function calculateLabourCharge(internalCostEtb: number, fixedAdditionEtb: number) {
  if (internalCostEtb < 0 || fixedAdditionEtb < 0) return { valid: false, clientChargeEtb: 0 };
  return {
    valid: true,
    clientChargeEtb: Math.round((internalCostEtb + fixedAdditionEtb) * 100) / 100,
  };
}
