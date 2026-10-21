import { createSupabaseClient } from "./supabase/client";
import { coffeeCategories, validLaboratoryGrade } from "./laboratory-fields";

export type LabSample = {
  id: string; organization_id: string; sample_code: string; client_id: string; lot_id: string | null;
  received_on: string; origin: string; process: string; status: "DRAFT" | "SUBMITTED" | "APPROVED";
  report_version: number; created_by: string; submitted_by: string | null; created_at: string;
  moisture_percent: number | null; screen_14_percent: number | null; shape_make: string | null;
  green_odour: string | null; green_colour: string | null;
  green_quality: string | null; green_comment: string | null; cup_cleanliness: string | null;
  acidity: string | null; body: string | null; flavour: string | null; cup_overall: string | null;
  cup_comment: string | null; green_value: number | null; cup_value: number | null;
  total_value: number | null; proposed_grade: string | null; recommendation: string | null;
};

export type LabResults = {
  moisturePercent: string; screen14Percent: string; shapeMake: string; greenOdour: string;
  greenColour: string; greenQuality: string;
  greenComment: string; cupCleanliness: string; acidity: string; body: string;
  flavour: string; cupOverall: string; cupComment: string; greenValue: string;
  cupValue: string; totalValue: string; proposedGrade: string; recommendation: string;
};

export type LabReport = { id: string; sample_id: string; version: number; approved_at: string; approved_by: string };
export type LabDelivery = { id: string; report_id: string; recipient_email: string; status: string; provider_message_id: string | null; created_at: string };
export type LabClient = { id: string; legal_name: string; email: string | null; active: boolean };
export type LabLot = { id: string; lot_number: string; client_id: string };

export const labResultsFromSample = (s: LabSample): LabResults => ({
  moisturePercent: s.moisture_percent?.toString() ?? "", screen14Percent: s.screen_14_percent?.toString() ?? "",
  shapeMake: s.shape_make ?? "", greenOdour: s.green_odour ?? "",
  greenColour: s.green_colour ?? "", greenQuality: s.green_quality ?? "", greenComment: s.green_comment ?? "",
  cupCleanliness: s.cup_cleanliness ?? "", acidity: s.acidity ?? "", body: s.body ?? "",
  flavour: s.flavour ?? "", cupOverall: s.cup_overall ?? "", cupComment: s.cup_comment ?? "",
  greenValue: s.green_value?.toString() ?? "", cupValue: s.cup_value?.toString() ?? "",
  totalValue: s.total_value?.toString() ?? "", proposedGrade: s.proposed_grade ?? "",
  recommendation: s.recommendation ?? "",
});

function checked<T>(data: T | null, error: { message: string } | null, fallback: string): T {
  if (error || data === null) throw new Error(error?.message ?? fallback);
  return data;
}

export async function loadLaboratoryData() {
  const db = createSupabaseClient();
  const [clients, lots, samples, reports, deliveries] = await Promise.all([
    db.from("clients").select("id,legal_name,email,active").order("legal_name"),
    db.from("coffee_lots").select("id,lot_number,client_id").order("created_at", { ascending: false }).limit(500),
    db.from("lab_samples").select("*").order("created_at", { ascending: false }).limit(500),
    db.from("lab_reports").select("id,sample_id,version,approved_at,approved_by").order("approved_at", { ascending: false }).limit(500),
    db.from("lab_report_deliveries").select("id,report_id,recipient_email,status,provider_message_id,created_at").order("created_at", { ascending: false }).limit(500),
  ]);
  return {
    clients: checked(clients.data as LabClient[] | null, clients.error, "Clients could not be loaded."),
    lots: checked(lots.data as LabLot[] | null, lots.error, "Coffee lots could not be loaded."),
    samples: checked(samples.data as LabSample[] | null, samples.error, "Samples could not be loaded."),
    reports: checked(reports.data as LabReport[] | null, reports.error, "Reports could not be loaded."),
    deliveries: checked(deliveries.data as LabDelivery[] | null, deliveries.error, "Email history could not be loaded."),
  };
}

export async function createLabSample(input: { clientId: string; lotId: string; receivedOn: string; origin: string; process: string }) {
  if (!(coffeeCategories as readonly string[]).includes(input.process)) throw new Error("Choose Washed, Natural, or UG.");
  const { data, error } = await createSupabaseClient().rpc("create_lab_sample", {
    p_client_id: input.clientId, p_lot_id: input.lotId || null, p_received_on: input.receivedOn,
    p_origin: input.origin, p_process: input.process,
  });
  return checked(data as string | null, error, "The sample could not be registered.");
}

export async function saveLabSample(sampleId: string, results: LabResults, category: string) {
  if (results.proposedGrade && !validLaboratoryGrade(category, results.proposedGrade)) {
    throw new Error("Choose a grade allowed for this coffee category.");
  }
  const { error } = await createSupabaseClient().rpc("save_lab_sample", { p_sample_id: sampleId, p_results: results });
  if (error) throw new Error(error.message);
}

export async function transitionLabSample(action: "submit" | "approve" | "reopen", sampleId: string) {
  const rpc = { submit: "submit_lab_sample", approve: "approve_lab_sample", reopen: "reopen_lab_sample" }[action];
  const { error } = await createSupabaseClient().rpc(rpc, { p_sample_id: sampleId });
  if (error) throw new Error(error.message);
}

async function reportRequest(reportId: string, method: "GET" | "POST") {
  const db = createSupabaseClient();
  const { data: session } = await db.auth.getSession();
  if (!session.session?.access_token) throw new Error("Sign in again before opening a report.");
  const response = await fetch(`/api/laboratory/reports/${encodeURIComponent(reportId)}${method === "POST" ? "/send" : ""}`, {
    method, headers: { authorization: `Bearer ${session.session.access_token}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "The report request failed.");
  }
  return response;
}

export async function downloadLabReport(reportId: string, fileName: string) {
  const response = await reportRequest(reportId, "GET");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url; link.download = fileName; document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function sendLabReport(reportId: string) {
  const response = await reportRequest(reportId, "POST");
  return response.json() as Promise<{ status: string; recipient: string; providerMessageId: string }>;
}
