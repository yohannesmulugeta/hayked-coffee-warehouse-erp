export type ReceiptStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "POSTED" | "REVERSED";

export type WarehouseReceipt = {
  databaseId?: string;
  clientDatabaseId?: string;
  agreementDatabaseId?: string;
  representativeDatabaseId?: string;
  id: string;
  client: string;
  agreement: string;
  representative: string;
  receivedAt: string;
  warehouse: string;
  section: string;
  truckPlate: string;
  driverName: string;
  sealNumber: string;
  weighbridgeRef: string;
  origin: string;
  coffeeType: "Washed" | "Unwashed / UG";
  grade: string;
  cropYear: number;
  bags: number;
  bagWeightKg: number;
  grossWeightKg: number;
  tareWeightKg: number;
  netWeightKg: number;
  moisturePercent: number;
  wetCoffee: boolean;
  receivedBy: string;
  createdBy: string;
  status: ReceiptStatus;
  lotNumber?: string;
};

export type CoffeeLot = {
  databaseId?: string;
  lotNumber: string;
  sourceGrn: string;
  client: string;
  coffee: string;
  grade: string;
  section: string;
  bags: number;
  weightKg: number;
  status: "ARRIVAL_IN_STORAGE" | "WAITING_PROCESSING" | "IN_PROCESS" | "PROCESSED" | "AWAITING_DISPATCH" | "IN_TRANSIT" | "DISPATCHED" | "CLOSED" | "REVERSED";
  lotCategory?: "ARRIVAL" | "CLIENT_REJECT" | "ACCEPTED_PROCESSED" | "HAYKED_BYPRODUCT" | "OTHER" | null;
  ownershipType?: "CLIENT" | "HAYKED";
};

export type StockMovement = {
  databaseId?: string;
  id: string;
  sourceGrn: string;
  lotNumber: string;
  type: "RECEIPT" | "PROCESS_INPUT" | "PROCESS_OUTPUT" | "STORAGE_LOSS" | "DISPATCH" | "ECS_SEND" | "ECS_RECEIVE" | "OWNERSHIP_OUT" | "OWNERSHIP_IN" | "REVERSAL" | "ADJUSTMENT";
  bagsDelta: number;
  weightDeltaKg: number;
};

const nextStatus: Partial<Record<ReceiptStatus, ReceiptStatus>> = {
  DRAFT: "SUBMITTED",
  SUBMITTED: "APPROVED",
};

export function validateReceipt(receipt: WarehouseReceipt) {
  const errors: string[] = [];
  if (!receipt.client || !receipt.agreement || !receipt.representative) errors.push("Client, active agreement, and representative are required.");
  if (receipt.bags <= 0 || receipt.bagWeightKg <= 0) errors.push("Bags and bag weight must be positive.");
  if (receipt.grossWeightKg <= 0 || receipt.tareWeightKg < 0 || receipt.netWeightKg <= 0) errors.push("Weights must produce a positive net weight.");
  if (Math.abs(receipt.grossWeightKg - receipt.tareWeightKg - receipt.netWeightKg) > 0.01) errors.push("Net weight must equal gross weight minus tare weight.");
  return errors;
}

export function advanceReceipt(receipt: WarehouseReceipt): WarehouseReceipt {
  const status = nextStatus[receipt.status];
  if (!status) throw new Error("This receipt cannot move to another approval status.");
  const errors = validateReceipt(receipt);
  if (errors.length) throw new Error(errors[0]);
  return { ...receipt, status };
}

export function postReceipt(receipt: WarehouseReceipt, lotNumber: string, existingLots: CoffeeLot[]) {
  if (receipt.status !== "APPROVED") throw new Error("Only an approved receipt can be posted.");
  if (existingLots.some((lot) => lot.sourceGrn === receipt.id)) throw new Error("This GRN has already created a stock lot.");
  const errors = validateReceipt(receipt);
  if (errors.length) throw new Error(errors[0]);

  const lot: CoffeeLot = {
    lotNumber,
    sourceGrn: receipt.id,
    client: receipt.client,
    coffee: `${receipt.coffeeType} ${receipt.origin}`,
    grade: receipt.grade,
    section: receipt.section,
    bags: receipt.bags,
    weightKg: receipt.netWeightKg,
    status: "ARRIVAL_IN_STORAGE",
    lotCategory: "ARRIVAL",
    ownershipType: "CLIENT",
  };
  const movement: StockMovement = {
    id: `MOV-${receipt.id}`,
    sourceGrn: receipt.id,
    lotNumber,
    type: "RECEIPT",
    bagsDelta: receipt.bags,
    weightDeltaKg: receipt.netWeightKg,
  };
  return { receipt: { ...receipt, status: "POSTED" as const, lotNumber }, lot, movement };
}

export function reverseReceipt(receipt: WarehouseReceipt, lot: CoffeeLot, reason: string) {
  if (receipt.status !== "POSTED") throw new Error("Only a posted receipt can be reversed.");
  if (!reason.trim()) throw new Error("A reversal reason is required.");
  return {
    receipt: { ...receipt, status: "REVERSED" as const },
    lot: { ...lot, bags: 0, weightKg: 0, status: "REVERSED" as const },
    movement: {
      id: `REV-${receipt.id}`,
      sourceGrn: receipt.id,
      lotNumber: lot.lotNumber,
      type: "REVERSAL" as const,
      bagsDelta: -lot.bags,
      weightDeltaKg: -lot.weightKg,
    },
  };
}
