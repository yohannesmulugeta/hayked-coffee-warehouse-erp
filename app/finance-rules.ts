export type StorageCategory = "NO_PROCESSING" | "WAITING_PROCESSING" | "PROCESSED_EXPORT" | "GRADE_IMPROVEMENT" | "REJECT" | "EMPTY_BAGS";
export type StorageMovement = { date: string; bagsDelta: number; reference: string };

function dateValue(value: string) { return new Date(`${value}T12:00:00Z`); }
function isoDay(value: Date) { return value.toISOString().slice(0, 10); }
function ageDays(received: string, day: string) { return Math.round((dateValue(day).getTime() - dateValue(received).getTime()) / 86400000) + 1; }

export function storageRate(category: StorageCategory, ageDay: number, certified = false) {
  if (category === "NO_PROCESSING") return ageDay <= 90 ? 5 : 7;
  if (category === "WAITING_PROCESSING") return ageDay <= 20 ? 0 : ageDay <= 90 ? 2.75 : 3.5;
  if (category === "PROCESSED_EXPORT" || category === "GRADE_IMPROVEMENT") {
    const freeDays = category === "PROCESSED_EXPORT" ? 15 : 5;
    return ageDay <= freeDays ? 0 : ageDay <= 90 ? 3 : certified ? 6 : 5;
  }
  if (category === "REJECT") return ageDay <= 10 ? 0 : ageDay <= 30 ? 4 : 6;
  return ageDay <= 10 ? 0 : ageDay <= 40 ? 4 : 5;
}

export function calculateStorage(input: { client: string; lot: string; category: StorageCategory; receivedDate: string; periodStart: string; periodEnd: string; certified?: boolean; tariffVersion: string; movements: StorageMovement[] }) {
  const rows: Array<{ date: string; openingBags: number; movementBags: number; closingBags: number; ageDay: number; rate: number; units: number; amount: number; references: string[] }> = [];
  let balance = 0;
  for (let day = dateValue(input.receivedDate); day <= dateValue(input.periodEnd); day = new Date(day.getTime() + 86400000)) {
    const date = isoDay(day);
    const openingBags = balance;
    const daily = input.movements.filter((movement) => movement.date === date);
    const movementBags = daily.reduce((sum, movement) => sum + movement.bagsDelta, 0);
    balance += movementBags;
    if (balance < 0) throw new Error("Storage movements cannot create a negative bag balance.");
    if (date < input.periodStart) continue;
    const ageDay = ageDays(input.receivedDate, date);
    const rate = storageRate(input.category, ageDay, input.certified);
    const units = input.category === "EMPTY_BAGS" ? balance / 50 : balance;
    rows.push({ date, openingBags, movementBags, closingBags: balance, ageDay, rate, units, amount: Math.round(units * rate * 100) / 100, references: daily.map((movement) => movement.reference) });
  }
  const billableRows = rows.filter((row) => row.rate > 0 && row.closingBags > 0);
  return {
    rows,
    billableBagDays: billableRows.reduce((sum, row) => sum + row.units, 0),
    amount: Math.round(billableRows.reduce((sum, row) => sum + row.amount, 0) * 100) / 100,
    duplicateKey: [input.client, input.lot, input.category, input.periodStart, input.periodEnd, input.tariffVersion].join("|"),
  };
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
