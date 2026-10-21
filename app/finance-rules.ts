export type StorageCategory = "NO_PROCESSING" | "WAITING_PROCESSING" | "PROCESSED_EXPORT" | "GRADE_IMPROVEMENT" | "REJECT" | "EMPTY_BAGS";

/** Warehouse business dates must not change with the operator's browser timezone. */
export function billingDate(offsetDays = 0, now = new Date()) {
  const local = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  local.setUTCDate(local.getUTCDate() + offsetDays);
  return local.toISOString().slice(0, 10);
}

export function billingAccountStatus(outstanding: number, draft: number, unbilled: number, rentPending: boolean) {
  if (outstanding > 0) return "OUTSTANDING";
  if (draft > 0) return "DRAFT_PENDING";
  if (unbilled > 0) return "UNBILLED_WORK";
  if (rentPending) return "RENT_REVIEW";
  return "CLEAR";
}

export function serviceAgreementVersion(data: {
  processingOrders: {id: string; lot_id: string}[];
  lots: {id: string; receipt_id: string | null}[];
  receipts: {id: string; agreement_id: string}[];
  rentOverview: {lotId: string; tariffVersion: string | null}[];
  agreements: {id: string; client_id: string; status: string; effective_from: string; effective_to: string | null; tariff_version: string}[];
}, clientId: string, date: string, orderId: string) {
  const order = data.processingOrders.find(o => o.id === orderId);
  if (order) {
    const lot = data.lots.find(l => l.id === order.lot_id);
    const receipt = data.receipts.find(r => r.id === lot?.receipt_id);
    return data.agreements.find(a => a.id === receipt?.agreement_id)?.tariff_version;
  }
  return [...data.agreements].filter(a => a.client_id === clientId && ["ACTIVE","EXPIRED"].includes(a.status)
    && a.effective_from <= date && (!a.effective_to || a.effective_to >= date))
    .sort((a,b) => b.effective_from.localeCompare(a.effective_from))[0]?.tariff_version;
}

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
