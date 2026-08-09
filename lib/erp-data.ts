import { createSupabaseClient } from "./supabase/client";
import { activeOn, clientReadiness } from "@/app/client-onboarding";
import type { CoffeeLot, StockMovement, WarehouseReceipt } from "@/app/grn-workflow";
import type { ProcessingOutputLine, ProcessingRequest, ProcessingRequestLine } from "@/app/processing-workflow";

type DbError = { message: string; code?: string } | null;

export function friendlyDatabaseError(error: DbError, fallback = "The record could not be saved.") {
  if (!error) return fallback;
  if (error.code === "23505") return "This reference number already exists.";
  if (error.code === "PGRST116" || error.message.includes("Cannot coerce")) return "The selected record was not found. Refresh the page and select it again.";
  if (error.code === "42501" || /permission|policy|row-level security/i.test(error.message)) return "Your account does not have permission to perform this action.";
  if (/JWT|API key|not signed in/i.test(error.message)) return "Your session is not valid. Sign in again.";
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

export type ClientRow = { id: string; code: string; legal_name: string; tin: string | null; active: boolean };
type AgreementRow = { id: string; client_id: string; agreement_number: string; effective_from: string; effective_to: string | null; tariff_version: string; status: string };
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
};
export type LotRow = { id: string; lot_number: string; receipt_id: string | null; client_id: string; coffee_type: "WASHED" | "UNWASHED_UG"; bag_count: number; quantity_kg: number; section: string; status: CoffeeLot["status"]; lot_category?: EligibleProcessingLot["lot_category"]; parent_lot_id?: string | null; source_processing_order_id?: string | null };
type MovementRow = { id: string; lot_id: string; movement_type: StockMovement["type"]; quantity_kg: number; bag_delta: number; reference_id: string };
export type ProfileRow = { id: string; full_name: string; role: string; active: boolean };

export type CoreClient = { id: string; code: string; name: string; tin: string; agreement: string; stock: string; status: string };
export type CoreAgreement = { id: string; clientId: string; number: string; client: string; source: string; effective: string; effectiveFrom: string; expiry: string; effectiveTo: string | null; tariff: string; status: string };
export type CoreRepresentative = { id: string; clientId: string; name: string; identityNumber: string; client: string; phone: string; scope: string; validFrom: string; expiry: string; validTo: string | null; status: string };

export type CoreData = {
  clients: CoreClient[];
  agreements: CoreAgreement[];
  representatives: CoreRepresentative[];
  warehouses: WarehouseRow[];
  receipts: WarehouseReceipt[];
  lots: CoffeeLot[];
  movements: StockMovement[];
};

export type DashboardData = {
  metrics: { label: string; value: number; unit: string; detail: string }[];
  mini: { label: string; value: string; detail: string }[];
  movements: { day: string; received: number; dispatched: number }[];
  attention: { count: number; label: string; note: string; tone: "red" | "amber" }[];
  activities: string[][];
  pendingApprovals: number;
};

export async function loadDashboardData(): Promise<DashboardData> {
  const db = createSupabaseClient();
  const [lotResult, orderResult, movementResult, approvalResult, agreementResult, invoiceResult, auditResult, profileResult] = await Promise.all([
    db.from("coffee_lots").select("id,lot_category,ownership_type,bag_count,quantity_kg,status"),
    db.from("processing_orders").select("status,input_kg"),
    db.from("stock_movements").select("movement_type,quantity_kg,occurred_at").order("occurred_at"),
    db.from("approvals").select("request_type,status"),
    db.from("agreements").select("status,effective_to"),
    db.from("invoices").select("status"),
    db.from("audit_events").select("action,reference_type,reference_id,event_data,occurred_at,actor_id").order("occurred_at", { ascending: false }).limit(8),
    db.from("profiles").select("id,full_name"),
  ]);
  const lots = result(lotResult.data, lotResult.error) as { lot_category: string | null; ownership_type: string; bag_count: number; quantity_kg: number; status: string }[];
  const orders = result(orderResult.data, orderResult.error) as { status: string; input_kg: number }[];
  const movements = result(movementResult.data, movementResult.error) as { movement_type: string; quantity_kg: number; occurred_at: string }[];
  const approvals = result(approvalResult.data, approvalResult.error) as { request_type: string; status: string }[];
  const agreements = result(agreementResult.data, agreementResult.error) as { status: string; effective_to: string | null }[];
  const invoices = result(invoiceResult.data, invoiceResult.error) as { status: string }[];
  const audits = result(auditResult.data, auditResult.error) as { action: string; reference_type: string; reference_id: string; event_data: Record<string, unknown>; occurred_at: string; actor_id: string }[];
  const profiles = result(profileResult.data, profileResult.error) as { id: string; full_name: string }[];
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
  return {
    metrics: [
      { label: "Total Coffee in Warehouse", value: total.kg, unit: "kg", detail: `${total.bags.toLocaleString()} bags` },
      { label: "Arrival Coffee", value: arrival.kg, unit: "kg", detail: `${arrival.bags.toLocaleString()} bags` },
      { label: "Processed Coffee", value: processed.kg, unit: "kg", detail: `${processed.bags.toLocaleString()} bags` },
      { label: "Client Rejects", value: rejects.kg, unit: "kg", detail: `${rejects.bags.toLocaleString()} bags` },
    ],
    mini: [
      { label: "Coffee in Processing", value: `${orders.filter((item) => item.status === "IN_PROCESS").reduce((sum, item) => sum + Number(item.input_kg), 0).toLocaleString()} kg`, detail: `${orders.filter((item) => item.status === "IN_PROCESS").length} active orders` },
      { label: "Waiting for Processing", value: `${orders.filter((item) => item.status === "QUEUED").length} orders`, detail: `${orders.filter((item) => item.status === "QUEUED").reduce((sum, item) => sum + Number(item.input_kg), 0).toLocaleString()} kg queued` },
      { label: "Awaiting Dispatch", value: `${activeLots.filter((item) => item.status === "AWAITING_DISPATCH").length} lots`, detail: "Approved stock ready for release checks" },
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
  };
}

export async function loadCoreData(): Promise<CoreData> {
  const db = createSupabaseClient();
  const [clientResult, agreementResult, representativeResult, warehouseResult, receiptResult, lotResult, movementResult, profileResult] = await Promise.all([
    db.from("clients").select("id,code,legal_name,tin,active").order("code"),
    db.from("agreements").select("id,client_id,agreement_number,effective_from,effective_to,tariff_version,status").order("agreement_number"),
    db.from("authorized_representatives").select("id,client_id,full_name,identity_number,phone,valid_from,valid_to,active").order("full_name"),
    db.from("warehouses").select("id,name").eq("active", true),
    db.from("warehouse_receipts").select("*").order("created_at", { ascending: false }),
    db.from("coffee_lots").select("id,lot_number,receipt_id,client_id,coffee_type,bag_count,quantity_kg,section,status").order("created_at", { ascending: false }),
    db.from("stock_movements").select("id,lot_id,movement_type,quantity_kg,bag_delta,reference_id").order("occurred_at", { ascending: false }),
    db.from("profiles").select("id,full_name,role,active"),
  ]);
  const clients = result(clientResult.data as ClientRow[] | null, clientResult.error);
  const agreements = result(agreementResult.data as AgreementRow[] | null, agreementResult.error);
  const representatives = result(representativeResult.data as RepresentativeRow[] | null, representativeResult.error);
  const warehouses = result(warehouseResult.data as WarehouseRow[] | null, warehouseResult.error);
  const receipts = result(receiptResult.data as ReceiptRow[] | null, receiptResult.error);
  const lots = result(lotResult.data as LotRow[] | null, lotResult.error);
  const movements = result(movementResult.data as MovementRow[] | null, movementResult.error);
  const profiles = result(profileResult.data as ProfileRow[] | null, profileResult.error);
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
      id: item.id, code: item.code, name: item.legal_name, tin: item.tin ?? "-",
      agreement: agreements.find((agreement) => agreement.client_id === item.id && agreement.status === "ACTIVE")?.agreement_number ?? "No active agreement",
      stock: `${(stockByClient.get(item.id) ?? 0).toLocaleString()} kg`,
      status: clientReadiness(item.active, readyAgreementClients.has(item.id), readyRepresentativeClients.has(item.id)),
    })),
    agreements: agreements.map((item) => ({
      id: item.id, clientId: item.client_id, number: item.agreement_number, client: clientById.get(item.client_id)?.legal_name ?? "Unknown client",
      source: "001/2018", effective: item.effective_from, effectiveFrom: item.effective_from, expiry: item.effective_to ?? "Open-ended",
      effectiveTo: item.effective_to, tariff: item.tariff_version, status: item.status,
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
      receivedBy: profileById.get(item.prepared_by)?.full_name ?? "-", createdBy: profileById.get(item.prepared_by)?.full_name ?? "-",
      status: item.status, lotNumber: lotByReceipt.get(item.id)?.lot_number,
    })),
    lots: lots.map((item) => {
      const receipt = item.receipt_id ? receiptById.get(item.receipt_id) : undefined;
      return {
        databaseId: item.id, lotNumber: item.lot_number, sourceGrn: receipt?.receipt_number ?? "Derived lot",
        client: clientById.get(item.client_id)?.legal_name ?? "Hayked", coffee: item.coffee_type === "WASHED" ? "Washed" : "Unwashed / UG",
        grade: receipt?.grade ?? "-", section: item.section, bags: item.bag_count, weightKg: Number(item.quantity_kg), status: item.status,
      };
    }),
    movements: movements.map((item) => ({
      databaseId: item.id, id: item.id.slice(0, 8).toUpperCase(), sourceGrn: receiptById.get(item.reference_id)?.receipt_number ?? item.reference_id.slice(0, 8),
      lotNumber: lotById.get(item.lot_id)?.lot_number ?? "Unknown lot", type: item.movement_type,
      bagsDelta: item.bag_delta, weightDeltaKg: Number(item.quantity_kg),
    })),
  };
}

export type NewClient = { code: string; legalName: string; tin: string; phone: string; email: string };
export type NewAgreement = { clientId: string; agreementNumber: string; effectiveFrom: string; effectiveTo: string | null; status: "DRAFT" | "ACTIVE"; defaultBagWeightKg: number; tariffVersion: string };
export type NewRepresentative = { clientId: string; fullName: string; identityNumber: string; phone: string; validFrom: string; validTo: string | null; active: boolean };

export async function createClient(client: NewClient) {
  const db = createSupabaseClient();
  const [organization, userId] = await Promise.all([
    db.from("organizations").select("id").eq("code", "HAYKED").single(),
    currentUserId(),
  ]);
  const organizationData = result(organization.data, organization.error);
  const { error } = await db.from("clients").insert({
    organization_id: organizationData.id, code: client.code.trim(), legal_name: client.legalName.trim(),
    tin: client.tin.trim() || null, phone: client.phone.trim() || null, email: client.email.trim() || null,
    active: true, created_by: userId,
  });
  if (error) throw new Error(error.message);
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
  });
  if (error) throw new Error(friendlyDatabaseError(error, "The GRN could not be saved."));
  return String(numberResult.data);
}

export async function updateWarehouseReceiptDraft(receipt: WarehouseReceipt) {
  if (!receipt.databaseId || !receipt.clientDatabaseId || !receipt.agreementDatabaseId || !receipt.representativeDatabaseId) {
    throw new Error("Refresh the page before editing this GRN.");
  }
  const { error } = await createSupabaseClient().rpc("update_grn_draft", {
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
  scanned_document_attached: boolean; status: ProcessingRequest["status"]; queued_order_id: string | null;
};
export type ProcessingRequestLineRow = { id: string; request_id: string; line_number: number; lot_id: string; requested_preparation_type: string; grade: string; requested_bags: number; requested_kg: number; certifications: ProcessingRequest["certifications"]; special_instruction: string | null; remark: string | null };
export type ProcessingOrderInputRow = { id: string; order_id: string; request_line_id: string | null; lot_id: string; input_bags: number; input_kg: number };
export type ProcessingIntakeRow = { id: string; intake_number: string; order_id: string; intake_at: string; input_bags: number; input_kg: number; scale_reference: string; warehouse_issue_reference: string; machine_line: string; shift_name: string; received_by: string; client_monitor_present: boolean; client_monitor_name: string | null; intake_condition: string; evidence_path: string | null };
export type ProcessingOutputRow = { id: string; order_id: string; line_number: number; category: ProcessingOutputLine["category"]; owner_type: "CLIENT" | "HAYKED" | "NONE"; coffee_type: "WASHED" | "UNWASHED_UG" | null; grade: string | null; preparation: string | null; bag_count: number; bag_weight_kg: number | null; quantity_kg: number; warehouse_section: string | null; certifications: ProcessingRequest["certifications"]; weighing_reference: string | null; evidence_path: string | null; reason: string | null; child_lot_id: string | null };
export type ProcessingOutputSourceRow = { output_id: string; input_id: string };
export type ProcessingReservationRow = { id: string; processing_order_id: string | null; lot_id: string; reserved_bags: number; reserved_kg: number; status: "ACTIVE" | "CONSUMED" | "RELEASED" };

export type ProcessingData = {
  requests: ProcessingRequest[];
  orders: ProcessingOrderRow[];
  requestLines: ProcessingRequestLineRow[];
  orderInputs: ProcessingOrderInputRow[];
  intakes: ProcessingIntakeRow[];
  outputs: ProcessingOutputRow[];
  outputSources: ProcessingOutputSourceRow[];
  reservations: ProcessingReservationRow[];
  clients: ClientRow[];
  lots: LotRow[];
  representatives: RepresentativeRow[];
  profiles: ProfileRow[];
  receipts: Pick<ReceiptRow, "id" | "receipt_number" | "grade" | "origin" | "crop_year" | "bag_weight_kg">[];
};

export async function loadProcessingData(): Promise<ProcessingData> {
  const db = createSupabaseClient();
  const [requestResult, orderResult, requestLineResult, orderInputResult, intakeResult, outputResult, outputSourceResult, reservationResult, clientResult, lotResult, representativeResult, profileResult, receiptResult] = await Promise.all([
    db.from("processing_requests").select("*").order("created_at", { ascending: false }),
    db.from("processing_orders").select("id,order_number,completion_number,request_id,lot_id,client_id,queue_position,input_kg,status,accepted_client_kg,client_reject_kg,hayked_byproduct_kg,process_loss_kg,started_at,completed_at").order("queue_position"),
    db.from("processing_request_lines").select("*").order("line_number"),
    db.from("processing_order_inputs").select("*").order("created_at"),
    db.from("processing_intakes").select("*").order("intake_at", { ascending: false }),
    db.from("processing_outputs").select("*").order("line_number"),
    db.from("processing_output_sources").select("output_id,input_id"),
    db.from("stock_reservations").select("id,processing_order_id,lot_id,reserved_bags,reserved_kg,status").not("processing_order_id", "is", null).order("created_at"),
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
  const clients = result(clientResult.data as ClientRow[] | null, clientResult.error);
  const lots = result(lotResult.data as LotRow[] | null, lotResult.error);
  const representatives = result(representativeResult.data as RepresentativeRow[] | null, representativeResult.error);
  const profiles = result(profileResult.data as ProfileRow[] | null, profileResult.error);
  const receipts = result(receiptResult.data as ProcessingData["receipts"] | null, receiptResult.error);
  const orderById = new Map(orders.map((item) => [item.id, item]));
  return {
    requests: rows.map((item) => ({
      id: item.id, requestNumber: item.request_number, clientDatabaseId: item.client_id ?? undefined,
      lotDatabaseId: item.lot_id ?? undefined, noteNumber: item.request_note_number, requestDate: item.request_date, client: item.client_name,
      lot: item.lot_reference, coffeeType: item.coffee_type === "WASHED" ? "Washed" : "Unwashed / UG",
      preparationType: item.requested_preparation_type, grade: item.grade, requestedBags: item.requested_bags,
      requestedKg: Number(item.requested_kg), certifications: item.certifications, otherCertification: item.other_certification ?? "",
      requester: item.requester_name, checker: item.checker_name, approver: item.approver_name, notes: item.notes ?? "",
      scannedDocumentAttached: item.scanned_document_attached, status: item.status,
      queuedAs: item.queued_order_id ? orderById.get(item.queued_order_id)?.order_number : undefined,
    })),
    orders, requestLines, orderInputs, intakes, outputs, outputSources, reservations, clients, lots, representatives, profiles, receipts,
  };
}

export async function createProcessingRequest(request: ProcessingRequest, lines: ProcessingRequestLine[]) {
  if (!request.clientDatabaseId) throw new Error("Select a client.");
  const db = createSupabaseClient();
  const client = await db.from("clients").select("id,legal_name").eq("id", request.clientDatabaseId).eq("active", true).maybeSingle();
  if (client.error || !client.data) throw new Error(friendlyDatabaseError(client.error, "The selected client is no longer available."));
  const { data, error } = await db.rpc("create_processing_request", {
    p_header: { noteNumber: request.noteNumber, requestDate: request.requestDate, clientId: client.data.id, clientName: client.data.legal_name, certifications: request.certifications, otherCertification: request.otherCertification, requester: request.requester, checker: request.checker, approver: request.approver, notes: request.notes, scannedDocumentAttached: request.scannedDocumentAttached },
    p_lines: lines.map((line) => ({ lotId: line.lotDatabaseId, preparationType: line.preparationType, grade: line.grade, requestedBags: line.requestedBags, requestedKg: line.requestedKg, certifications: line.certifications, specialInstruction: line.specialInstruction, remark: line.remark })),
  });
  if (error) throw new Error(friendlyDatabaseError(error, "The processing request could not be saved."));
  return String((data as { request_number: string }).request_number);
}

export async function processingRpc(name: "transition_processing_request" | "queue_processing_request", id: string, targetStatus?: string) {
  const parameters = name === "transition_processing_request" ? { request_id: id, target_status: targetStatus } : { request_id: id };
  const { error } = await createSupabaseClient().rpc(name, parameters);
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

export type DispatchRow = { id: string; dispatch_number: string; lot_id: string; client_id: string; representative_id: string; quantity_kg: number; bag_count: number; invoices_paid: boolean; credit_approved: boolean; documents_ready: boolean; weighbridge_ready: boolean; legal_or_quality_hold: boolean; status: string; prepared_by: string; approved_by: string | null; dispatch_date: string; dispatch_reason: string; destination: string | null; documents_reference: string | null; weighbridge_reference: string | null; notes: string | null; posted_at: string | null };
export type DispatchLineRow = { id: string; dispatch_id: string; line_number: number; lot_id: string; bag_count: number; quantity_kg: number };
export type StockReservationRow = { id: string; dispatch_id: string | null; processing_order_id: string | null; lot_id: string; reserved_bags: number; reserved_kg: number; status: "ACTIVE" | "CONSUMED" | "RELEASED" };
export type CreditOverrideRow = { id: string; dispatch_id: string; amount_etb: number; expires_on: string; reason: string; document_reference: string; status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED"; requested_by: string; decided_by: string | null };
export type DispatchData = { dispatches: DispatchRow[]; lines: DispatchLineRow[]; reservations: StockReservationRow[]; credits: CreditOverrideRow[]; clients: ClientRow[]; lots: LotRow[]; representatives: RepresentativeRow[]; profiles: ProfileRow[]; agreements: { id: string; client_id: string; agreement_number: string; effective_from: string; effective_to: string; status: string }[] };

export async function loadDispatchData(): Promise<DispatchData> {
  const db = createSupabaseClient();
  const [dispatches, lines, reservations, credits, clients, lots, representatives, profiles, agreements] = await Promise.all([
    db.from("dispatch_orders").select("*").order("created_at", { ascending: false }),
    db.from("dispatch_lines").select("*").order("line_number"),
    db.from("stock_reservations").select("*").order("created_at"),
    db.from("credit_overrides").select("*").order("created_at", { ascending: false }),
    db.from("clients").select("id,code,legal_name,tin,active").order("legal_name"),
    db.from("coffee_lots").select("id,lot_number,receipt_id,client_id,coffee_type,bag_count,quantity_kg,section,status").order("lot_number"),
    db.from("authorized_representatives").select("id,client_id,full_name,identity_number,phone,valid_from,valid_to,active").order("full_name"),
    db.from("profiles").select("id,full_name,role,active").order("full_name"),
    db.from("agreements").select("id,client_id,agreement_number,effective_from,effective_to,status"),
  ]);
  return { dispatches: result(dispatches.data as DispatchRow[] | null, dispatches.error), lines: result(lines.data as DispatchLineRow[] | null, lines.error), reservations: result(reservations.data as StockReservationRow[] | null, reservations.error), credits: result(credits.data as CreditOverrideRow[] | null, credits.error), clients: result(clients.data as ClientRow[] | null, clients.error), lots: result(lots.data as LotRow[] | null, lots.error), representatives: result(representatives.data as RepresentativeRow[] | null, representatives.error), profiles: result(profiles.data as ProfileRow[] | null, profiles.error), agreements: result(agreements.data as DispatchData["agreements"] | null, agreements.error) };
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

export type InvoiceRow = { id: string; invoice_number: string; client_id: string; tariff_version: string; subtotal_etb: number; tax_etb: number; total_etb: number; status: string; issued_on: string | null; due_on: string | null; line_snapshot: { description: string; quantity: number; rate_etb: number }[] };
export type PaymentRow = { id: string; payment_number: string; invoice_id: string; client_id: string; amount_etb: number; bank_reference: string; paid_at: string; direction: string };
export type FinanceData = {
  invoices: InvoiceRow[];
  payments: PaymentRow[];
  clients: ClientRow[];
  lots: (LotRow & { received_at: string })[];
  movements: { lot_id: string; bag_delta: number; occurred_at: string; reference_type: string }[];
  tariffs: { id: string; version_code: string; description: string | null; effective_from: string; effective_to: string | null; active: boolean; verified_by_1: string | null; verified_by_2: string | null }[];
  storageRuns: { id: string; duplicate_key: string; client_id: string; lot_id: string; run_number: string; total_amount: number; status: string }[];
};

export async function loadFinanceData(): Promise<FinanceData> {
  const db = createSupabaseClient();
  const [invoiceResult, paymentResult, clientResult, lotResult, receiptResult, movementResult, tariffResult, storageRunResult] = await Promise.all([
    db.from("invoices").select("id,invoice_number,client_id,tariff_version,subtotal_etb,tax_etb,total_etb,status,issued_on,due_on,line_snapshot").order("created_at", { ascending: false }),
    db.from("payments").select("id,payment_number,invoice_id,client_id,amount_etb,bank_reference,paid_at,direction").order("paid_at", { ascending: false }),
    db.from("clients").select("id,code,legal_name,tin,active").order("legal_name"),
    db.from("coffee_lots").select("id,lot_number,receipt_id,client_id,coffee_type,bag_count,quantity_kg,section,status").order("lot_number"),
    db.from("warehouse_receipts").select("id,arrival_at"),
    db.from("stock_movements").select("lot_id,bag_delta,occurred_at,reference_type").order("occurred_at"),
    db.from("tariff_versions").select("id,version_code,description,effective_from,effective_to,active,verified_by_1,verified_by_2").order("effective_from", { ascending: false }),
    db.from("storage_billing_runs").select("id,duplicate_key,client_id,lot_id,run_number,total_amount,status").order("created_at", { ascending: false }),
  ]);
  const receiptDates = new Map((receiptResult.data ?? []).map((item) => [item.id, item.arrival_at]));
  return {
    invoices: result(invoiceResult.data as InvoiceRow[] | null, invoiceResult.error),
    payments: result(paymentResult.data as PaymentRow[] | null, paymentResult.error),
    clients: result(clientResult.data as ClientRow[] | null, clientResult.error),
    lots: result(lotResult.data as LotRow[] | null, lotResult.error).map((lot) => ({ ...lot, received_at: receiptDates.get(lot.receipt_id ?? "") ?? new Date().toISOString() })),
    movements: result(movementResult.data as FinanceData["movements"] | null, movementResult.error),
    tariffs: result(tariffResult.data as FinanceData["tariffs"] | null, tariffResult.error),
    storageRuns: result(storageRunResult.data as FinanceData["storageRuns"] | null, storageRunResult.error),
  };
}

export async function recordPayment(invoiceId: string, amount: number, bankReference: string) {
  const { error } = await createSupabaseClient().rpc("record_invoice_payment", { invoice_id: invoiceId, amount_etb: amount, bank_reference: bankReference });
  if (error) throw new Error(error.message);
}

export type ApprovalDetail = { title: string; client: string; status: string; fields: { label: string; value: string }[]; documentCount: number; auditCount: number };
export type ApprovalRow = { id: string; request_type: string; reference_id: string; business_reference?: string; requested_by: string; requested_at: string; status: string; decided_by: string | null; decided_at: string | null; decision_note: string | null; detail?: ApprovalDetail };
export type DocumentRow = { id: string; document_number: string; document_type: string; reference_type: string; reference_id: string; business_reference?: string; version: number; file_name: string; status: string };
export type AuditRow = { id: string; actor_id: string; action: string; reference_type: string; reference_id: string; business_reference?: string; occurred_at: string };
export type AdminUserRow = { id: string; email: string; full_name: string; role: string; active: boolean; last_sign_in_at: string | null };
export type BusinessReference = { id: string; type: string; label: string };

export async function loadManagementData() {
  const db = createSupabaseClient();
  const [approvalResult, documentResult, auditResult, profileResult, receiptResult, requestResult, orderResult, dispatchResult, invoiceResult, lotResult, clientResult, adminUserResult] = await Promise.all([
    db.from("approvals").select("id,request_type,reference_id,requested_by,requested_at,status,decided_by,decided_at,decision_note").order("requested_at", { ascending: false }),
    db.from("documents").select("id,document_number,document_type,reference_type,reference_id,version,file_name,status").order("created_at", { ascending: false }),
    db.from("audit_events").select("id,actor_id,action,reference_type,reference_id,occurred_at").order("occurred_at", { ascending: false }),
    db.from("profiles").select("id,full_name,role,active").order("full_name"),
    db.from("warehouse_receipts").select("id,receipt_number"),
    db.from("processing_requests").select("id,request_number,client_name,lot_reference,requested_kg,requested_bags,requested_preparation_type,status,notes"),
    db.from("processing_orders").select("id,order_number,completion_number"),
    db.from("dispatch_orders").select("id,dispatch_number,client_id,quantity_kg,bag_count,destination,status,documents_reference,weighbridge_reference,credit_approved"),
    db.from("invoices").select("id,invoice_number"),
    db.from("coffee_lots").select("id,lot_number"),
    db.from("clients").select("id,code,legal_name"),
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
  clients: ClientRow[];
  lots: LotRow[];
  profiles: ProfileRow[];
  processingOrders: { id: string; order_number: string; client_id: string; lot_id: string; status: string }[];
  bagOrders: { id: string; order_number: string; client_id: string; lot_id: string | null; quantity: number; unit_rate: number; total_amount: number; status: string }[];
  generatorRequests: { id: string; request_number: string; client_id: string; lot_id: string | null; processing_order_id: string | null; diesel_litres: number; unit_cost: number; total_cost: number; status: string }[];
  labourSettings: { id: string; fixed_addition_etb: number; effective_from: string; effective_to: string | null; active: boolean }[];
  labourRecords: { id: string; labour_number: string; work_date: string; client_id: string; lot_id: string | null; processing_order_id: string | null; dispatch_id: string | null; activity: string; quantity: number; unit_label: string; internal_cost_etb: number; charge_addition_etb: number; client_charge_etb: number; note: string | null; external_reference: string | null; service_event_id: string | null; created_at: string }[];
};

export async function loadWarehouseControlData(): Promise<WarehouseControlData> {
  const db = createSupabaseClient();
  const [clients, lots, profiles, processingOrders, bagOrders, generatorRequests, labourSettings, labourRecords] = await Promise.all([
    db.from("clients").select("id,code,legal_name,tin,active").order("legal_name"),
    db.from("coffee_lots").select("id,lot_number,receipt_id,client_id,coffee_type,bag_count,quantity_kg,section,status").order("lot_number"),
    db.from("profiles").select("id,full_name,role,active").order("full_name"),
    db.from("processing_orders").select("id,order_number,client_id,lot_id,status").order("created_at", { ascending: false }),
    db.from("bag_printing_orders").select("id,order_number,client_id,lot_id,quantity,unit_rate,total_amount,status").order("created_at", { ascending: false }),
    db.from("generator_usage_requests").select("id,request_number,client_id,lot_id,processing_order_id,diesel_litres,unit_cost,total_cost,status").order("created_at", { ascending: false }),
    db.from("labour_charge_settings").select("id,fixed_addition_etb,effective_from,effective_to,active").order("effective_from", { ascending: false }),
    db.from("labour_records").select("id,labour_number,work_date,client_id,lot_id,processing_order_id,dispatch_id,activity,quantity,unit_label,internal_cost_etb,charge_addition_etb,client_charge_etb,note,external_reference,service_event_id,created_at").order("created_at", { ascending: false }),
  ]);
  return {
    clients: result(clients.data as ClientRow[] | null, clients.error),
    lots: result(lots.data as LotRow[] | null, lots.error),
    profiles: result(profiles.data as ProfileRow[] | null, profiles.error),
    processingOrders: result(processingOrders.data as WarehouseControlData["processingOrders"] | null, processingOrders.error),
    bagOrders: result(bagOrders.data as WarehouseControlData["bagOrders"] | null, bagOrders.error),
    generatorRequests: result(generatorRequests.data as WarehouseControlData["generatorRequests"] | null, generatorRequests.error),
    labourSettings: result(labourSettings.data as WarehouseControlData["labourSettings"] | null, labourSettings.error),
    labourRecords: result(labourRecords.data as WarehouseControlData["labourRecords"] | null, labourRecords.error),
  };
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
  return data as { labour_number: string; internal_cost_etb: number; charge_addition_etb: number; client_charge_etb: number; service_event_id: string };
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

export async function runStorageBilling(input: {
  clientId: string;
  lotId: string;
  category: string;
  periodStart: string;
  periodEnd: string;
  tariffVersion: string;
  billableBagDays: number;
  totalAmount: number;
}) {
  const { data, error } = await createSupabaseClient().rpc("calculate_and_save_storage_billing", {
    p_client_id: input.clientId,
    p_lot_id: input.lotId,
    p_category: input.category,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_tariff_version: input.tariffVersion,
    p_billable_bag_days: input.billableBagDays,
    p_total_amount: input.totalAmount,
  });
  if (error) throw new Error(friendlyDatabaseError(error, "Failed to run storage billing."));
  return data as string;
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
