export const coreViews = ["Clients", "Agreements", "Representatives", "Warehouse Receipts", "Coffee Lots"];

export const warehouseControlViews = [
  "Storage Loss",
  "Bag Control",
  "Labour",
  "Generator Requests",
];

export const dispatchViews = ["Dispatch", "Ownership Transfers"];
export const financeViews = ["Finance"];
export const managementViews = [
  "Arrears Cases",
  "Reports",
  "Documents",
  "Approvals",
  "Audit History",
  "Administration",
];

export function isImplementedView(view: string) {
  return view === "Dashboard"
    || view === "Processing"
    || coreViews.includes(view)
    || warehouseControlViews.includes(view)
    || dispatchViews.includes(view)
    || financeViews.includes(view)
    || managementViews.includes(view);
}
