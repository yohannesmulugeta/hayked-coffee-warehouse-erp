import type { CoffeeLot } from "./grn-workflow";

export type StockTypeFilter = "All" | "Arrival" | "Processed" | "Reject" | "Hayked Byproduct";
export type StockStatusFilter = "All" | "Available" | "Waiting Processing" | "In Processing" | "Awaiting Dispatch" | "Reserved" | "Closed" | "Reversed";
export type ProcessingStateFilter = "All" | "Waiting Approval" | "Ready to Start" | "In Progress" | "Completed";

export function lotTypeLabel(lot: Pick<CoffeeLot, "lotCategory" | "ownershipType" | "sourceGrn">): Exclude<StockTypeFilter, "All"> | "Other" {
  if (lot.lotCategory === "ARRIVAL") return "Arrival";
  if (lot.lotCategory === "ACCEPTED_PROCESSED") return "Processed";
  if (lot.lotCategory === "CLIENT_REJECT") return "Reject";
  if (lot.lotCategory === "HAYKED_BYPRODUCT" || lot.ownershipType === "HAYKED") return "Hayked Byproduct";
  return lot.sourceGrn === "Derived lot" ? "Processed" : "Other";
}

export function lotStatusLabel(status: CoffeeLot["status"]): Exclude<StockStatusFilter, "All"> {
  const labels: Record<CoffeeLot["status"], Exclude<StockStatusFilter, "All">> = {
    ARRIVAL_IN_STORAGE: "Available",
    WAITING_PROCESSING: "Waiting Processing",
    IN_PROCESS: "In Processing",
    PROCESSED: "Available",
    AWAITING_DISPATCH: "Awaiting Dispatch",
    IN_TRANSIT: "Reserved",
    DISPATCHED: "Closed",
    CLOSED: "Closed",
    REVERSED: "Reversed",
  };
  return labels[status];
}

export function stockMatches(lot: CoffeeLot, type: StockTypeFilter, status: StockStatusFilter, client: string, search: string) {
  if (type !== "All" && lotTypeLabel(lot) !== type) return false;
  if (status !== "All" && lotStatusLabel(lot.status) !== status) return false;
  if (client !== "All" && lot.client !== client) return false;
  const needle = search.trim().toLowerCase();
  return !needle || [lot.lotNumber, lot.client, lot.coffee, lot.grade, lot.section, lot.sourceGrn].some((value) => value.toLowerCase().includes(needle));
}

export function notificationTarget(label: string) {
  if (/approval/i.test(label)) return { view: "Approvals" };
  if (/agreement/i.test(label)) return { view: "Agreements" };
  if (/processing|allowance/i.test(label)) return { view: "Processing", processingState: "Waiting Approval" as ProcessingStateFilter };
  if (/invoice|unpaid/i.test(label)) return { view: "Finance" };
  if (/dispatch/i.test(label)) return { view: "Dispatch" };
  return { view: "Dashboard" };
}

export function daysOverdue(dueOn: string | null, today = new Date()) {
  if (!dueOn) return 0;
  const due = new Date(`${dueOn}T00:00:00Z`);
  const now = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return Math.max(0, Math.floor((now.getTime() - due.getTime()) / 86400000));
}
