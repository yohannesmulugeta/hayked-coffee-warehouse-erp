import { createClient } from "@supabase/supabase-js";

const readRoles = new Set(["system_admin", "warehouse_manager", "warehouse_officer", "processing_supervisor", "finance_officer", "auditor", "viewer"]);
const sendRoles = new Set(["system_admin", "warehouse_manager"]);

export async function authorizedLaboratoryReport(request: Request, reportId: string, action: "read" | "send") {
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) throw new Error("Invalid report reference.");
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in to open this report.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server-side laboratory reports are not configured.");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your session is no longer valid.");
  const { data: actor, error: profileError } = await db.from("profiles")
    .select("id,organization_id,role,active").eq("id", auth.user.id).maybeSingle();
  if (profileError || !actor?.active || !(action === "send" ? sendRoles : readRoles).has(actor.role)) {
    throw new Error("Your role cannot access this report.");
  }
  const { data: report, error: reportError } = await db.from("lab_reports")
    .select("id,sample_id,version,snapshot,approved_at").eq("id", reportId).maybeSingle();
  if (reportError || !report) throw new Error("Report not found.");
  const { data: sample, error: sampleError } = await db.from("lab_samples")
    .select("id,sample_code,organization_id,client_id,status,report_version").eq("id", report.sample_id).maybeSingle();
  if (sampleError || !sample || sample.organization_id !== actor.organization_id) throw new Error("Report not found.");
  const { data: client, error: clientError } = await db.from("clients")
    .select("id,email,legal_name,active").eq("id", sample.client_id).maybeSingle();
  if (clientError || !client) throw new Error("Client not found.");
  return { db, actor, report, sample, client };
}

export function laboratoryError(error: unknown) {
  const message = error instanceof Error ? error.message : "The report request failed.";
  const status = /configured/.test(message) ? 503 : /session|Sign in/.test(message) ? 401
    : /role|cannot access/.test(message) ? 403 : /not found/.test(message) ? 404 : 400;
  return Response.json({ error: message }, { status });
}
