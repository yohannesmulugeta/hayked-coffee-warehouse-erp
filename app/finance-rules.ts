export type StorageCategory = "NO_PROCESSING" | "WAITING_PROCESSING" | "PROCESSED_EXPORT" | "GRADE_IMPROVEMENT" | "REJECT" | "EMPTY_BAGS";

export function invoiceSnapshot(lines: Array<{ description: string; quantity: number; unitPrice: number }>, taxRate: number) {
  const items = lines.map((line) => ({ ...line, lineTotal: Math.round(line.quantity * line.unitPrice * 100) / 100 }));
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const tax = Math.round(subtotal * taxRate * 100) / 100;
  return { items, subtotal, tax, total: subtotal + tax };
}

export function allocatePayment(outstanding: number, amount: number) {
  if (amount <= 0) throw new Error("Payment allocation must be positive.");
  if (amount > outstanding) throw new Error("Payment allocation cannot exceed the invoice outstanding amount.");
  return Math.round((outstanding - amount) * 100) / 100;
}

export function paymentPostAction(invoiceStatus: string) {
  const paid = invoiceStatus === "PAID";
  return {
    tab: paid ? "Client Accounts" : "Payments",
    resetFilters: paid,
    keepInvoiceFocused: !paid,
  } as const;
}

export function nextStorageRentStart(
  chargeStartOn: string,
  billedThroughOn: string | null,
) {
  if (!billedThroughOn) return chargeStartOn;
  const next = new Date(`${billedThroughOn}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function invoiceOutstanding(status: string, total: number, paid: number) {
  if (status === "DRAFT" || status === "VOID") return 0;
  return Math.max(0, Math.round((total - paid) * 100) / 100);
}

export function invoiceDisplayStatus(status: string, outstanding: number) {
  if (status === "DRAFT" || status === "VOID") return status;
  return outstanding === 0 ? "PAID" : status;
}

export function invoiceActivityDate(
  status: string,
  issuedOn: string | null,
  createdAt: string,
) {
  return status === "DRAFT" ? createdAt : issuedOn;
}
