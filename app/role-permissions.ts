export const appRoles = [
  "system_admin",
  "warehouse_manager",
  "warehouse_officer",
  "processing_supervisor",
  "finance_officer",
  "auditor",
  "viewer",
] as const;

export type AppRole = (typeof appRoles)[number];

const viewAccess: Record<AppRole, ReadonlySet<string>> = {
  system_admin: new Set(["*"]),
  warehouse_manager: new Set([
    "Dashboard", "Clients", "Warehouse Receipts", "Coffee Lots", "Processing",
    "Dispatch", "Labour", "Finance", "Reports", "Approvals", "Agreements",
    "Representatives", "Storage Loss", "Ownership Transfers", "Bag Control",
    "Generator Requests", "Documents", "Audit History", "Arrears Cases",
  ]),
  warehouse_officer: new Set([
    "Dashboard", "Clients", "Warehouse Receipts", "Coffee Lots", "Processing",
    "Dispatch", "Labour", "Reports", "Representatives", "Storage Loss",
    "Ownership Transfers", "Bag Control", "Generator Requests", "Documents",
  ]),
  processing_supervisor: new Set([
    "Dashboard", "Clients", "Coffee Lots", "Processing", "Labour", "Reports",
    "Approvals", "Storage Loss", "Generator Requests", "Documents",
  ]),
  finance_officer: new Set([
    "Dashboard", "Clients", "Coffee Lots", "Finance", "Reports", "Approvals",
    "Agreements", "Documents", "Audit History", "Arrears Cases",
  ]),
  auditor: new Set([
    "Dashboard", "Clients", "Coffee Lots", "Reports", "Agreements", "Documents",
    "Audit History", "Arrears Cases",
  ]),
  viewer: new Set(["Dashboard", "Clients", "Coffee Lots", "Reports", "Documents"]),
};

export function normalizeAppRole(role: string): AppRole {
  return appRoles.includes(role as AppRole) ? role as AppRole : "viewer";
}

export function canAccessView(role: string, view: string) {
  const allowed = viewAccess[normalizeAppRole(role)];
  return allowed.has("*") || allowed.has(view);
}

export function canManageCoreMasterData(role: string) {
  return ["system_admin", "warehouse_manager"].includes(normalizeAppRole(role));
}

export type ProcessingAction = "create" | "approve" | "queue" | "start" | "complete";

const processingActionAccess: Record<string, ReadonlySet<ProcessingAction>> = {
  system_admin: new Set(["create", "approve", "queue", "start", "complete"]),
  warehouse_manager: new Set(["create", "approve", "queue", "start", "complete"]),
  processing_supervisor: new Set(["create", "approve", "queue", "start", "complete"]),
};

export function canPerformProcessingAction(role: string, action: ProcessingAction) {
  return processingActionAccess[normalizeAppRole(role)]?.has(action) ?? false;
}
