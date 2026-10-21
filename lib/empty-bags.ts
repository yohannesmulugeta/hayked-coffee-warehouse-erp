import { createSupabaseClient } from "./supabase/client";

export type EmptyBagEventType =
  | "RECEIPT" | "ISSUE" | "RETURN" | "TRANSFER"
  | "RECLASSIFY" | "ADJUST_IN" | "ADJUST_OUT";
export type EmptyBagCondition = "USABLE" | "HELD" | "DAMAGED";

export type EmptyBagBalance = {
  client_id: string;
  warehouse_id: string;
  location_code: string;
  bag_type: string;
  condition: EmptyBagCondition;
  bag_count: number;
};

export type EmptyBagEvent = {
  id: string;
  event_type: EmptyBagEventType;
  business_date: string;
  bag_type: string;
  quantity: number;
  document_reference: string;
  source_warehouse_id: string | null;
  source_location: string | null;
  destination_warehouse_id: string | null;
  destination_location: string | null;
  created_at: string;
};

export type EmptyBagChangeRequest = {
  id: string;
  event_type: "RECLASSIFY" | "ADJUST_IN" | "ADJUST_OUT";
  business_date: string;
  bag_type: string;
  quantity: number;
  document_reference: string;
  reason: string;
  requested_by: string;
  created_at: string;
};

export type EmptyBagStatementDay = {
  business_date: string;
  opening_bags: number;
  movement_bags: number;
  closing_bags: number;
  document_references: string[];
};

export async function loadEmptyBagSetup() {
  const db = createSupabaseClient();
  const { data: auth, error: authError } = await db.auth.getUser();
  if (authError || !auth.user) throw new Error(authError?.message ?? "Sign in to view bag custody.");
  const { data: profile, error: profileError } = await db.from("profiles")
    .select("organization_id,role").eq("id", auth.user.id).single();
  if (profileError || !profile) throw new Error(profileError?.message ?? "Your staff profile is unavailable.");
  const [clients, warehouses] = await Promise.all([
    db.from("clients").select("id,code,legal_name,active")
      .eq("organization_id", profile.organization_id).eq("active", true).order("legal_name"),
    db.from("warehouses").select("id,code,name,active")
      .eq("organization_id", profile.organization_id).eq("active", true).order("name"),
  ]);
  if (clients.error || warehouses.error) {
    throw new Error(clients.error?.message ?? warehouses.error?.message);
  }
  return {
    userId: auth.user.id,
    role: profile.role as string,
    clients: clients.data ?? [],
    warehouses: warehouses.data ?? [],
  };
}

export async function loadEmptyBagClient(clientId: string) {
  const db = createSupabaseClient();
  const [balances, events, requests] = await Promise.all([
    db.from("empty_bag_balances")
      .select("client_id,warehouse_id,location_code,bag_type,condition,bag_count")
      .eq("client_id", clientId).order("location_code"),
    db.from("empty_bag_events")
      .select("id,event_type,business_date,bag_type,quantity,document_reference,source_warehouse_id,source_location,destination_warehouse_id,destination_location,created_at")
      .eq("client_id", clientId).order("created_at", { ascending: false }).limit(50),
    db.from("empty_bag_change_requests")
      .select("id,event_type,business_date,bag_type,quantity,document_reference,reason,requested_by,created_at")
      .eq("client_id", clientId).eq("status", "PENDING").order("created_at", { ascending: false }).limit(50),
  ]);
  if (balances.error || events.error || requests.error) {
    throw new Error(balances.error?.message ?? events.error?.message ?? requests.error?.message);
  }
  return {
    balances: (balances.data ?? []) as EmptyBagBalance[],
    events: (events.data ?? []) as EmptyBagEvent[],
    requests: (requests.data ?? []) as EmptyBagChangeRequest[],
  };
}

export async function submitEmptyBagMovement(input: {
  clientId: string;
  eventType: EmptyBagEventType;
  bagType: string;
  quantity: number;
  businessDate: string;
  documentReference: string;
  sourceWarehouseId?: string;
  sourceLocation?: string;
  sourceCondition?: EmptyBagCondition;
  destinationWarehouseId?: string;
  destinationLocation?: string;
  destinationCondition?: EmptyBagCondition;
  reason?: string;
}) {
  const pending = ["RECLASSIFY", "ADJUST_IN", "ADJUST_OUT"].includes(input.eventType);
  const { data, error } = await createSupabaseClient().rpc(
    pending ? "request_empty_bag_change" : "post_empty_bag_event", {
    p_client_id: input.clientId,
    p_event_type: input.eventType,
    p_bag_type: input.bagType.trim(),
    p_quantity: input.quantity,
    p_business_date: input.businessDate,
    p_document_reference: input.documentReference.trim(),
    p_source_warehouse_id: input.sourceWarehouseId || null,
    p_source_location: input.sourceLocation?.trim() || null,
    p_source_condition: input.sourceCondition || null,
    p_destination_warehouse_id: input.destinationWarehouseId || null,
    p_destination_location: input.destinationLocation?.trim() || null,
    p_destination_condition: input.destinationCondition || null,
    p_reason: input.reason?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return { id: data as string, pending };
}

export async function decideEmptyBagChange(requestId: string, approve: boolean, note = "") {
  const { error } = await createSupabaseClient().rpc("decide_empty_bag_change", {
    p_request_id: requestId,
    p_approve: approve,
    p_decision_note: note.trim() || null,
  });
  if (error) throw new Error(error.message);
}

export async function loadEmptyBagStatement(clientId: string, from: string, to: string) {
  const { data, error } = await createSupabaseClient().rpc("empty_bag_daily_statement", {
    p_client_id: clientId,
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as EmptyBagStatementDay[];
}

export type EmptyBagChargeType = "STORAGE" | "ARTICLE_16_4";
export type EmptyBagChargeDay = {
  date: string; cohortId: string | null; openingBags: number; movementBags: number;
  closingBags: number; ageDay: number | null; rate: number; units: number;
  amount: number; references: string[];
};
export type EmptyBagChargeQuote = {
  tariffVersion: string; chargeType: EmptyBagChargeType;
  billableUnits: number; amount: number; rows: EmptyBagChargeDay[];
};
export type EmptyBagChargeRun = {
  id: string; run_number: string; client_id: string; agreement_id: string;
  charge_type: EmptyBagChargeType; period_start: string; period_end: string;
  tariff_version: string; billable_units: number; total_amount: number;
  evidence_reference: string | null; charge_reason: string | null;
  status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "POSTED" | "INVOICED";
  prepared_by: string; reviewed_by: string | null; review_note: string | null;
  service_event_id: string | null;
};

export async function quoteEmptyBagCharge(input: {
  clientId: string; agreementId: string; from: string; to: string; type: EmptyBagChargeType;
}): Promise<EmptyBagChargeQuote> {
  const { data, error } = await createSupabaseClient().rpc("quote_empty_bag_charge", {
    p_client_id: input.clientId, p_agreement_id: input.agreementId,
    p_start: input.from, p_end: input.to, p_charge_type: input.type,
  });
  if (error) throw new Error(error.message);
  return data as EmptyBagChargeQuote;
}

export async function loadEmptyBagChargeRuns(clientId: string): Promise<EmptyBagChargeRun[]> {
  const { data, error } = await createSupabaseClient().from("empty_bag_charge_runs")
    .select("id,run_number,client_id,agreement_id,charge_type,period_start,period_end,tariff_version,billable_units,total_amount,evidence_reference,charge_reason,status,prepared_by,reviewed_by,review_note,service_event_id")
    .eq("client_id", clientId).order("created_at", { ascending: false }).limit(40);
  if (error) throw new Error(error.message);
  return (data ?? []) as EmptyBagChargeRun[];
}

export async function loadEmptyBagChargeDays(runId: string) {
  const { data, error } = await createSupabaseClient().from("empty_bag_charge_days")
    .select("charge_date,cohort_event_id,opening_bags,movement_bags,closing_bags,age_day,rate_etb,billable_units,amount_etb,movement_references")
    .eq("run_id", runId).order("charge_date");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function prepareEmptyBagCharge(input: {
  clientId: string; agreementId: string; from: string; to: string; type: EmptyBagChargeType;
  evidenceReference: string; reason: string;
}) {
  const { data, error } = await createSupabaseClient().rpc("prepare_empty_bag_charge", {
    p_client_id: input.clientId, p_agreement_id: input.agreementId,
    p_start: input.from, p_end: input.to, p_charge_type: input.type,
    p_evidence_reference: input.evidenceReference.trim(), p_charge_reason: input.reason.trim() || null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function decideEmptyBagCharge(runId: string, approve: boolean, note: string) {
  const { error } = await createSupabaseClient().rpc("decide_empty_bag_charge", {
    p_run_id: runId, p_approve: approve, p_review_note: note.trim() || null,
  });
  if (error) throw new Error(error.message);
}

export async function postEmptyBagCharge(runId: string) {
  const { data, error } = await createSupabaseClient().rpc("post_empty_bag_charge", {
    p_run_id: runId,
  });
  if (error) throw new Error(error.message);
  return data as string | null;
}
