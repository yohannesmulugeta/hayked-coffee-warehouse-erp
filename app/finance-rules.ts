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
