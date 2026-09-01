import { createSupabaseClient } from "./supabase/client";
import { activeOn, clientReadiness } from "@/app/client-onboarding";
import type { CoffeeLot, StockMovement, WarehouseReceipt } from "@/app/grn-workflow";
import type { ProcessingOutputLine, ProcessingRequest, ProcessingRequestLine } from "@/app/processing-workflow";
import { countLabel } from "./ui-format";

type DbError = { message: string; code?: string } | null;

export function friendlyDatabaseError(error: DbError, fallback = "The record could not be saved.") {
  if (!error) return fallback;
  if (error.code === "23505") return "This reference number already exists.";
  if (error.code === "PGRST116" || error.message.includes("Cannot coerce")) return "The selected record was not found. Refresh the page and select it again.";
  if (error.code === "42501" || /permission|policy|row-level security/i.test(error.message)) return "Your account does not have permission to perform this action.";
  if (/JWT|API key|not signed in/i.test(error.message)) return "Your session is not valid. Sign in again.";
  if (/already exists|valid .*date range|cannot start before|cannot start until ECX|does not belong|no independently verified (?:tariff|catalog rate)|has no rate|does not match the approved catalog rate|lacks .* evidence|rate is not yet approved|no billable storage charge/i.test(error.message)) return error.message;
  return fallback;
}

function result<T>(data: T | null, error: DbError): T {
  if (error) throw new Error(friendlyDatabaseError(error, "The database record could not be loaded."));
  if (data === null) throw new Error("The database returned no data.");
  return data;
}

async function currentUserId() {
  const { data, error } = await createSupabaseClient().auth.getUser();
  if (error || !data.user) throw new Error(error?.message ?? "You are not signed in.");
  return data.user.id;
}

export type ClientRow = { id: string; code: string; legal_name: string; tin: string | null; phone?: string | null; email?: string | null; active: boolean };
type AgreementRow = { id: string; client_id: string; agreement_number: string; effective_from: string; effective_to: string | null; tariff_version: string; default_bag_weight_kg: number; status: string };
type RepresentativeRow = { id: string; client_id: string; full_name: string; identity_number: string; phone: string | null; valid_from: string; valid_to: string | null; active: boolean };
type WarehouseRow = { id: string; name: string };
type ReceiptRow = {
  id: string; receipt_number: string; warehouse_id: string; client_id: string; agreement_id: string;
  representative_id: string | null; arrival_at: string; coffee_type: "WASHED" | "UNWASHED_UG";
  bag_count: number; net_weight_kg: number; vehicle_plate: string; status: WarehouseReceipt["status"];
  prepared_by: string; section: string; driver_name: string | null; seal_number: string | null;
  weighbridge_reference: string | null; origin: string | null; grade: string | null; crop_year: number | null;
  bag_weight_kg: number | null; gross_weight_kg: number | null; tare_weight_kg: number | null;
  moisture_percent: number | null; wet_coffee: boolean;
  certification_status: WarehouseReceipt["certificationStatus"];
  certification_schemes: string[];
  certificate_number: string | null;
  certification_issuer: string | null;
  certification_valid_from: string | null;
  certification_valid_to: string | null;
};
export type LotRow = { id: string; lot_number: string; receipt_id: string | null; warehouse_id?: string; client_id: string; coffee_type: "WASHED" | "UNWASHED_UG"; bag_count: number; quantity_kg: number; section: string; status: CoffeeLot["status"]; lot_category?: EligibleProcessingLot["lot_category"]; ownership_type?: "CLIENT" | "HAYKED"; parent_lot_id?: string | null; source_processing_order_id?: string | null; certification_status?: CoffeeLot["certificationStatus"]; certification_schemes?: string[]; certificate_number?: string | null; certification_issuer?: string | null; certification_valid_from?: string | null; certification_valid_to?: string | null };
type MovementRow = { id: string; lot_id: string; movement_type: StockMovement["type"]; quantity_kg: number; bag_delta: number; reference_type: string; reference_id: string };
export type ProfileRow = { id: string; full_name: string; role: string; active: boolean };

export type CoreClient = { id: string; code: string; name: string; tin: string; phone: string; email: string; active: boolean; agreement: string; stock: string; status: string };
export type CoreAgreement = { id: string; clientId: string; number: string; client: string; source: string; effective: string; effectiveFrom: string; expiry: string; effectiveTo: string | null; tariff: string; defaultBagWeightKg: number; status: string };
export type CoreRepresentative = { id: string; clientId: string; name: string; identityNumber: string; client: string; phone: string; scope: string; validFrom: string; expiry: string; validTo: string | null; status: string };

export type CoreData = {
  clients: CoreClient[];
  agreements: CoreAgreement[];
  representatives: CoreRepresentative[];
  warehouses: WarehouseRow[];
  receipts: WarehouseReceipt[];
  lots: CoffeeLot[];
  movements: StockMovement[];
  tariffs: { code: string; name: string; active: boolean }[];
};

export type GlobalSearchResult = { id: string; kind: "Client" | "Agreement" | "GRN" | "Lot" | "Processing" | "Dispatch" | "Invoice" | "Payment" | "Document"; title: string; context: string; view: string };

export type DashboardData = {
  metrics: { label: string; value: number; unit: string; detail: string }[];
  mini: { label: string; value: string; detail: string }[];
  movements: { day: string; received: number; dispatched: number }[];
  attention: { count: number; label: string; note: string; tone: "red" | "amber" }[];
  activities: string[][];
  pendingApprovals: number;
  searchIndex: GlobalSearchResult[];
};

export async function loadDashboardData(): Promise<DashboardData> {
  const db = createSupabaseClient();
  const [lotResult, orderResult, movementResult, approvalResult, agreementResult, invoiceResult, auditResult, profileResult, clientResult, receiptResult, dispatchResult, paymentResult, documentResult] = await Promise.all([
    db.from("coffee_lots").select("id,lot_number,client_id,lot_category,ownership_type,bag_count,quantity_kg,status"),
    db.from("processing_orders").select("id,order_number,client_id,status,input_kg"),
    db.from("stock_movements").select("movement_type,quantity_kg,occurred_at").order("occurred_at"),
    db.from("approvals").select("request_type,status"),
    db.from("agreements").select("id,agreement_number,client_id,status,effective_to"),
    db.from("invoices").select("id,invoice_number,client_id,status"),
    db.from("audit_events").select("action,reference_type,reference_id,event_data,occurred_at,actor_id").order("occurred_at", { ascending: false }).limit(8),
    db.from("profiles").select("id,full_name"),
    db.from("clients").select("id,code,legal_name"),
    db.from("warehouse_receipts").select("id,receipt_number,client_id,status"),
    db.from("dispatch_orders").select("id,dispatch_number,client_id,status"),
    db.from("payments").select("id,payment_number,client_id,bank_reference,direction"),
    db.from("documents").select("id,document_number,file_name,status"),
  ]);
  const lots = result(lotResult.data, lotResult.error) as { id: string; lot_number: string; client_id: string; lot_category: string | null; ownership_type: string; bag_count: number; quantity_kg: number; status: string }[];
  const orders = result(orderResult.data, orderResult.error) as { id: string; order_number: string; client_id: string; status: string; input_kg: number }[];
  const movements = result(movementResult.data, movementResult.error) as { movement_type: string; quantity_kg: number; occurred_at: string }[];
  const approvals = result(approvalResult.data, approvalResult.error) as { request_type: string; status: string }[];
  const agreements = result(agreementResult.data, agreementResult.error) as { id: string; agreement_number: string; client_id: string; status: string; effective_to: string | null }[];
  const invoices = result(invoiceResult.data, invoiceResult.error) as { id: string; invoice_number: string; client_id: string; status: string }[];
  const audits = result(auditResult.data, auditResult.error) as { action: string; reference_type: string; reference_id: string; event_data: Record<string, unknown>; occurred_at: string; actor_id: string }[];
  const profiles = result(profileResult.data, profileResult.error) as { id: string; full_name: string }[];
  const clients = result(clientResult.data, clientResult.error) as { id: string; code: string; legal_name: string }[];
  const receipts = result(receiptResult.data, receiptResult.error) as { id: string; receipt_number: string; client_id: string; status: string }[];
  const dispatches = result(dispatchResult.data, dispatchResult.error) as { id: string; dispatch_number: string; client_id: string; status: string }[];
  const payments = result(paymentResult.data, paymentResult.error) as { id: string; payment_number: string; client_id: string; bank_reference: string; direction: string }[];
  const documents = result(documentResult.data, documentResult.error) as { id: string; document_number: string; file_name: string; status: string }[];
  const activeLots = lots.filter((item) => Number(item.quantity_kg) > 0 && !["CLOSED", "DISPATCHED", "REVERSED"].includes(item.status));
  const metric = (filter: (lot: typeof activeLots[number]) => boolean) => {
    const rows = activeLots.filter(filter);
    return { kg: rows.reduce((sum, item) => sum + Number(item.quantity_kg), 0), bags: rows.reduce((sum, item) => sum + item.bag_count, 0) };
  };
  const total = metric(() => true);
  const arrival = metric((item) => item.lot_category === "ARRIVAL");
  const processed = metric((item) => ["ACCEPTED_PROCESSED", "HAYKED_BYPRODUCT"].includes(item.lot_category ?? ""));
  const rejects = metric((item) => item.lot_category === "CLIENT_REJECT");
  const latestMovementDate = movements.at(-1)?.occurred_at.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  const end = new Date(`${latestMovementDate}T00:00:00Z`);
  const movementDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - 6 + index);
    const key = date.toISOString().slice(0, 10);
    const rows = movements.filter((item) => item.occurred_at.slice(0, 10) === key);
    return {
      day: date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
      received: rows.filter((item) => ["RECEIPT", "ECS_RECEIVE"].includes(item.movement_type)).reduce((sum, item) => sum + Math.max(0, Number(item.quantity_kg)), 0),
      dispatched: Math.abs(rows.filter((item) => ["DISPATCH", "ECS_SEND"].includes(item.movement_type)).reduce((sum, item) => sum + Math.min(0, Number(item.quantity_kg)), 0)),
    };
  });
  const today = new Date();
  const inThirtyDays = new Date(today); inThirtyDays.setDate(today.getDate() + 30);
  const pendingApprovals = approvals.filter((item) => item.status === "PENDING").length;
  const profileById = new Map(profiles.map((item) => [item.id, item.full_name]));
  const clientById = new Map(clients.map((item) => [item.id, item.legal_name]));
  return {
    metrics: [
      { label: "Total Coffee in Warehouse", value: total.kg, unit: "kg", detail: `${total.bags.toLocaleString()} bags` },
      { label: "Arrival Coffee", value: arrival.kg, unit: "kg", detail: `${arrival.bags.toLocaleString()} bags` },
      { label: "Processed Coffee", value: processed.kg, unit: "kg", detail: `${processed.bags.toLocaleString()} bags` },
      { label: "Client Rejects", value: rejects.kg, unit: "kg", detail: `${rejects.bags.toLocaleString()} bags` },
    ],
    mini: [
      { label: "Coffee in Processing", value: `${orders.filter((item) => item.status === "IN_PROCESS").reduce((sum, item) => sum + Number(item.input_kg), 0).toLocaleString()} kg`, detail: `${countLabel(orders.filter((item) => item.status === "IN_PROCESS").length, "active order")}` },
      { label: "Waiting for Processing", value: countLabel(orders.filter((item) => item.status === "QUEUED").length, "order"), detail: `${orders.filter((item) => item.status === "QUEUED").reduce((sum, item) => sum + Number(item.input_kg), 0).toLocaleString()} kg queued` },
      { label: "Awaiting Dispatch", value: countLabel(activeLots.filter((item) => item.status === "AWAITING_DISPATCH").length, "lot"), detail: "Approved stock ready for release checks" },
      { label: "Hayked Byproducts", value: `${metric((item) => item.ownership_type === "HAYKED").kg.toLocaleString()} kg`, detail: "Separate ownership ledger" },
    ],
    movements: movementDays,
    attention: [
      { count: pendingApprovals, label: "Pending approvals", note: "Independent review queue", tone: "red" },
      { count: agreements.filter((item) => item.status === "ACTIVE" && item.effective_to && new Date(item.effective_to) >= today && new Date(item.effective_to) <= inThirtyDays).length, label: "Agreements expiring", note: "Within the next 30 days", tone: "amber" },
      { count: approvals.filter((item) => item.status === "PENDING" && item.request_type === "PROCESSING_EXCEPTION").length, label: "Processing exceptions", note: "Evidence and approval required", tone: "red" },
      { count: invoices.filter((item) => ["ISSUED", "PARTIALLY_PAID"].includes(item.status)).length, label: "Open invoices", note: "Release requires payment or credit", tone: "amber" },
    ],
    activities: audits.map((item) => [
      String(item.event_data?.business_reference ?? `${item.reference_type}-${item.reference_id.slice(0, 8)}`),
      profileById.get(item.actor_id) ?? "Unknown user",
      item.action.replaceAll("_", " "),
      new Date(item.occurred_at).toLocaleString(),
    ]),
    pendingApprovals,
    searchIndex: [
      ...clients.map((item) => ({ id: item.id, kind: "Client" as const, title: item.legal_name, context: item.code, view: "Clients" })),
      ...agreements.map((item) => ({ id: item.id, kind: "Agreement" as const, title: item.agreement_number, context: `${clientById.get(item.client_id) ?? "Unknown client"} - ${item.status.replaceAll("_", " ")}`, view: "Agreements" })),
      ...receipts.map((item) => ({ id: item.id, kind: "GRN" as const, title: item.receipt_number, context: `${clientById.get(item.client_id) ?? "Unknown client"} - ${item.status.replaceAll("_", " ")}`, view: "Warehouse Receipts" })),
      ...lots.map((item) => ({ id: item.id, kind: "Lot" as const, title: item.lot_number, context: `${clientById.get(item.client_id) ?? "Unknown client"} - ${item.status.replaceAll("_", " ")}`, view: "Coffee Lots" })),
      ...orders.map((item) => ({ id: item.id, kind: "Processing" as const, title: item.order_number, context: `${clientById.get(item.client_id) ?? "Unknown client"} - ${item.status.replaceAll("_", " ")}`, view: "Processing" })),
      ...dispatches.map((item) => ({ id: item.id, kind: "Dispatch" as const, title: item.dispatch_number, context: `${clientById.get(item.client_id) ?? "Unknown client"} - ${item.status.replaceAll("_", " ")}`, view: "Dispatch" })),
      ...invoices.map((item) => ({ id: item.id, kind: "Invoice" as const, title: item.invoice_number, context: `${clientById.get(item.client_id) ?? "Unknown client"} - ${item.status.replaceAll("_", " ")}`, view: "Finance" })),
      ...payments.map((item) => ({ id: item.id, kind: "Payment" as const, title: item.payment_number, context: `${clientById.get(item.client_id) ?? "Unknown client"} - ${item.bank_reference}`, view: "Finance" })),
      ...documents.map((item) => ({ id: item.id, kind: "Document" as const, title: item.document_number, context: `${item.file_name} - ${item.status.replaceAll("_", " ")}`, view: "Documents" })),
    ],
  };
}

export async function loadCoreData(): Promise<CoreData> {
  const db = createSupabaseClient();
  const [clientResult, agreementResult, representativeResult, warehouseResult, receiptResult, lotResult, movementResult, profileResult, tariffResult] = await Promise.all([
    db.from("clients").select("id,code,legal_name,tin,phone,email,active").order("code"),
    db.from("agreements").select("id,client_id,agreement_number,effective_from,effective_to,tariff_version,default_bag_weight_kg,status").order("agreement_number"),
    db.from("authorized_representatives").select("id,client_id,full_name,identity_number,phone,valid_from,valid_to,active").order("full_name"),
    db.from("warehouses").select("id,name").eq("active", true),
    db.from("warehouse_receipts").select("*").order("created_at", { ascending: false }),
    db.from("coffee_lots").select("id,lot_number,receipt_id,client_id,coffee_type,lot_category,ownership_type,bag_count,quantity_kg,section,status,certification_status,certification_schemes,certificate_number,certification_issuer,certification_valid_from,certification_valid_to").order("created_at", { ascending: false }),
    db.from("stock_movements").select("id,lot_id,movement_type,quantity_kg,bag_delta,reference_type,reference_id").order("occurred_at", { ascending: false }),
    db.from("profiles").select("id,full_name,role,active"),
    db.from("tariff_versions").select("version_code,description,active").order("effective_from", { ascending: false }),
  ]);
  const clients = result(clientResult.data as ClientRow[] | null, clientResult.error);
  const agreements = result(agreementResult.data as AgreementRow[] | null, agreementResult.error);
  const representatives = result(representativeResult.data as RepresentativeRow[] | null, representativeResult.error);
  const warehouses = result(warehouseResult.data as WarehouseRow[] | null, warehouseResult.error);
  const receipts = result(receiptResult.data as ReceiptRow[] | null, receiptResult.error);
  const lots = result(lotResult.data as LotRow[] | null, lotResult.error);
  const movements = result(movementResult.data as MovementRow[] | null, movementResult.error);
  const profiles = result(profileResult.data as ProfileRow[] | null, profileResult.error);
  const tariffs = result(tariffResult.data as { version_code: string; description: string | null; active: boolean }[] | null, tariffResult.error);
  const clientById = new Map(clients.map((item) => [item.id, item]));
  const agreementById = new Map(agreements.map((item) => [item.id, item]));
  const representativeById = new Map(representatives.map((item) => [item.id, item]));
  const warehouseById = new Map(warehouses.map((item) => [item.id, item]));
  const profileById = new Map(profiles.map((item) => [item.id, item]));
  const receiptById = new Map(receipts.map((item) => [item.id, item]));
  const lotById = new Map(lots.map((item) => [item.id, item]));
  const lotByReceipt = new Map(lots.filter((item) => item.receipt_id).map((item) => [item.receipt_id as string, item]));
  const stockByClient = new Map<string, number>();
  for (const movement of movements) {
    const lot = lotById.get(movement.lot_id);
    if (lot) stockByClient.set(lot.client_id, (stockByClient.get(lot.client_id) ?? 0) + Number(movement.quantity_kg));
  }
  const today = new Date().toISOString().slice(0, 10);
  const readyAgreementClients = new Set(agreements.filter((item) => activeOn(today, item.effective_from, item.effective_to, item.status === "ACTIVE")).map((item) => item.client_id));
  const readyRepresentativeClients = new Set(representatives.filter((item) => activeOn(today, item.valid_from, item.valid_to, item.active)).map((item) => item.client_id));

  return {
    clients: clients.map((item) => ({
      id: item.id, code: item.code, name: item.legal_name, tin: item.tin ?? "-", phone: item.phone ?? "-", email: item.email ?? "-", active: item.active,
      agreement: agreements.find((agreement) => agreement.client_id === item.id && agreement.status === "ACTIVE")?.agreement_number ?? "No active agreement",
      stock: `${(stockByClient.get(item.id) ?? 0).toLocaleString()} kg`,
      status: clientReadiness(item.active, readyAgreementClients.has(item.id), readyRepresentativeClients.has(item.id)),
    })),
    agreements: agreements.map((item) => ({
      id: item.id, clientId: item.client_id, number: item.agreement_number, client: clientById.get(item.client_id)?.legal_name ?? "Unknown client",
      source: "001/2018", effective: item.effective_from, effectiveFrom: item.effective_from, expiry: item.effective_to ?? "Open-ended",
      effectiveTo: item.effective_to, tariff: item.tariff_version, defaultBagWeightKg: Number(item.default_bag_weight_kg), status: item.status,
    })),
    representatives: representatives.map((item) => ({
      id: item.id, clientId: item.client_id, name: item.full_name, identityNumber: item.identity_number,
      client: clientById.get(item.client_id)?.legal_name ?? "Unknown client", phone: item.phone ?? "-",
      scope: "Receipt, processing, dispatch", validFrom: item.valid_from, expiry: item.valid_to ?? "Open-ended",
      validTo: item.valid_to, status: item.active ? "ACTIVE" : "INACTIVE",
    })),
    warehouses,
    receipts: receipts.map((item) => ({
      databaseId: item.id, clientDatabaseId: item.client_id, agreementDatabaseId: item.agreement_id,
      representativeDatabaseId: item.representative_id ?? undefined, id: item.receipt_number,
      client: clientById.get(item.client_id)?.legal_name ?? "Unknown client",
      agreement: agreementById.get(item.agreement_id)?.agreement_number ?? "-",
      representative: item.representative_id ? representativeById.get(item.representative_id)?.full_name ?? "-" : "-",
      receivedAt: item.arrival_at.slice(0, 16), warehouse: warehouseById.get(item.warehouse_id)?.name ?? "-",
      section: item.section, truckPlate: item.vehicle_plate, driverName: item.driver_name ?? "-", sealNumber: item.seal_number ?? "-",
      weighbridgeRef: item.weighbridge_reference ?? "-", origin: item.origin ?? "-",
      coffeeType: item.coffee_type === "WASHED" ? "Washed" : "Unwashed / UG", grade: item.grade ?? "-",
      cropYear: item.crop_year ?? new Date(item.arrival_at).getFullYear(), bags: item.bag_count,
      bagWeightKg: Number(item.bag_weight_kg ?? item.net_weight_kg / item.bag_count),
      grossWeightKg: Number(item.gross_weight_kg ?? item.net_weight_kg), tareWeightKg: Number(item.tare_weight_kg ?? 0),
      netWeightKg: Number(item.net_weight_kg), moisturePercent: Number(item.moisture_percent ?? 0), wetCoffee: item.wet_coffee,
      certificationStatus: item.certification_status ?? "NOT_RECORDED", certificationSchemes: item.certification_schemes ?? [],
      certificateNumber: item.certificate_number ?? "", certificationIssuer: item.certification_issuer ?? "",
      certificationValidFrom: item.certification_valid_from ?? "", certificationValidTo: item.certification_valid_to ?? "",
      receivedBy: profileById.get(item.prepared_by)?.full_name ?? "-", createdBy: profileById.get(item.prepared_by)?.full_name ?? "-",
      preparedById: item.prepared_by,
      status: item.status, lotNumber: lotByReceipt.get(item.id)?.lot_number,
    })),
    lots: lots.map((item) => {
      const receipt = item.receipt_id ? receiptById.get(item.receipt_id) : undefined;
      return {
        databaseId: item.id, lotNumber: item.lot_number, sourceGrn: receipt?.receipt_number ?? "Derived lot",
        client: clientById.get(item.client_id)?.legal_name ?? "Hayked", coffee: item.coffee_type === "WASHED" ? "Washed" : "Unwashed / UG",
        grade: receipt?.grade ?? "-", section: item.section, bags: item.bag_count, weightKg: Number(item.quantity_kg), status: item.status,
        lotCategory: item.lot_category ?? null, ownershipType: item.ownership_type,
        certificationStatus: item.certification_status ?? "NOT_RECORDED", certificationSchemes: item.certification_schemes ?? [],
        certificateNumber: item.certificate_number ?? "", certificationIssuer: item.certification_issuer ?? "",
        certificationValidFrom: item.certification_valid_from ?? "", certificationValidTo: item.certification_valid_to ?? "",
      };
    }),
    movements: movements.map((item) => ({
      databaseId: item.id, id: item.id.slice(-8).toUpperCase(), sourceGrn: receiptById.get(item.reference_id)?.receipt_number ?? item.reference_id.slice(-8).toUpperCase(),
      lotNumber: lotById.get(item.lot_id)?.lot_number ?? "Unknown lot", type: item.movement_type,
      bagsDelta: item.bag_delta, weightDeltaKg: Number(item.quantity_kg),
      referenceType: item.reference_type, referenceId: item.reference_id,
    })),
    tariffs: tariffs.map((item) => ({ code: item.version_code, name: item.description?.trim() || "Hayked standard rates", active: item.active })),
  };
}

export type NewClient = { code: string; legalName: string; tin: string; phone: string; email: string };
export type NewAgreement = { clientId: string; agreementNumber: string; effectiveFrom: string; effectiveTo: string | null; status: "DRAFT" | "ACTIVE"; defaultBagWeightKg: number; tariffVersion: string };
export type NewRepresentative = { clientId: string; fullName: string; identityNumber: string; phone: string; validFrom: string; validTo: string | null; active: boolean };

export async function createClientSetup(input: {
  client: NewClient;
  agreement?: Omit<NewAgreement, "clientId">;
  representatives: Omit<NewRepresentative, "clientId">[];
}) {
  const { data, error } = await createSupabaseClient().rpc("create_client_setup", {
    p_client: input.client,
    p_agreement: input.agreement ?? null,
    p_representatives: input.representatives,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "The client setup could not be saved."));
  return data as { clientId: string; agreementId: string | null; representativeCount: number };
}

export async function createClient(client: NewClient) {
  const db = createSupabaseClient();
  const [organization, userId] = await Promise.all([
    db.from("organizations").select("id").eq("code", "HAYKED").single(),
    currentUserId(),
  ]);
  const organizationData = result(organization.data, organization.error);
  const { data, error } = await db.from("clients").insert({
    organization_id: organizationData.id, code: client.code.trim(), legal_name: client.legalName.trim(),
    tin: client.tin.trim() || null, phone: client.phone.trim() || null, email: client.email.trim() || null,
    active: true, created_by: userId,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateClientProfile(clientId: string, client: NewClient & { active: boolean }) {
  const { data, error } = await createSupabaseClient().rpc("update_client_profile", {
    p_client_id: clientId,
    p_client: client,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "The client could not be updated."));
  return data as { id: string; code: string; legal_name: string; active: boolean };
}

export async function createAgreement(agreement: NewAgreement) {
  const { error } = await createSupabaseClient().from("agreements").insert({
    client_id: agreement.clientId, agreement_number: agreement.agreementNumber.trim(), effective_from: agreement.effectiveFrom,
    effective_to: agreement.effectiveTo, status: agreement.status, default_bag_weight_kg: agreement.defaultBagWeightKg,
    tariff_version: agreement.tariffVersion.trim(), created_by: await currentUserId(),
  });
  if (error) throw new Error(error.message);
}

export async function createRepresentative(representative: NewRepresentative) {
  const { error } = await createSupabaseClient().from("authorized_representatives").insert({
    client_id: representative.clientId, full_name: representative.fullName.trim(), identity_number: representative.identityNumber.trim(),
    phone: representative.phone.trim() || null, valid_from: representative.validFrom, valid_to: representative.validTo,
    active: representative.active,
  });
  if (error) throw new Error(error.message);
}

export async function updateAgreement(agreementId: string, agreement: { effectiveFrom: string; effectiveTo: string; status: "DRAFT" | "ACTIVE" | "EXPIRED" | "TERMINATED"; defaultBagWeightKg: number; tariffVersion: string }) {
  const { data, error } = await createSupabaseClient().rpc("update_client_agreement", {
    p_agreement_id: agreementId,
    p_effective_from: agreement.effectiveFrom,
    p_effective_to: agreement.effectiveTo,
    p_status: agreement.status,
    p_default_bag_weight_kg: agreement.defaultBagWeightKg,
    p_tariff_version: agreement.tariffVersion,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "The agreement could not be updated."));
  return data;
}

export async function updateRepresentative(representativeId: string, representative: Omit<NewRepresentative, "clientId">) {
  const { data, error } = await createSupabaseClient().rpc("update_authorized_representative", {
    p_representative_id: representativeId,
    p_full_name: representative.fullName,
    p_identity_number: representative.identityNumber,
    p_phone: representative.phone,
    p_valid_from: representative.validFrom,
    p_valid_to: representative.validTo,
    p_active: representative.active,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "The representative could not be updated."));
  return data;
}

export async function createWarehouseReceipt(receipt: WarehouseReceipt) {
  const db = createSupabaseClient();
  const [client, warehouse, userId, numberResult] = await Promise.all([
    receipt.clientDatabaseId
      ? db.from("clients").select("id").eq("id", receipt.clientDatabaseId).eq("active", true).single()
      : db.from("clients").select("id").eq("legal_name", receipt.client).eq("active", true).single(),
    db.from("warehouses").select("id").eq("name", receipt.warehouse).single(),
    currentUserId(),
    db.rpc("next_erp_number", { document_type: "GRN", warehouse_code: "GEL", calendar_year: Number(receipt.receivedAt.slice(0, 4)) }),
  ]);
  const references = [client, warehouse];
  const failed = references.find((item) => item.error);
  if (failed?.error) throw new Error(friendlyDatabaseError(failed.error, "The selected client or warehouse is no longer available."));
  if (numberResult.error) throw new Error(friendlyDatabaseError(numberResult.error, "A GRN number could not be generated."));
  const clientData = result(client.data, client.error);
  const warehouseData = result(warehouse.data, warehouse.error);
  const receiptDate = receipt.receivedAt.slice(0, 10);
  let agreementQuery = db.from("agreements").select("id").eq("client_id", clientData.id).eq("status", "ACTIVE").lte("effective_from", receiptDate).or(`effective_to.is.null,effective_to.gte.${receiptDate}`);
  agreementQuery = receipt.agreementDatabaseId ? agreementQuery.eq("id", receipt.agreementDatabaseId) : agreementQuery.eq("agreement_number", receipt.agreement);
  let representativeQuery = db.from("authorized_representatives").select("id").eq("client_id", clientData.id).eq("active", true).lte("valid_from", receiptDate).or(`valid_to.is.null,valid_to.gte.${receiptDate}`);
  representativeQuery = receipt.representativeDatabaseId ? representativeQuery.eq("id", receipt.representativeDatabaseId) : representativeQuery.eq("full_name", receipt.representative);
  const [agreement, representative] = await Promise.all([agreementQuery.maybeSingle(), representativeQuery.maybeSingle()]);
  const agreementData = result(agreement.data, agreement.error);
  const representativeData = result(representative.data, representative.error);
  const { error } = await db.from("warehouse_receipts").insert({
    receipt_number: String(numberResult.data), warehouse_id: warehouseData.id, client_id: clientData.id,
    agreement_id: agreementData.id, representative_id: representativeData.id, arrival_at: receipt.receivedAt,
    coffee_type: receipt.coffeeType === "Washed" ? "WASHED" : "UNWASHED_UG", bag_count: receipt.bags,
    net_weight_kg: receipt.netWeightKg, vehicle_plate: receipt.truckPlate, status: "DRAFT", prepared_by: userId,
    section: receipt.section, driver_name: receipt.driverName, seal_number: receipt.sealNumber,
    weighbridge_reference: receipt.weighbridgeRef, origin: receipt.origin, grade: receipt.grade, crop_year: receipt.cropYear,
    bag_weight_kg: receipt.bagWeightKg, gross_weight_kg: receipt.grossWeightKg, tare_weight_kg: receipt.tareWeightKg,
    moisture_percent: receipt.moisturePercent, wet_coffee: receipt.wetCoffee,
    certification_status: receipt.certificationStatus ?? "NOT_RECORDED",
    certification_schemes: receipt.certificationSchemes ?? [], certificate_number: receipt.certificateNumber?.trim() || null,
    certification_issuer: receipt.certificationIssuer?.trim() || null,
    certification_valid_from: receipt.certificationValidFrom || null, certification_valid_to: receipt.certificationValidTo || null,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "The GRN could not be saved."));
  return String(numberResult.data);
}

export async function updateWarehouseReceiptDraft(receipt: WarehouseReceipt) {
  if (!receipt.databaseId || !receipt.clientDatabaseId || !receipt.agreementDatabaseId || !receipt.representativeDatabaseId) {
    throw new Error("Refresh the page before editing this GRN.");
  }
  const db = createSupabaseClient();
  const { error } = await db.rpc("update_grn_draft", {
    receipt_id: receipt.databaseId, client_id: receipt.clientDatabaseId, agreement_id: receipt.agreementDatabaseId,
    representative_id: receipt.representativeDatabaseId, arrival_at: receipt.receivedAt,
    coffee_type: receipt.coffeeType === "Washed" ? "WASHED" : "UNWASHED_UG", bag_count: receipt.bags,
    net_weight_kg: receipt.netWeightKg, vehicle_plate: receipt.truckPlate, section: receipt.section,
    driver_name: receipt.driverName, seal_number: receipt.sealNumber, weighbridge_reference: receipt.weighbridgeRef,
    origin: receipt.origin, grade: receipt.grade, crop_year: receipt.cropYear, bag_weight_kg: receipt.bagWeightKg,
    gross_weight_kg: receipt.grossWeightKg, tare_weight_kg: receipt.tareWeightKg,
    moisture_percent: receipt.moisturePercent, wet_coffee: receipt.wetCoffee,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "The draft GRN could not be updated."));
  const { error: certificationError } = await db.rpc("update_grn_certification", {
    p_receipt_id: receipt.databaseId,
    p_status: receipt.certificationStatus ?? "NOT_RECORDED",
    p_schemes: receipt.certificationSchemes ?? [],
    p_certificate_number: receipt.certificateNumber?.trim() || null,
    p_issuer: receipt.certificationIssuer?.trim() || null,
    p_valid_from: receipt.certificationValidFrom || null,
    p_valid_to: receipt.certificationValidTo || null,
  });
  if (certificationError) throw new Error(friendlyDatabaseError(certificationError, "The certification details could not be updated."));
}

export async function transitionGrn(receipt: WarehouseReceipt, targetStatus: WarehouseReceipt["status"], reason?: string) {
  const { error } = await createSupabaseClient().rpc("transition_grn", {
    receipt_id: receipt.databaseId, target_status: targetStatus,
    lot_number: targetStatus === "POSTED" ? `HYK/GEL/${new Date().getFullYear()}/${receipt.id.slice(-4)}` : null,
    reversal_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
}

type ProcessingOrderRow = { id: string; order_number: string; completion_number: string | null; request_id: string | null; lot_id: string; client_id: string; queue_position: number; input_kg: number; status: string; accepted_client_kg: number; client_reject_kg: number; hayked_byproduct_kg: number; process_loss_kg: number; started_at: string | null; completed_at: string | null };
type ProcessingRequestRow = {
  id: string; request_number: string; request_note_number: string; request_date: string; client_name: string; client_id: string | null;
  lot_reference: string; lot_id: string | null; coffee_type: "WASHED" | "UNWASHED_UG"; requested_preparation_type: string;
  grade: string; requested_bags: number; requested_kg: number; certifications: ProcessingRequest["certifications"];
  other_certification: string | null; requester_name: string; checker_name: string; approver_name: string; notes: string | null;
  scanned_document_attached: boolean; status: ProcessingRequest["status"]; queued_order_id: string | null; created_by: string;
};
export type ProcessingRequestLineRow = { id: string; request_id: string; line_number: number; lot_id: string; requested_preparation_type: string; grade: string; requested_bags: number; requested_kg: number; certifications: ProcessingRequest["certifications"]; special_instruction: string | null; remark: string | null };
export type ProcessingOrderInputRow = { id: string; order_id: string; request_line_id: string | null; lot_id: string; input_bags: number; input_kg: number };
export type ProcessingIntakeRow = { id: string; intake_number: string; order_id: string; intake_at: string; input_bags: number; input_kg: number; scale_reference: string; warehouse_issue_reference: string; machine_line: string; shift_name: string; received_by: string; client_monitor_present: boolean; client_monitor_name: string | null; intake_condition: string; evidence_path: string | null };
export type ProcessingOutputRow = { id: string; order_id: string; line_number: number; category: ProcessingOutputLine["category"]; owner_type: "CLIENT" | "HAYKED" | "NONE"; coffee_type: "WASHED" | "UNWASHED_UG" | null; grade: string | null; preparation: string | null; bag_count: number; bag_weight_kg: number | null; quantity_kg: number; warehouse_section: string | null; certifications: ProcessingRequest["certifications"]; weighing_reference: string | null; evidence_path: string | null; reason: string | null; child_lot_id: string | null };
export type ProcessingOutputSourceRow = { output_id: string; input_id: string };
export type ProcessingReservationRow = { id: string; processing_order_id: string | null; lot_id: string; reserved_bags: number; reserved_kg: number; status: "ACTIVE" | "CONSUMED" | "RELEASED" };
export type EcxCheckRow = { id: string; check_number: string; processing_request_id: string; processing_order_id: string | null; client_id: string; lot_id: string | null; checked_on: string; result: "PENDING" | "PASSED" | "FAILED" | "NOT_REQUIRED"; reference_number: string | null; inspector_name: string | null; notes: string | null; created_at: string; updated_at: string };

export type ProcessingData = {
  requests: ProcessingRequest[];
  orders: ProcessingOrderRow[];
  requestLines: ProcessingRequestLineRow[];
  orderInputs: ProcessingOrderInputRow[];
  intakes: ProcessingIntakeRow[];
  outputs: ProcessingOutputRow[];
  outputSources: ProcessingOutputSourceRow[];
  reservations: ProcessingReservationRow[];
  ecxChecks: EcxCheckRow[];
  clients: ClientRow[];
  lots: LotRow[];
  representatives: RepresentativeRow[];
  profiles: ProfileRow[];
  receipts: Pick<ReceiptRow, "id" | "receipt_number" | "grade" | "origin" | "crop_year" | "bag_weight_kg">[];
};

export async function loadProcessingData(): Promise<ProcessingData> {
  const db = createSupabaseClient();
  const [requestResult, orderResult, requestLineResult, orderInputResult, intakeResult, outputResult, outputSourceResult, reservationResult, ecxResult, clientResult, lotResult, representativeResult, profileResult, receiptResult] = await Promise.all([
    db.from("processing_requests").select("*").order("created_at", { ascending: false }),
    db.from("processing_orders").select("id,order_number,completion_number,request_id,lot_id,client_id,queue_position,input_kg,status,accepted_client_kg,client_reject_kg,hayked_byproduct_kg,process_loss_kg,started_at,completed_at").order("queue_position"),
    db.from("processing_request_lines").select("*").order("line_number"),
    db.from("processing_order_inputs").select("*").order("created_at"),
    db.from("processing_intakes").select("*").order("intake_at", { ascending: false }),
    db.from("processing_outputs").select("*").order("line_number"),
    db.from("processing_output_sources").select("output_id,input_id"),
    db.from("stock_reservations").select("id,processing_order_id,lot_id,reserved_bags,reserved_kg,status").not("processing_order_id", "is", null).order("created_at"),
    db.from("ecx_checks").select("id,check_number,processing_request_id,processing_order_id,client_id,lot_id,checked_on,result,reference_number,inspector_name,notes,created_at,updated_at").order("checked_on", { ascending: false }),
    db.from("clients").select("id,code,legal_name,tin,active"),
    db.from("coffee_lots").select("id,lot_number,receipt_id,client_id,coffee_type,lot_category,parent_lot_id,source_processing_order_id,bag_count,quantity_kg,section,status"),
    db.from("authorized_representatives").select("id,client_id,full_name,identity_number,phone,valid_from,valid_to,active").order("full_name"),
    db.from("profiles").select("id,full_name,role,active").order("full_name"),
    db.from("warehouse_receipts").select("id,receipt_number,grade,origin,crop_year,bag_weight_kg"),
  ]);
  const rows = result(requestResult.data as ProcessingRequestRow[] | null, requestResult.error);
  const orders = result(orderResult.data as ProcessingOrderRow[] | null, orderResult.error);
  const requestLines = result(requestLineResult.data as ProcessingRequestLineRow[] | null, requestLineResult.error);
  const orderInputs = result(orderInputResult.data as ProcessingOrderInputRow[] | null, orderInputResult.error);
  const intakes = result(intakeResult.data as ProcessingIntakeRow[] | null, intakeResult.error);
  const outputs = result(outputResult.data as ProcessingOutputRow[] | null, outputResult.error);
  const outputSources = result(outputSourceResult.data as ProcessingOutputSourceRow[] | null, outputSourceResult.error);
  const reservations = result(reservationResult.data as ProcessingReservationRow[] | null, reservationResult.error);
  const ecxChecks = result(ecxResult.data as EcxCheckRow[] | null, ecxResult.error);
  const clients = result(clientResult.data as ClientRow[] | null, clientResult.error);
  const lots = result(lotResult.data as LotRow[] | null, lotResult.error);
  const representatives = result(representativeResult.data as RepresentativeRow[] | null, representativeResult.error);
  const profiles = result(profileResult.data as ProfileRow[] | null, profileResult.error);
  const receipts = result(receiptResult.data as ProcessingData["receipts"] | null, receiptResult.error);
  const orderById = new Map(orders.map((item) => [item.id, item]));
  return {
    requests: rows.map((item) => ({
      id: item.id, requestNumber: item.request_number, createdById: item.created_by, clientDatabaseId: item.client_id ?? undefined,
      lotDatabaseId: item.lot_id ?? undefined, noteNumber: item.request_note_number, requestDate: item.request_date, client: item.client_name,
      lot: item.lot_reference, coffeeType: item.coffee_type === "WASHED" ? "Washed" : "Unwashed / UG",
      preparationType: item.requested_preparation_type, grade: item.grade, requestedBags: item.requested_bags,
      requestedKg: Number(item.requested_kg), certifications: item.certifications, otherCertification: item.other_certification ?? "",
      requester: item.requester_name, checker: item.checker_name, approver: item.approver_name, notes: item.notes ?? "",
      scannedDocumentAttached: item.scanned_document_attached, status: item.status,
      queuedAs: item.queued_order_id ? orderById.get(item.queued_order_id)?.order_number : undefined,
    })),
    orders, requestLines, orderInputs, intakes, outputs, outputSources, reservations, ecxChecks, clients, lots, representatives, profiles, receipts,
  };
}

export async function createProcessingRequest(request: ProcessingRequest, lines: ProcessingRequestLine[]) {
  if (!request.clientDatabaseId) throw new Error("Select a client.");
  const db = createSupabaseClient();
  const client = await db.from("clients").select("id,legal_name").eq("id", request.clientDatabaseId).eq("active", true).maybeSingle();
  if (client.error || !client.data) throw new Error(friendlyDatabaseError(client.error, "The selected client is no longer available."));
  const { data, error } = await db.rpc("create_and_submit_processing_request", {
    p_header: { noteNumber: request.noteNumber, requestDate: request.requestDate, clientId: client.data.id, clientName: client.data.legal_name, certifications: request.certifications, otherCertification: request.otherCertification, requester: request.requester, checker: request.checker, approver: request.approver, notes: request.notes, scannedDocumentAttached: request.scannedDocumentAttached },
    p_lines: lines.map((line) => ({ lotId: line.lotDatabaseId, preparationType: line.preparationType, grade: line.grade, requestedBags: line.requestedBags, requestedKg: line.requestedKg, certifications: line.certifications, specialInstruction: line.specialInstruction, remark: line.remark })),
  });
  if (error) throw new Error(friendlyDatabaseError(error, "The processing request could not be saved."));
  return String((data as { request_number: string }).request_number);
}

async function processingRequestRpc(
  name: "submit_processing_request" | "reject_processing_request" | "queue_approved_processing_request",
  id: string,
) {
  const { error } = await createSupabaseClient().rpc(name, { request_id: id });
  if (error) throw new Error(error.message);
}

export const submitProcessingRequest = (id: string) =>
  processingRequestRpc("submit_processing_request", id);

export const rejectProcessingRequest = (id: string) =>
  processingRequestRpc("reject_processing_request", id);

export const queueApprovedProcessingRequest = (id: string) =>
  processingRequestRpc("queue_approved_processing_request", id);

export async function approveProcessingRequest(id: string) {
  const { error } = await createSupabaseClient().rpc(
    "approve_and_queue_processing_request",
    { request_id: id },
  );
  if (error) throw new Error(error.message);
}

export async function startProcessingOrder(id: string, intake: { intakeAt: string; inputBags: number; inputKg: number; scaleReference: string; warehouseIssueReference: string; machineLine: string; shiftName: string; clientMonitorPresent: boolean; clientMonitorName: string; intakeCondition: string; evidencePath: string }) {
  const { error } = await createSupabaseClient().rpc("start_processing_order_with_intake", { p_order_id: id, p_intake: intake });
  if (error) throw new Error(error.message);
}

export async function completeProcessingOrder(id: string, lines: ProcessingOutputLine[], exceptionApproved: boolean, evidencePath: string) {
  const lossReason = lines.filter((line) => line.category === "PROCESS_LOSS").map((line) => line.reason).filter(Boolean).join("; ");
  const { error } = await createSupabaseClient().rpc("complete_processing_order_v2", {
    p_order_id: id,
    p_output_lines: lines,
    p_loss_reason: lossReason || null,
    p_loss_evidence: evidencePath || null,
    p_exception_approved: exceptionApproved,
  });
  if (error) throw new Error(error.message);
}

export async function saveEcxCheck(input: { id?: string; processingRequestId: string; checkedOn: string; result: EcxCheckRow["result"]; referenceNumber?: string; inspectorName?: string; notes?: string }) {
  const parameters = {
    p_checked_on: input.checkedOn,
    p_result: input.result,
    p_reference_number: input.referenceNumber ?? null,
    p_inspector_name: input.inspectorName ?? null,
    p_notes: input.notes ?? null,
  };
  const { data, error } = input.id
    ? await createSupabaseClient().rpc("update_ecx_check", { p_check_id: input.id, ...parameters })
    : await createSupabaseClient().rpc("create_ecx_check", { p_processing_request_id: input.processingRequestId, ...parameters });
  if (error) throw new Error(friendlyDatabaseError(error, "The ECX check could not be saved."));
  return data as EcxCheckRow;
}

export type DispatchRow = { id: string; dispatch_number: string; lot_id: string; client_id: string; representative_id: string; quantity_kg: number; bag_count: number; invoices_paid: boolean; credit_approved: boolean; documents_ready: boolean; weighbridge_ready: boolean; legal_or_quality_hold: boolean; status: string; prepared_by: string; approved_by: string | null; dispatch_date: string; dispatch_reason: string; destination: string | null; documents_reference: string | null; weighbridge_reference: string | null; notes: string | null; posted_at: string | null };
export type DispatchLineRow = { id: string; dispatch_id: string; line_number: number; lot_id: string; bag_count: number; quantity_kg: number };
export type StockReservationRow = { id: string; dispatch_id: string | null; processing_order_id: string | null; lot_id: string; reserved_bags: number; reserved_kg: number; status: "ACTIVE" | "CONSUMED" | "RELEASED" };
export type CreditOverrideRow = { id: string; dispatch_id: string; amount_etb: number; expires_on: string; reason: string; document_reference: string; status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED"; requested_by: string; decided_by: string | null };
export type EcxTransferRow = { id: string; transfer_number: string; lot_id: string; client_id: string; source_warehouse_id: string; destination_warehouse_id: string; sent_kg: number; sent_bags: number | null; received_kg: number | null; vehicle_plate: string | null; status: "IN_TRANSIT" | "RECEIVED" | "REVERSED"; sent_at: string; received_at: string | null; variance_approved_by: string | null; prepared_by: string; transfer_reference: string | null; driver_name: string | null; seal_number: string | null; expected_arrival_on: string | null; departure_document_reference: string | null; destination_document_reference: string | null };
export type DispatchWarehouseRow = { id: string; code: string; name: string; location: string; active: boolean };
export type DispatchData = { dispatches: DispatchRow[]; lines: DispatchLineRow[]; reservations: StockReservationRow[]; credits: CreditOverrideRow[]; ecxTransfers: EcxTransferRow[]; warehouses: DispatchWarehouseRow[]; clients: ClientRow[]; lots: LotRow[]; representatives: RepresentativeRow[]; profiles: ProfileRow[]; agreements: { id: string; client_id: string; agreement_number: string; effective_from: string; effective_to: string | null; status: string }[] };

export async function loadDispatchData(): Promise<DispatchData> {
  const db = createSupabaseClient();
  const [dispatches, lines, reservations, credits, ecxTransfers, warehouses, clients, lots, representatives, profiles, agreements] = await Promise.all([
    db.from("dispatch_orders").select("*").order("created_at", { ascending: false }),
    db.from("dispatch_lines").select("*").order("line_number"),
    db.from("stock_reservations").select("*").order("created_at"),
    db.from("credit_overrides").select("*").order("created_at", { ascending: false }),
    db.from("ecs_transfers").select("id,transfer_number,lot_id,client_id,source_warehouse_id,destination_warehouse_id,sent_kg,sent_bags,received_kg,vehicle_plate,status,sent_at,received_at,variance_approved_by,prepared_by,transfer_reference,driver_name,seal_number,expected_arrival_on,departure_document_reference,destination_document_reference").order("sent_at", { ascending: false }),
    db.from("warehouses").select("id,code,name,location,active").eq("active", true).order("name"),
    db.from("clients").select("id,code,legal_name,tin,phone,email,active").order("legal_name"),
    db.from("coffee_lots").select("id,lot_number,receipt_id,warehouse_id,client_id,coffee_type,bag_count,quantity_kg,section,status,certification_status,certification_schemes,certificate_number,certification_issuer,certification_valid_from,certification_valid_to").order("lot_number"),
    db.from("authorized_representatives").select("id,client_id,full_name,identity_number,phone,valid_from,valid_to,active").order("full_name"),
    db.from("profiles").select("id,full_name,role,active").order("full_name"),
    db.from("agreements").select("id,client_id,agreement_number,effective_from,effective_to,status"),
  ]);
  return { dispatches: result(dispatches.data as DispatchRow[] | null, dispatches.error), lines: result(lines.data as DispatchLineRow[] | null, lines.error), reservations: result(reservations.data as StockReservationRow[] | null, reservations.error), credits: result(credits.data as CreditOverrideRow[] | null, credits.error), ecxTransfers: result(ecxTransfers.data as EcxTransferRow[] | null, ecxTransfers.error), warehouses: result(warehouses.data as DispatchWarehouseRow[] | null, warehouses.error), clients: result(clients.data as ClientRow[] | null, clients.error), lots: result(lots.data as LotRow[] | null, lots.error), representatives: result(representatives.data as RepresentativeRow[] | null, representatives.error), profiles: result(profiles.data as ProfileRow[] | null, profiles.error), agreements: result(agreements.data as DispatchData["agreements"] | null, agreements.error) };
}

export async function createDispatchDraft(header: Record<string, unknown>, lines: { lotId: string; bagCount: number; quantityKg: number }[]) {
  const { data, error } = await createSupabaseClient().rpc("create_dispatch_draft", { p_header: header, p_lines: lines });
  if (error) throw new Error(friendlyDatabaseError(error, "The dispatch draft could not be created."));
  return data as { id: string; dispatch_number: string };
}

export async function dispatchRpc(name: "submit_dispatch" | "approve_dispatch" | "post_dispatch_v2", id: string) {
  const parameter = name === "post_dispatch_v2" ? { p_dispatch_id: id } : { p_dispatch_id: id };
  const { error } = await createSupabaseClient().rpc(name, parameter);
  if (error) throw new Error(error.message);
}

export async function decideCreditOverride(id: string, decision: "APPROVED" | "REJECTED") {
  const { error } = await createSupabaseClient().rpc("decide_credit_override", { p_credit_id: id, p_decision: decision });
  if (error) throw new Error(error.message);
}

export async function updateDispatchReadiness(id: string, documentReference: string, weighbridgeReference: string, notes: string) {
  const { data, error } = await createSupabaseClient().rpc("update_dispatch_readiness", {
    p_dispatch_id: id,
    p_document_reference: documentReference,
    p_weighbridge_reference: weighbridgeReference,
    p_notes: notes,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "The missing dispatch information could not be saved."));
  return data as { id: string; dispatch_number: string };
}

export async function postEcxTransfer(input: { lotId: string; destinationWarehouseId: string; sentKg: number; vehiclePlate: string; transferReference: string; driverName: string; sealNumber: string; expectedArrivalOn: string; departureDocumentReference: string }) {
  const { data, error } = await createSupabaseClient().rpc("post_ecx_transfer_v2", {
    p_lot_id: input.lotId,
    p_destination_warehouse_id: input.destinationWarehouseId,
    p_sent_kg: input.sentKg,
    p_vehicle_plate: input.vehiclePlate || null,
    p_transfer_reference: input.transferReference || null,
    p_driver_name: input.driverName || null,
    p_seal_number: input.sealNumber || null,
    p_expected_arrival_on: input.expectedArrivalOn || null,
    p_departure_document_reference: input.departureDocumentReference || null,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "The ECX transfer could not be sent."));
  return data as string;
}

export async function receiveEcxTransfer(input: { transferId: string; receivedKg: number; destinationSection: string; varianceApprovedBy: string | null; destinationDocumentReference: string }) {
  const { data, error } = await createSupabaseClient().rpc("receive_ecx_transfer_v2", {
    p_transfer_id: input.transferId,
    p_received_kg: input.receivedKg,
    p_destination_section: input.destinationSection,
    p_variance_approved_by: input.varianceApprovedBy,
    p_destination_document_reference: input.destinationDocumentReference || null,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "The ECX destination receipt could not be posted."));
  return data as string;
}

export type InvoiceRow = { id: string; invoice_number: string; client_id: string; tariff_version: string; subtotal_etb: number; tax_etb: number; total_etb: number; status: string; issued_on: string | null; due_on: string | null; created_at: string; line_snapshot: { service_event_id?: string; service_type?: string; description: string; quantity: number; rate_etb: number; amount_etb?: number; reference_id?: string | null; reference_type?: string | null }[] };
export type PaymentRow = { id: string; payment_number: string; invoice_id: string; client_id: string; amount_etb: number; bank_reference: string; paid_at: string; direction: string; payment_method: string; payer_name: string | null; financial_institution: string | null; payment_note: string | null };
export type ServiceEventRow = { id: string; client_id: string; service_type: string; description: string; quantity: number; unit_price: number; total_amount: number; reference_id: string | null; reference_type: string | null; service_date: string; unit_label: string; invoice_id: string | null; status: string; created_at: string };
export type StorageRentRecordRow = { id: string; rent_number: string; client_id: string; lot_id: string; storage_category: string; charge_start_on: string; billed_through_on: string | null; status: string; evidence_reference: string | null; note: string | null; recorded_by: string; created_at: string; updated_at: string };
export type TariffLineItemRow = { id: string; tariff_version_id: string; category: string; age_start_days: number; age_end_days: number | null; daily_rate_per_unit: number; certified: boolean; source_clause: string | null; source_pdf_page: number | null };
export type StorageQuoteRow = { date: string; openingBags: number; movementBags: number; closingBags: number; openingKg: number; movementKg: number; closingKg: number; ageDay: number; rate: number; units: number; amount: number; references: string[] };
export type StorageQuote = { tariffVersion: string; billingBasis: "EQUIVALENT_BAG_FROM_KG" | "FIFTY_EMPTY_BAGS"; bagWeightKg: number; duplicateKey: string; billableBagDays: number; amount: number; rows: StorageQuoteRow[] };
export type FinanceData = {
  invoices: InvoiceRow[];
  payments: PaymentRow[];
  clients: ClientRow[];
  lots: (LotRow & { received_at: string })[];
  movements: { lot_id: string; bag_delta: number; occurred_at: string; reference_type: string }[];
  tariffs: { id: string; version_code: string; description: string | null; effective_from: string; effective_to: string | null; active: boolean; verified_by_1: string | null; verified_by_2: string | null }[];
  tariffLineItems: TariffLineItemRow[];
  storageRuns: { id: string; duplicate_key: string; client_id: string; lot_id: string; storage_rent_record_id: string | null; run_number: string; total_amount: number; status: string }[];
  storageRentRecords: StorageRentRecordRow[];
  serviceEvents: ServiceEventRow[];
};

export async function loadFinanceData(): Promise<FinanceData> {
  const db = createSupabaseClient();
  const [invoiceResult, paymentResult, clientResult, lotResult, receiptResult, movementResult, tariffResult, tariffLineResult, storageRunResult, storageRentResult, serviceEventResult] = await Promise.all([
    db.from("invoices").select("id,invoice_number,client_id,tariff_version,subtotal_etb,tax_etb,total_etb,status,issued_on,due_on,created_at,line_snapshot").order("created_at", { ascending: false }),
    db.from("payments").select("id,payment_number,invoice_id,client_id,amount_etb,bank_reference,paid_at,direction,payment_method,payer_name,financial_institution,payment_note").order("paid_at", { ascending: false }),
    db.from("clients").select("id,code,legal_name,tin,phone,email,active").order("legal_name"),
    db.from("coffee_lots").select("id,lot_number,receipt_id,client_id,coffee_type,bag_count,quantity_kg,section,status,certification_status,certification_schemes,certificate_number,certification_issuer,certification_valid_from,certification_valid_to").order("lot_number"),
    db.from("warehouse_receipts").select("id,arrival_at"),
    db.from("stock_movements").select("lot_id,bag_delta,occurred_at,reference_type").order("occurred_at"),
    db.from("tariff_versions").select("id,version_code,description,effective_from,effective_to,active,verified_by_1,verified_by_2").order("effective_from", { ascending: false }),
    db.from("tariff_line_items").select("id,tariff_version_id,category,age_start_days,age_end_days,daily_rate_per_unit,certified,source_clause,source_pdf_page").order("category").order("age_start_days"),
    db.from("storage_billing_runs").select("id,duplicate_key,client_id,lot_id,storage_rent_record_id,run_number,total_amount,status").order("created_at", { ascending: false }),
    db.from("storage_rent_records").select("id,rent_number,client_id,lot_id,storage_category,charge_start_on,billed_through_on,status,evidence_reference,note,recorded_by,created_at,updated_at").order("created_at", { ascending: false }),
    db.from("service_events").select("id,client_id,service_type,description,quantity,unit_price,total_amount,reference_id,reference_type,service_date,unit_label,invoice_id,status,created_at").order("created_at", { ascending: false }),
  ]);
  const receiptDates = new Map((receiptResult.data ?? []).map((item) => [item.id, item.arrival_at]));
  return {
    invoices: result(invoiceResult.data as InvoiceRow[] | null, invoiceResult.error),
    payments: result(paymentResult.data as PaymentRow[] | null, paymentResult.error),
    clients: result(clientResult.data as ClientRow[] | null, clientResult.error),
    lots: result(lotResult.data as LotRow[] | null, lotResult.error).map((lot) => ({ ...lot, received_at: receiptDates.get(lot.receipt_id ?? "") ?? new Date().toISOString() })),
    movements: result(movementResult.data as FinanceData["movements"] | null, movementResult.error),
    tariffs: result(tariffResult.data as FinanceData["tariffs"] | null, tariffResult.error),
    tariffLineItems: result(tariffLineResult.data as TariffLineItemRow[] | null, tariffLineResult.error),
    storageRuns: result(storageRunResult.data as FinanceData["storageRuns"] | null, storageRunResult.error),
    storageRentRecords: result(storageRentResult.data as StorageRentRecordRow[] | null, storageRentResult.error),
    serviceEvents: result(serviceEventResult.data as ServiceEventRow[] | null, serviceEventResult.error),
  };
}

export async function recordPayment(input: { invoiceId: string; amount: number; reference: string; paidAt: string; paymentMethod: string; payerName: string; financialInstitution: string; note: string }) {
  const { data, error } = await createSupabaseClient().rpc("record_invoice_payment_v2", {
    p_invoice_id: input.invoiceId,
    p_amount_etb: input.amount,
    p_reference: input.reference,
    p_paid_at: input.paidAt,
    p_payment_method: input.paymentMethod,
    p_payer_name: input.payerName || null,
    p_financial_institution: input.financialInstitution || null,
    p_note: input.note || null,
  });
  if (error) throw new Error(error.message);
  return data as { id: string; payment_number: string; invoice_status: string };
}

export async function createInvoiceDraft(serviceEventIds: string[]) {
  const { data, error } = await createSupabaseClient().rpc("create_invoice_draft_from_services", {
    p_service_event_ids: serviceEventIds,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "The invoice draft could not be prepared."));
  return data as { id: string; invoice_number: string; client_id: string; subtotal_etb: number; status: string };
}

export type ApprovalDetail = { title: string; client: string; status: string; fields: { label: string; value: string }[]; documentCount: number; auditCount: number };
export type ApprovalRow = { id: string; request_type: string; reference_id: string; business_reference?: string; requested_by: string; requested_at: string; status: string; decided_by: string | null; decided_at: string | null; decision_note: string | null; detail?: ApprovalDetail };
export type DocumentRow = { id: string; document_number: string; document_type: string; reference_type: string; reference_id: string; business_reference?: string; version: number; object_path: string; file_name: string; mime_type: string; size_bytes: number; status: string; created_at: string };
export type AuditRow = { id: string; actor_id: string; action: string; reference_type: string; reference_id: string; business_reference?: string; occurred_at: string; event_data: Record<string, unknown> };
export type AdminUserRow = { id: string; email: string; full_name: string; role: string; active: boolean; last_sign_in_at: string | null };
export type BusinessReference = { id: string; type: string; label: string };
export type ArrearsCaseRow = { id: string; case_number: string; client_id: string; invoice_id: string; stage: string; outstanding_etb: number; opened_on: string; oldest_due_on: string | null; next_action_on: string | null; assigned_to: string | null; notes: string | null; closed_at: string | null; created_at: string; updated_at: string };
export type ArrearsEventRow = { id: string; case_id: string; from_stage: string | null; to_stage: string; note: string; action_by: string; created_at: string };

export async function loadManagementData() {
  const db = createSupabaseClient();
  const [approvalResult, documentResult, auditResult, profileResult, receiptResult, requestResult, orderResult, dispatchResult, invoiceResult, paymentResult, lotResult, clientResult, arrearsResult, arrearsEventResult, adminUserResult] = await Promise.all([
    db.from("approvals").select("id,request_type,reference_id,requested_by,requested_at,status,decided_by,decided_at,decision_note").order("requested_at", { ascending: false }),
    db.from("documents").select("id,document_number,document_type,reference_type,reference_id,version,object_path,file_name,mime_type,size_bytes,status,created_at").order("created_at", { ascending: false }),
    db.from("audit_events").select("id,actor_id,action,reference_type,reference_id,occurred_at,event_data").order("occurred_at", { ascending: false }),
    db.from("profiles").select("id,full_name,role,active").order("full_name"),
    db.from("warehouse_receipts").select("id,receipt_number"),
    db.from("processing_requests").select("id,request_number,client_name,lot_reference,requested_kg,requested_bags,requested_preparation_type,status,notes"),
    db.from("processing_orders").select("id,order_number,completion_number"),
    db.from("dispatch_orders").select("id,dispatch_number,client_id,quantity_kg,bag_count,destination,status,documents_reference,weighbridge_reference,credit_approved"),
    db.from("invoices").select("id,invoice_number,client_id,status,total_etb,issued_on,due_on"),
    db.from("payments").select("id,payment_number,invoice_id,client_id,amount_etb,paid_at,bank_reference,direction"),
    db.from("coffee_lots").select("id,lot_number"),
    db.from("clients").select("id,code,legal_name"),
    db.from("arrears_cases").select("id,case_number,client_id,invoice_id,stage,outstanding_etb,opened_on,oldest_due_on,next_action_on,assigned_to,notes,closed_at,created_at,updated_at").order("created_at", { ascending: false }),
    db.from("arrears_case_events").select("id,case_id,from_stage,to_stage,note,action_by,created_at").order("created_at", { ascending: false }),
    db.rpc("list_admin_users"),
  ]);
  const references = new Map<string, string>();
  const businessReferences: BusinessReference[] = [];
  const addReferences = (type: string, rows: { id: string; label: string }[]) => rows.forEach((item) => { references.set(item.id, item.label); businessReferences.push({ id: item.id, type, label: item.label }); });
  addReferences("WAREHOUSE_RECEIPT", (receiptResult.data ?? []).map((item) => ({ id: item.id, label: item.receipt_number })));
  addReferences("PROCESSING_REQUEST", (requestResult.data ?? []).map((item) => ({ id: item.id, label: item.request_number })));
  addReferences("PROCESSING_ORDER", (orderResult.data ?? []).map((item) => ({ id: item.id, label: item.completion_number ?? item.order_number })));
  addReferences("DISPATCH_ORDER", (dispatchResult.data ?? []).map((item) => ({ id: item.id, label: item.dispatch_number })));
  addReferences("INVOICE", (invoiceResult.data ?? []).map((item) => ({ id: item.id, label: item.invoice_number })));
  addReferences("PAYMENT", (paymentResult.data ?? []).map((item) => ({ id: item.id, label: item.payment_number })));
  addReferences("COFFEE_LOT", (lotResult.data ?? []).map((item) => ({ id: item.id, label: item.lot_number })));
  addReferences("CLIENT", (clientResult.data ?? []).map((item) => ({ id: item.id, label: `${item.code} - ${item.legal_name}` })));
  const documents = result(documentResult.data as DocumentRow[] | null, documentResult.error).map((item) => ({ ...item, business_reference: references.get(item.reference_id) ?? item.reference_id.slice(0, 8).toUpperCase() }));
  const audit = result(auditResult.data as AuditRow[] | null, auditResult.error).map((item) => ({ ...item, business_reference: references.get(item.reference_id) ?? item.reference_id.slice(0, 8).toUpperCase() }));
  const clientNames = new Map((clientResult.data ?? []).map((item) => [item.id, item.legal_name]));
  const details = new Map<string, Omit<ApprovalDetail, "documentCount" | "auditCount">>();
  (requestResult.data ?? []).forEach((item) => details.set(item.id, {
    title: item.request_number, client: item.client_name, status: item.status,
    fields: [
      { label: "Lot", value: item.lot_reference },
      { label: "Preparation", value: item.requested_preparation_type },
      { label: "Quantity", value: `${Number(item.requested_kg).toLocaleString()} kg / ${item.requested_bags} bags` },
      { label: "Notes", value: item.notes || "-" },
    ],
  }));
  (dispatchResult.data ?? []).forEach((item) => details.set(item.id, {
    title: item.dispatch_number, client: clientNames.get(item.client_id) ?? "Unknown client", status: item.status,
    fields: [
      { label: "Quantity", value: `${Number(item.quantity_kg).toLocaleString()} kg / ${item.bag_count} bags` },
      { label: "Destination", value: item.destination || "-" },
      { label: "Documents", value: item.documents_reference || "Missing" },
      { label: "Weighbridge", value: item.weighbridge_reference || "Missing" },
      { label: "Credit cleared", value: item.credit_approved ? "Yes" : "No" },
    ],
  }));
  const approvals = result(approvalResult.data as ApprovalRow[] | null, approvalResult.error).map((item) => {
    const detail = details.get(item.reference_id);
    return {
      ...item,
      business_reference: references.get(item.reference_id) ?? item.reference_id.slice(0, 8).toUpperCase(),
      detail: detail ? { ...detail, documentCount: documents.filter((document) => document.reference_id === item.reference_id).length, auditCount: audit.filter((event) => event.reference_id === item.reference_id).length } : undefined,
    };
  });
  return {
    approvals,
    documents,
    audit,
    profiles: result(profileResult.data as ProfileRow[] | null, profileResult.error),
    adminUsers: adminUserResult.error ? [] : adminUserResult.data as AdminUserRow[],
    businessReferences,
    clients: clientResult.data ?? [],
    invoices: invoiceResult.data ?? [],
    payments: paymentResult.data ?? [],
    arrearsCases: result(arrearsResult.data as ArrearsCaseRow[] | null, arrearsResult.error),
    arrearsEvents: result(arrearsEventResult.data as ArrearsEventRow[] | null, arrearsEventResult.error),
  };
}

export async function uploadBusinessDocument(file: File, documentType: string, reference: BusinessReference) {
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("Document size must be between 1 byte and 20 MB.");
  const db = createSupabaseClient();
  const userId = await currentUserId();
  const [numberResult, previousResult] = await Promise.all([
    db.rpc("next_erp_number", { document_type: "DOCUMENT", warehouse_code: "GEL", calendar_year: new Date().getFullYear() }),
    db.from("documents").select("id,version").eq("reference_type", reference.type).eq("reference_id", reference.id).eq("document_type", documentType).order("version", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (numberResult.error) throw new Error(numberResult.error.message);
  if (previousResult.error) throw new Error(previousResult.error.message);
  const documentNumber = String(numberResult.data);
  const checksum = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectPath = `${userId}/${documentNumber}-${safeName}`;
  const upload = await db.storage.from("erp-documents").upload(objectPath, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (upload.error) throw new Error(upload.error.message);
  const { error } = await db.from("documents").insert({ document_number: documentNumber, document_type: documentType, reference_type: reference.type, reference_id: reference.id, version: Number(previousResult.data?.version ?? 0) + 1, previous_version_id: previousResult.data?.id ?? null, object_path: objectPath, file_name: file.name, mime_type: file.type || "application/octet-stream", size_bytes: file.size, checksum_sha256: checksum, status: "DRAFT", uploaded_by: userId });
  if (error) { await db.storage.from("erp-documents").remove([objectPath]); throw new Error(error.message); }
  return documentNumber;
}

export async function getBusinessDocumentUrl(objectPath: string) {
  const { data, error } = await createSupabaseClient().storage.from("erp-documents").createSignedUrl(objectPath, 60);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function createArrearsCase(invoiceId: string, note: string, nextActionOn?: string) {
  const { data, error } = await createSupabaseClient().rpc("create_arrears_case", {
    p_invoice_id: invoiceId,
    p_next_action_on: nextActionOn || null,
    p_assigned_to: null,
    p_note: note,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "The arrears case could not be opened."));
  return data as ArrearsCaseRow;
}

export async function advanceSavedArrearsCase(id: string, targetStage: string, note: string, nextActionOn?: string) {
  const { data, error } = await createSupabaseClient().rpc("advance_arrears_case", {
    p_case_id: id,
    p_target_stage: targetStage,
    p_note: note,
    p_next_action_on: nextActionOn || null,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "The arrears stage could not be saved."));
  return data as ArrearsCaseRow;
}

export async function loadOperationalReport(title: string) {
  const db = createSupabaseClient();
  const query = title === "Current stock position"
    ? db.from("coffee_lots").select("lot_number,client_id,ownership_type,coffee_type,section,status,bag_count,quantity_kg").order("lot_number")
    : title === "Warehouse receipts"
      ? db.from("warehouse_receipts").select("receipt_number,client_id,arrival_at,vehicle_plate,coffee_type,bag_count,net_weight_kg,status").order("arrival_at", { ascending: false })
      : title === "Processing reconciliation"
        ? db.from("processing_orders").select("order_number,completion_number,client_id,input_kg,accepted_client_kg,client_reject_kg,hayked_byproduct_kg,process_loss_kg,status").order("created_at", { ascending: false })
        : title === "Dispatch and ECS"
          ? db.from("dispatch_orders").select("dispatch_number,client_id,dispatch_date,dispatch_reason,destination,bag_count,quantity_kg,status").order("created_at", { ascending: false })
          : db.from("invoices").select("invoice_number,client_id,issued_on,due_on,total_etb,status").order("created_at", { ascending: false });
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = data as Record<string, unknown>[];
  const headers = rows.length ? Object.keys(rows[0]) : ["result"];
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [headers.map(escape).join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}

export type ReportType = "Stock" | "Receipts" | "Processing" | "Dispatch" | "Billing" | "Storage Loss" | "Bags" | "Labour" | "Generator" | "Arrears" | "Documents" | "Audit";
export type ReportTable = { columns: string[]; rows: { id: string; clientId: string; date: string; values: string[] }[] };

export async function loadReportTable(type: ReportType, filters: { from: string; to: string; clientId: string }): Promise<ReportTable> {
  const db = createSupabaseClient();
  const clientResult = await db.from("clients").select("id,legal_name");
  const clients = result(clientResult.data as { id: string; legal_name: string }[] | null, clientResult.error);
  const clientById = new Map(clients.map((item) => [item.id, item.legal_name]));
  const clientName = (id: string) => clientById.get(id) ?? "Unknown client";

  if (type === "Stock") {
    let query = db.from("coffee_lots").select("id,lot_number,client_id,lot_category,ownership_type,status,section,bag_count,quantity_kg").order("lot_number");
    if (filters.clientId) query = query.eq("client_id", filters.clientId);
    const { data, error } = await query;
    const rows = result(data, error) as { id: string; lot_number: string; client_id: string; lot_category: string | null; ownership_type: string; status: string; section: string; bag_count: number; quantity_kg: number }[];
    const typeLabel = (row: typeof rows[number]) => row.lot_category === "ARRIVAL" ? "Arrival" : row.lot_category === "ACCEPTED_PROCESSED" ? "Processed" : row.lot_category === "CLIENT_REJECT" ? "Reject" : row.lot_category === "HAYKED_BYPRODUCT" || row.ownership_type === "HAYKED" ? "Hayked Byproduct" : "Other";
    const statusLabel = (status: string) => ({ ARRIVAL_IN_STORAGE: "Available", WAITING_PROCESSING: "Waiting Processing", IN_PROCESS: "In Processing", PROCESSED: "Available", AWAITING_DISPATCH: "Awaiting Dispatch", IN_TRANSIT: "Reserved", DISPATCHED: "Closed", CLOSED: "Closed", REVERSED: "Reversed" } as Record<string, string>)[status] ?? status.replaceAll("_", " ");
    return { columns: ["Client", "Lot", "Type", "Status", "Section", "Bags", "KG"], rows: rows.map((row) => ({ id: row.id, clientId: row.client_id, date: "", values: [clientName(row.client_id), row.lot_number, typeLabel(row), statusLabel(row.status), row.section, String(row.bag_count), Number(row.quantity_kg).toLocaleString()] })) };
  }

  if (type === "Receipts") {
    let query = db.from("warehouse_receipts").select("id,receipt_number,client_id,arrival_at,bag_count,net_weight_kg,vehicle_plate,status").order("arrival_at", { ascending: false });
    if (filters.from) query = query.gte("arrival_at", `${filters.from}T00:00:00`);
    if (filters.to) query = query.lte("arrival_at", `${filters.to}T23:59:59`);
    if (filters.clientId) query = query.eq("client_id", filters.clientId);
    const [{ data, error }, lotsResult] = await Promise.all([query, db.from("coffee_lots").select("receipt_id,lot_number").not("receipt_id", "is", null)]);
    const rows = result(data, error) as { id: string; receipt_number: string; client_id: string; arrival_at: string; bag_count: number; net_weight_kg: number; vehicle_plate: string; status: string }[];
    const lotByReceipt = new Map((lotsResult.data ?? []).map((item) => [item.receipt_id, item.lot_number]));
    return { columns: ["Date", "GRN", "Client", "Lot", "Bags", "KG", "Vehicle", "Status"], rows: rows.map((row) => ({ id: row.id, clientId: row.client_id, date: row.arrival_at.slice(0, 10), values: [row.arrival_at.slice(0, 10), row.receipt_number, clientName(row.client_id), lotByReceipt.get(row.id) ?? "Pending", String(row.bag_count), Number(row.net_weight_kg).toLocaleString(), row.vehicle_plate, row.status.replaceAll("_", " ")] })) };
  }

  if (type === "Processing") {
    let query = db.from("processing_orders").select("id,order_number,completion_number,client_id,created_at,input_kg,accepted_client_kg,client_reject_kg,process_loss_kg,status").order("created_at", { ascending: false });
    if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00`);
    if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59`);
    if (filters.clientId) query = query.eq("client_id", filters.clientId);
    const { data, error } = await query;
    const rows = result(data, error) as { id: string; order_number: string; completion_number: string | null; client_id: string; created_at: string; input_kg: number; accepted_client_kg: number; client_reject_kg: number; process_loss_kg: number; status: string }[];
    return { columns: ["Date", "Order", "Client", "Input KG", "Processed KG", "Reject KG", "Loss KG", "Status"], rows: rows.map((row) => ({ id: row.id, clientId: row.client_id, date: row.created_at.slice(0, 10), values: [row.created_at.slice(0, 10), row.completion_number ?? row.order_number, clientName(row.client_id), Number(row.input_kg).toLocaleString(), Number(row.accepted_client_kg).toLocaleString(), Number(row.client_reject_kg).toLocaleString(), Number(row.process_loss_kg).toLocaleString(), row.status.replaceAll("_", " ")] })) };
  }

  if (type === "Dispatch") {
    let query = db.from("dispatch_orders").select("id,dispatch_number,client_id,dispatch_date,destination,bag_count,quantity_kg,status").order("dispatch_date", { ascending: false });
    if (filters.from) query = query.gte("dispatch_date", filters.from);
    if (filters.to) query = query.lte("dispatch_date", filters.to);
    if (filters.clientId) query = query.eq("client_id", filters.clientId);
    const { data, error } = await query;
    const rows = result(data, error) as { id: string; dispatch_number: string; client_id: string; dispatch_date: string; destination: string | null; bag_count: number; quantity_kg: number; status: string }[];
    return { columns: ["Date", "Dispatch", "Client", "Destination", "Bags", "KG", "Status"], rows: rows.map((row) => ({ id: row.id, clientId: row.client_id, date: row.dispatch_date, values: [row.dispatch_date, row.dispatch_number, clientName(row.client_id), row.destination ?? "-", String(row.bag_count), Number(row.quantity_kg).toLocaleString(), row.status.replaceAll("_", " ")] })) };
  }

  if (type === "Storage Loss") {
    let query = db.from("storage_losses").select("id,lot_id,measured_balance_kg,loss_kg,loss_percent,status,created_at").order("created_at", { ascending: false });
    if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00`);
    if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59`);
    const [{ data, error }, lotsResult] = await Promise.all([query, db.from("coffee_lots").select("id,lot_number,client_id")]);
    const lotById = new Map((lotsResult.data ?? []).map((lot) => [lot.id, lot]));
    const rows = (result(data, error) as { id: string; lot_id: string; measured_balance_kg: number; loss_kg: number; loss_percent: number; status: string; created_at: string }[]).filter((row) => !filters.clientId || lotById.get(row.lot_id)?.client_id === filters.clientId);
    return { columns: ["Date", "Client", "Lot", "Measured KG", "Loss KG", "Loss %", "Status"], rows: rows.map((row) => { const lot = lotById.get(row.lot_id); return { id: row.id, clientId: lot?.client_id ?? "", date: row.created_at.slice(0, 10), values: [row.created_at.slice(0, 10), clientName(lot?.client_id ?? ""), lot?.lot_number ?? "-", Number(row.measured_balance_kg).toLocaleString(), Number(row.loss_kg).toLocaleString(), `${Number(row.loss_percent).toFixed(2)}%`, row.status.replaceAll("_", " ")] }; }) };
  }

  if (type === "Bags") {
    let query = db.from("bag_printing_orders").select("id,order_number,client_id,quantity,unit_rate,total_amount,status,created_at").order("created_at", { ascending: false });
    if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00`);
    if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59`);
    if (filters.clientId) query = query.eq("client_id", filters.clientId);
    const { data, error } = await query;
    const rows = result(data, error) as { id: string; order_number: string; client_id: string; quantity: number; unit_rate: number; total_amount: number; status: string; created_at: string }[];
    return { columns: ["Date", "Order", "Client", "Bags", "Rate", "Amount", "Status"], rows: rows.map((row) => ({ id: row.id, clientId: row.client_id, date: row.created_at.slice(0, 10), values: [row.created_at.slice(0, 10), row.order_number, clientName(row.client_id), Number(row.quantity).toLocaleString(), `ETB ${Number(row.unit_rate).toLocaleString()}`, `ETB ${Number(row.total_amount).toLocaleString()}`, row.status.replaceAll("_", " ")] })) };
  }

  if (type === "Labour") {
    let query = db.from("labour_records").select("id,labour_number,work_date,client_id,activity,quantity,unit_label,internal_cost_etb,client_charge_etb,service_event_id").order("work_date", { ascending: false });
    if (filters.from) query = query.gte("work_date", filters.from);
    if (filters.to) query = query.lte("work_date", filters.to);
    if (filters.clientId) query = query.eq("client_id", filters.clientId);
    const { data, error } = await query;
    const rows = result(data, error) as { id: string; labour_number: string; work_date: string; client_id: string; activity: string; quantity: number; unit_label: string; internal_cost_etb: number; client_charge_etb: number; service_event_id: string | null }[];
    return { columns: ["Date", "Reference", "Client", "Activity", "Quantity", "Internal Cost", "Client Charge", "Billing"], rows: rows.map((row) => ({ id: row.id, clientId: row.client_id, date: row.work_date, values: [row.work_date, row.labour_number, clientName(row.client_id), row.activity, `${Number(row.quantity).toLocaleString()} ${row.unit_label}`, `ETB ${Number(row.internal_cost_etb).toLocaleString()}`, `ETB ${Number(row.client_charge_etb).toLocaleString()}`, row.service_event_id ? "Ready" : "Not linked"] })) };
  }

  if (type === "Generator") {
    let query = db.from("generator_usage_requests").select("id,request_number,client_id,diesel_litres,unit_cost,total_cost,status,created_at").order("created_at", { ascending: false });
    if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00`);
    if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59`);
    if (filters.clientId) query = query.eq("client_id", filters.clientId);
    const { data, error } = await query;
    const rows = result(data, error) as { id: string; request_number: string; client_id: string; diesel_litres: number; unit_cost: number; total_cost: number; status: string; created_at: string }[];
    return { columns: ["Date", "Request", "Client", "Diesel L", "Unit Cost", "Total", "Status"], rows: rows.map((row) => ({ id: row.id, clientId: row.client_id, date: row.created_at.slice(0, 10), values: [row.created_at.slice(0, 10), row.request_number, clientName(row.client_id), Number(row.diesel_litres).toLocaleString(), `ETB ${Number(row.unit_cost).toLocaleString()}`, `ETB ${Number(row.total_cost).toLocaleString()}`, row.status.replaceAll("_", " ")] })) };
  }

  if (type === "Arrears") {
    let query = db.from("arrears_cases").select("id,case_number,client_id,stage,outstanding_etb,opened_on,oldest_due_on,next_action_on").order("opened_on", { ascending: false });
    if (filters.from) query = query.gte("opened_on", filters.from);
    if (filters.to) query = query.lte("opened_on", filters.to);
    if (filters.clientId) query = query.eq("client_id", filters.clientId);
    const { data, error } = await query;
    const rows = result(data, error) as { id: string; case_number: string; client_id: string; stage: string; outstanding_etb: number; opened_on: string; oldest_due_on: string | null; next_action_on: string | null }[];
    return { columns: ["Opened", "Case", "Client", "Outstanding", "Oldest Due", "Next Action", "Stage"], rows: rows.map((row) => ({ id: row.id, clientId: row.client_id, date: row.opened_on, values: [row.opened_on, row.case_number, clientName(row.client_id), `ETB ${Number(row.outstanding_etb).toLocaleString()}`, row.oldest_due_on ?? "-", row.next_action_on ?? "-", row.stage.replaceAll("_", " ")] })) };
  }

  if (type === "Documents") {
    let query = db.from("documents").select("id,document_number,document_type,reference_type,version,file_name,status,created_at").order("created_at", { ascending: false });
    if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00`);
    if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59`);
    const { data, error } = await query;
    const rows = result(data, error) as { id: string; document_number: string; document_type: string; reference_type: string; version: number; file_name: string; status: string; created_at: string }[];
    return { columns: ["Date", "Document", "Type", "Linked Record", "Version", "File", "Status"], rows: rows.map((row) => ({ id: row.id, clientId: "", date: row.created_at.slice(0, 10), values: [row.created_at.slice(0, 10), row.document_number, row.document_type.replaceAll("_", " "), row.reference_type.replaceAll("_", " "), `v${row.version}`, row.file_name, row.status.replaceAll("_", " ")] })) };
  }

  if (type === "Audit") {
    let query = db.from("audit_events").select("id,actor_id,action,reference_type,reference_id,occurred_at").order("occurred_at", { ascending: false });
    if (filters.from) query = query.gte("occurred_at", `${filters.from}T00:00:00`);
    if (filters.to) query = query.lte("occurred_at", `${filters.to}T23:59:59`);
    const [{ data, error }, profileResult] = await Promise.all([query, db.from("profiles").select("id,full_name")]);
    const profileById = new Map((profileResult.data ?? []).map((profile) => [profile.id, profile.full_name]));
    const rows = result(data, error) as { id: string; actor_id: string; action: string; reference_type: string; reference_id: string; occurred_at: string }[];
    return { columns: ["Date & Time", "User", "Module", "Action", "Reference"], rows: rows.map((row) => ({ id: row.id, clientId: "", date: row.occurred_at.slice(0, 10), values: [new Date(row.occurred_at).toLocaleString(), profileById.get(row.actor_id) ?? "Unknown user", row.reference_type.replaceAll("_", " "), row.action.replaceAll("_", " "), row.reference_id.slice(0, 8).toUpperCase()] })) };
  }

  let query = db.from("invoices").select("id,invoice_number,client_id,issued_on,total_etb,status").order("issued_on", { ascending: false });
  if (filters.from) query = query.gte("issued_on", filters.from);
  if (filters.to) query = query.lte("issued_on", filters.to);
  if (filters.clientId) query = query.eq("client_id", filters.clientId);
  const { data, error } = await query;
  const rows = result(data, error) as { id: string; invoice_number: string; client_id: string; issued_on: string | null; total_etb: number; status: string }[];
  return { columns: ["Date", "Reference", "Client", "Type", "Amount", "Status"], rows: rows.map((row) => ({ id: row.id, clientId: row.client_id, date: row.issued_on ?? "", values: [row.issued_on ?? "-", row.invoice_number, clientName(row.client_id), "Invoice", `ETB ${Number(row.total_etb).toLocaleString()}`, row.status.replaceAll("_", " ")] })) };
}

export async function decideApproval(id: string, decision: "APPROVED" | "REJECTED", note: string) {
  const { error } = await createSupabaseClient().rpc("decide_approval", { approval_id: id, decision, note });
  if (error) throw new Error(error.message);
}

export async function createAdminUser(input: { email: string; fullName: string; role: string; password: string }) {
  const db = createSupabaseClient();
  const { data } = await db.auth.getSession();
  const response = await fetch("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: JSON.stringify(input),
  });
  const payload = await response.json() as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "User account could not be created.");
}

export async function updateProfile(id: string, role: string, active: boolean) {
  const { error } = await createSupabaseClient().rpc("update_admin_profile", { p_profile_id: id, p_role: role, p_active: active });
  if (error) throw new Error(error.message);
}

export type WarehouseControlData = {
  currentUserId: string;
  clients: ClientRow[];
  lots: LotRow[];
  profiles: ProfileRow[];
  processingOrders: { id: string; order_number: string; client_id: string; lot_id: string; status: string }[];
  bagOrders: { id: string; order_number: string; client_id: string; lot_id: string | null; quantity: number; unit_rate: number; total_amount: number; status: string }[];
  generatorRequests: { id: string; request_number: string; client_id: string; lot_id: string | null; processing_order_id: string | null; diesel_litres: number; unit_cost: number; total_cost: number; status: string }[];
  labourSettings: { id: string; fixed_addition_etb: number; effective_from: string; effective_to: string | null; active: boolean }[];
  labourRecords: { id: string; labour_number: string; work_date: string; client_id: string; lot_id: string | null; processing_order_id: string | null; dispatch_id: string | null; activity: string; quantity: number; unit_label: string; internal_cost_etb: number; charge_addition_etb: number; client_charge_etb: number; note: string | null; external_reference: string | null; service_event_id: string | null; created_at: string }[];
  storageLosses: { id: string; lot_id: string; measured_balance_kg: number; loss_kg: number; loss_percent: number; status: string; created_at: string }[];
  manualServices: { id: string; service_number: string; client_id: string; processing_order_id: string | null; service_code: string; service_date: string; description: string; quantity: number; unit_label: string; unit_price: number; total_amount: number; approved_by: string; evidence_reference: string | null; note: string | null; service_event_id: string; created_at: string }[];
  serviceRates: { id: string; service_code: string; description: string; unit_label: string; unit_price: number; effective_from: string; effective_to: string | null; active: boolean }[];
  storageRentRecords: StorageRentRecordRow[];
};

export async function loadWarehouseControlData(): Promise<WarehouseControlData> {
  const db = createSupabaseClient();
  const userId = await currentUserId();
  const [clients, lots, profiles, processingOrders, bagOrders, generatorRequests, labourSettings, labourRecords, storageLosses, manualServices, serviceRates, storageRentRecords] = await Promise.all([
    db.from("clients").select("id,code,legal_name,tin,active").order("legal_name"),
    db.from("coffee_lots").select("id,lot_number,receipt_id,client_id,coffee_type,bag_count,quantity_kg,section,status").order("lot_number"),
    db.from("profiles").select("id,full_name,role,active").order("full_name"),
    db.from("processing_orders").select("id,order_number,client_id,lot_id,status").order("created_at", { ascending: false }),
    db.from("bag_printing_orders").select("id,order_number,client_id,lot_id,quantity,unit_rate,total_amount,status").order("created_at", { ascending: false }),
    db.from("generator_usage_requests").select("id,request_number,client_id,lot_id,processing_order_id,diesel_litres,unit_cost,total_cost,status").order("created_at", { ascending: false }),
    db.from("labour_charge_settings").select("id,fixed_addition_etb,effective_from,effective_to,active").order("effective_from", { ascending: false }),
    db.from("labour_records").select("id,labour_number,work_date,client_id,lot_id,processing_order_id,dispatch_id,activity,quantity,unit_label,internal_cost_etb,charge_addition_etb,client_charge_etb,note,external_reference,service_event_id,created_at").order("created_at", { ascending: false }),
    db.from("storage_losses").select("id,lot_id,measured_balance_kg,loss_kg,loss_percent,status,created_at").order("created_at", { ascending: false }),
    db.from("manual_service_records").select("id,service_number,client_id,processing_order_id,service_code,service_date,description,quantity,unit_label,unit_price,total_amount,approved_by,evidence_reference,note,service_event_id,created_at").order("created_at", { ascending: false }),
    db.from("service_rate_catalog").select("id,service_code,description,unit_label,unit_price,effective_from,effective_to,active").eq("active", true).order("service_code").order("effective_from", { ascending: false }),
    db.from("storage_rent_records").select("id,rent_number,client_id,lot_id,storage_category,charge_start_on,billed_through_on,status,evidence_reference,note,recorded_by,created_at,updated_at").order("created_at", { ascending: false }),
  ]);
  return {
    currentUserId: userId,
    clients: result(clients.data as ClientRow[] | null, clients.error),
    lots: result(lots.data as LotRow[] | null, lots.error),
    profiles: result(profiles.data as ProfileRow[] | null, profiles.error),
    processingOrders: result(processingOrders.data as WarehouseControlData["processingOrders"] | null, processingOrders.error),
    bagOrders: result(bagOrders.data as WarehouseControlData["bagOrders"] | null, bagOrders.error),
    generatorRequests: result(generatorRequests.data as WarehouseControlData["generatorRequests"] | null, generatorRequests.error),
    labourSettings: result(labourSettings.data as WarehouseControlData["labourSettings"] | null, labourSettings.error),
    labourRecords: result(labourRecords.data as WarehouseControlData["labourRecords"] | null, labourRecords.error),
    storageLosses: result(storageLosses.data as WarehouseControlData["storageLosses"] | null, storageLosses.error),
    manualServices: result(manualServices.data as WarehouseControlData["manualServices"] | null, manualServices.error),
    serviceRates: result(serviceRates.data as WarehouseControlData["serviceRates"] | null, serviceRates.error),
    storageRentRecords: result(storageRentRecords.data as StorageRentRecordRow[] | null, storageRentRecords.error),
  };
}

export async function postManualService(input: {
  clientId: string;
  serviceCode: string;
  serviceDate: string;
  description: string;
  quantity: number;
  unitLabel: string;
  unitPrice: number;
  approvedBy: string;
  processingOrderId?: string | null;
  evidenceReference?: string;
  note?: string;
}) {
  const { data, error } = await createSupabaseClient().rpc("post_manual_service_record", {
    p_client_id: input.clientId,
    p_service_code: input.serviceCode,
    p_service_date: input.serviceDate,
    p_description: input.description,
    p_quantity: input.quantity,
    p_unit_label: input.unitLabel,
    p_unit_price: input.unitPrice,
    p_approved_by: input.approvedBy,
    p_processing_order_id: input.processingOrderId ?? null,
    p_evidence_reference: input.evidenceReference?.trim() || null,
    p_note: input.note?.trim() || null,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "The service could not be recorded."));
  return data as { id: string; service_number: string; service_event_id: string; total_amount: number };
}

export async function recordStorageRent(input: {
  clientId: string;
  lotId: string;
  storageCategory: string;
  chargeStartOn: string;
  evidenceReference?: string;
  note?: string;
}) {
  const { data, error } = await createSupabaseClient().rpc("record_storage_rent", {
    p_client_id: input.clientId,
    p_lot_id: input.lotId,
    p_storage_category: input.storageCategory,
    p_charge_start_on: input.chargeStartOn,
    p_evidence_reference: input.evidenceReference?.trim() || null,
    p_note: input.note?.trim() || null,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "Warehouse rent could not be recorded."));
  return data as StorageRentRecordRow;
}

export async function postLabourEntry(input: {
  clientId: string;
  workDate: string;
  activity: string;
  quantity: number;
  unitLabel: string;
  internalCostEtb: number;
  lotId?: string | null;
  processingOrderId?: string | null;
  note?: string;
  externalReference?: string;
}) {
  const { data, error } = await createSupabaseClient().rpc("post_labour_entry", {
    p_client_id: input.clientId,
    p_work_date: input.workDate,
    p_activity: input.activity,
    p_quantity: input.quantity,
    p_unit_label: input.unitLabel,
    p_internal_cost_etb: input.internalCostEtb,
    p_lot_id: input.lotId ?? null,
    p_processing_order_id: input.processingOrderId ?? null,
    p_dispatch_id: null,
    p_note: input.note ?? null,
    p_external_reference: input.externalReference ?? null,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "The labour entry could not be recorded."));
  const posted = data as { labour_number: string; internal_cost_etb: number; charge_addition_etb: number; client_charge_etb: number; service_event_id: string };
  const record = await createSupabaseClient().from("labour_records").select("id").eq("labour_number", posted.labour_number).maybeSingle();
  if (record.error || !record.data) throw new Error(friendlyDatabaseError(record.error, "The labour entry was posted but its document link could not be prepared."));
  return { ...posted, id: record.data.id as string };
}

export async function postStorageLoss(input: {
  lotId: string;
  lossKg: number;
  evidenceAttached: boolean;
  managerApprovedBy: string;
  exceptionApprovedBy?: string | null;
  wetCoffeeJointApproved?: boolean;
}) {
  const { data, error } = await createSupabaseClient().rpc("post_storage_loss", {
    p_lot_id: input.lotId,
    p_loss_kg: input.lossKg,
    p_evidence_attached: input.evidenceAttached,
    p_manager_approved_by: input.managerApprovedBy,
    p_exception_approved_by: input.exceptionApprovedBy ?? null,
    p_wet_coffee_joint_approved: input.wetCoffeeJointApproved ?? false,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "Failed to record storage loss."));
  return data as string;
}

export async function postBagPrintingOrder(input: {
  clientId: string;
  lotId?: string | null;
  quantity: number;
  approvedBy: string;
}) {
  const { data, error } = await createSupabaseClient().rpc("post_bag_printing_order", {
    p_client_id: input.clientId,
    p_lot_id: input.lotId ?? null,
    p_quantity: input.quantity,
    p_approved_by: input.approvedBy,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "Failed to record bag printing order."));
  return data as string;
}

export async function postGeneratorRequest(input: {
  clientId: string;
  processingOrderId: string;
  dieselLitres: number;
  unitCost: number;
  approvedBy: string;
}) {
  const { data, error } = await createSupabaseClient().rpc("post_generator_request_v2", {
    p_client_id: input.clientId,
    p_processing_order_id: input.processingOrderId,
    p_diesel_litres: input.dieselLitres,
    p_unit_cost: input.unitCost,
    p_approved_by: input.approvedBy,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "Failed to record generator request."));
  return data as string;
}

export async function quoteStorageBilling(input: {
  clientId: string;
  lotId: string;
  category: string;
  periodStart: string;
  periodEnd: string;
  tariffVersion: string;
  certified: boolean;
}) {
  const { data, error } = await createSupabaseClient().rpc("quote_storage_billing", {
    p_client_id: input.clientId,
    p_lot_id: input.lotId,
    p_category: input.category,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_tariff_version: input.tariffVersion,
    p_certified: input.certified,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "The storage quote could not be calculated."));
  return data as StorageQuote;
}

export async function runStorageBilling(input: {
  clientId: string;
  lotId: string;
  category: string;
  periodStart: string;
  periodEnd: string;
  tariffVersion: string;
  certified: boolean;
}) {
  const { data, error } = await createSupabaseClient().rpc("calculate_and_save_storage_billing_v2", {
    p_client_id: input.clientId,
    p_lot_id: input.lotId,
    p_category: input.category,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_tariff_version: input.tariffVersion,
    p_certified: input.certified,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "Failed to run storage billing."));
  return data as string;
}

export async function postStorageRentBilling(input: {
  rentRecordId: string;
  periodEnd: string;
  tariffVersion: string;
}) {
  const { data, error } = await createSupabaseClient().rpc("post_storage_rent_billing", {
    p_rent_record_id: input.rentRecordId,
    p_period_end: input.periodEnd,
    p_tariff_version: input.tariffVersion,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "Warehouse rent billing could not be posted."));
  return data as { rent_record_id: string; storage_billing_run_id: string; period_start: string; period_end: string };
}

export async function postEcsTransfer(input: {
  lotId: string;
  destinationWarehouseId: string;
  sentKg: number;
  vehiclePlate?: string | null;
}) {
  const { data, error } = await createSupabaseClient().rpc("post_ecs_transfer", {
    p_lot_id: input.lotId,
    p_destination_warehouse_id: input.destinationWarehouseId,
    p_sent_kg: input.sentKg,
    p_vehicle_plate: input.vehiclePlate ?? null,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "Failed to submit ECS transfer."));
  return data as string;
}

export async function receiveEcsTransfer(input: {
  transferId: string;
  receivedKg: number;
  destinationSection?: string;
  varianceApprovedBy?: string | null;
}) {
  const { data, error } = await createSupabaseClient().rpc("receive_ecs_transfer", {
    p_transfer_id: input.transferId,
    p_received_kg: input.receivedKg,
    p_destination_section: input.destinationSection ?? "A-01 Arrival",
    p_variance_approved_by: input.varianceApprovedBy ?? null,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "Failed to receive ECS transfer."));
  return data as string;
}

export async function postOwnershipTransfer(input: {
  sourceLotId: string;
  destinationClientId: string;
  quantityKg: number;
  signedInstructionPath: string;
  haykedApprovedBy: string;
}) {
  const { data, error } = await createSupabaseClient().rpc("post_ownership_transfer", {
    p_source_lot_id: input.sourceLotId,
    p_destination_client_id: input.destinationClientId,
    p_quantity_kg: input.quantityKg,
    p_signed_instruction_path: input.signedInstructionPath,
    p_hayked_approved_by: input.haykedApprovedBy,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "Failed to post ownership transfer."));
  return data as string;
}

export async function verifyTariffVersion(tariffVersionId: string) {
  const { data, error } = await createSupabaseClient().rpc("verify_tariff_version", {
    p_tariff_version_id: tariffVersionId,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "Failed to verify tariff version."));
  return data as string;
}

export async function scheduleProcessingMachine(input: {
  orderId: string;
  machineName: string;
  shiftName: string;
  scheduledDate: string;
  allocatedHours: number;
  capacityKgPerHr: number;
}) {
  const { data, error } = await createSupabaseClient().rpc("schedule_processing_machine", {
    p_order_id: input.orderId,
    p_machine_name: input.machineName,
    p_shift_name: input.shiftName,
    p_scheduled_date: input.scheduledDate,
    p_allocated_hours: input.allocatedHours,
    p_capacity_kg_per_hr: input.capacityKgPerHr,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "Failed to schedule processing machine."));
  return data as string;
}

export async function exportAccountingGeneralLedger(periodStart: string, periodEnd: string) {
  const { data, error } = await createSupabaseClient().rpc("export_accounting_general_ledger", {
    p_start_date: periodStart,
    p_end_date: periodEnd,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "Failed to export general ledger."));
  return data as Array<{ account_code: string; account_name: string; debit_etb: number; credit_etb: number; entry_count: number }>;
}

export type EligibleProcessingLot = {
  lot_id: string;
  lot_number: string;
  client_id: string;
  client_name: string;
  lot_category: "ARRIVAL" | "ACCEPTED_PROCESSED" | "CLIENT_REJECT" | "HAYKED_BYPRODUCT" | "OTHER";
  source_type: "ARRIVAL" | "REJECT" | "PROCESSED";
  source_document: string | null;
  coffee_type: string;
  origin: string | null;
  grade: string;
  crop_year: number | null;
  section: string;
  bag_count: number;
  quantity_kg: number;
  reserved_kg: number;
  reserved_bags: number;
  available_kg: number;
  available_bags: number;
  receipt_id?: string | null;
  parent_lot_id?: string | null;
  source_processing_order_id?: string | null;
  status: string;
  created_at: string;
};

export async function listEligibleProcessingLots(clientId: string, sourceType?: EligibleProcessingLot["source_type"], search = "", limit = 10): Promise<EligibleProcessingLot[]> {
  if (!clientId) return [];
  const { data, error } = await createSupabaseClient().rpc("list_eligible_processing_lots", {
    p_client_id: clientId,
    p_source_type: sourceType ?? null,
    p_search: search || null,
    p_limit: limit,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "Failed to load eligible processing lots for client."));
  return (data ?? []) as EligibleProcessingLot[];
}

export async function validateProcessingSourceLot(lotId: string, clientId: string, requestedKg: number): Promise<boolean> {
  const { data, error } = await createSupabaseClient().rpc("validate_processing_source_lot", {
    p_lot_id: lotId,
    p_client_id: clientId,
    p_requested_kg: requestedKg,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "Source lot validation failed."));
  return Boolean(data);
}
