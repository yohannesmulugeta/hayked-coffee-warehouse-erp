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

type ClientRow = { id: string; code: string; legal_name: string; tin: string | null; active: boolean };
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
type LotRow = { id: string; lot_number: string; receipt_id: string | null; client_id: string; coffee_type: "WASHED" | "UNWASHED_UG"; bag_count: number; quantity_kg: number; section: string; status: CoffeeLot["status"] };
type MovementRow = { id: string; lot_id: string; movement_type: StockMovement["type"]; quantity_kg: number; bag_delta: number; reference_id: string };
type ProfileRow = { id: string; full_name: string; role: string; active: boolean };

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

export type ProcessingData = {
  requests: ProcessingRequest[];
  orders: ProcessingOrderRow[];
  requestLines: ProcessingRequestLineRow[];
  orderInputs: ProcessingOrderInputRow[];
  intakes: ProcessingIntakeRow[];
  outputs: ProcessingOutputRow[];
  clients: ClientRow[];
  lots: LotRow[];
  representatives: RepresentativeRow[];
  profiles: ProfileRow[];
  receipts: Pick<ReceiptRow, "id" | "receipt_number" | "grade" | "origin" | "crop_year" | "bag_weight_kg">[];
};

export async function loadProcessingData(): Promise<ProcessingData> {
  const db = createSupabaseClient();
  const [requestResult, orderResult, requestLineResult, orderInputResult, intakeResult, outputResult, clientResult, lotResult, representativeResult, profileResult, receiptResult] = await Promise.all([
    db.from("processing_requests").select("*").order("created_at", { ascending: false }),
    db.from("processing_orders").select("id,order_number,completion_number,request_id,lot_id,client_id,queue_position,input_kg,status,accepted_client_kg,client_reject_kg,hayked_byproduct_kg,process_loss_kg,started_at,completed_at").order("queue_position"),
    db.from("processing_request_lines").select("*").order("line_number"),
    db.from("processing_order_inputs").select("*").order("created_at"),
    db.from("processing_intakes").select("*").order("intake_at", { ascending: false }),
    db.from("processing_outputs").select("*").order("line_number"),
    db.from("clients").select("id,code,legal_name,tin,active"),
    db.from("coffee_lots").select("id,lot_number,receipt_id,client_id,coffee_type,bag_count,quantity_kg,section,status"),
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
    orders, requestLines, orderInputs, intakes, outputs, clients, lots, representatives, profiles, receipts,
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
export type StockReservationRow = { id: string; dispatch_id: string; lot_id: string; reserved_bags: number; reserved_kg: number; status: "ACTIVE" | "CONSUMED" | "RELEASED" };
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

export type InvoiceRow = { id: string; invoice_number: string; subtotal_etb: number; tax_etb: number; total_etb: number; status: string; issued_on: string | null; due_on: string | null; line_snapshot: { description: string; quantity: number; rate_etb: number }[] };
export type PaymentRow = { id: string; payment_number: string; invoice_id: string; amount_etb: number; bank_reference: string; paid_at: string; direction: string };

export async function loadFinanceData() {
  const db = createSupabaseClient();
  const [invoiceResult, paymentResult] = await Promise.all([
    db.from("invoices").select("id,invoice_number,subtotal_etb,tax_etb,total_etb,status,issued_on,due_on,line_snapshot").order("created_at", { ascending: false }),
    db.from("payments").select("id,payment_number,invoice_id,amount_etb,bank_reference,paid_at,direction").order("paid_at", { ascending: false }),
  ]);
  return {
    invoices: result(invoiceResult.data as InvoiceRow[] | null, invoiceResult.error),
    payments: result(paymentResult.data as PaymentRow[] | null, paymentResult.error),
  };
}

export async function recordPayment(invoiceId: string, amount: number, bankReference: string) {
  const { error } = await createSupabaseClient().rpc("record_invoice_payment", { invoice_id: invoiceId, amount_etb: amount, bank_reference: bankReference });
  if (error) throw new Error(error.message);
}

export type ApprovalRow = { id: string; request_type: string; reference_id: string; business_reference?: string; requested_by: string; requested_at: string; status: string };
export type DocumentRow = { id: string; document_number: string; document_type: string; reference_type: string; reference_id: string; business_reference?: string; version: number; file_name: string; status: string };
export type AuditRow = { id: string; actor_id: string; action: string; reference_type: string; reference_id: string; business_reference?: string; occurred_at: string };
export type AdminUserRow = { id: string; email: string; full_name: string; role: string; active: boolean; last_sign_in_at: string | null };
export type BusinessReference = { id: string; type: string; label: string };

export async function loadManagementData() {
  const db = createSupabaseClient();
  const [approvalResult, documentResult, auditResult, profileResult, receiptResult, requestResult, orderResult, dispatchResult, invoiceResult, lotResult, clientResult, adminUserResult] = await Promise.all([
    db.from("approvals").select("id,request_type,reference_id,requested_by,requested_at,status").order("requested_at", { ascending: false }),
    db.from("documents").select("id,document_number,document_type,reference_type,reference_id,version,file_name,status").order("created_at", { ascending: false }),
    db.from("audit_events").select("id,actor_id,action,reference_type,reference_id,occurred_at").order("occurred_at", { ascending: false }),
    db.from("profiles").select("id,full_name,role,active").order("full_name"),
    db.from("warehouse_receipts").select("id,receipt_number"),
    db.from("processing_requests").select("id,request_number"),
    db.from("processing_orders").select("id,order_number,completion_number"),
    db.from("dispatch_orders").select("id,dispatch_number"),
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
  const approvals = result(approvalResult.data as ApprovalRow[] | null, approvalResult.error).map((item) => ({ ...item, business_reference: references.get(item.reference_id) ?? item.reference_id.slice(0, 8).toUpperCase() }));
  const documents = result(documentResult.data as DocumentRow[] | null, documentResult.error).map((item) => ({ ...item, business_reference: references.get(item.reference_id) ?? item.reference_id.slice(0, 8).toUpperCase() }));
  const audit = result(auditResult.data as AuditRow[] | null, auditResult.error).map((item) => ({ ...item, business_reference: references.get(item.reference_id) ?? item.reference_id.slice(0, 8).toUpperCase() }));
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

export async function decideApproval(id: string, decision: "APPROVED" | "REJECTED") {
  const { error } = await createSupabaseClient().rpc("decide_approval", { approval_id: id, decision, note: "Decided in Administration" });
  if (error) throw new Error(error.message);
}

export async function updateProfile(id: string, role: string, active: boolean) {
  const { error } = await createSupabaseClient().from("profiles").update({ role, active }).eq("id", id);
  if (error) throw new Error(error.message);
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
  lotId?: string | null;
  dieselLitres: number;
  unitCost: number;
  approvedBy: string;
}) {
  const { data, error } = await createSupabaseClient().rpc("post_generator_request", {
    p_client_id: input.clientId,
    p_lot_id: input.lotId ?? null,
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


