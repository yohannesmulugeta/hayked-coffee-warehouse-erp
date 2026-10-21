import { authorizedLaboratoryReport, laboratoryError } from "@/lib/laboratory-server";
import { renderLaboratoryPdf } from "@/lib/laboratory-pdf";

export async function POST(request: Request, context: { params: Promise<{ reportId: string }> }) {
  try {
    const { reportId } = await context.params;
    const { db, actor, report, sample, client } = await authorizedLaboratoryReport(request, reportId, "send");
    if (sample.status !== "APPROVED" || sample.report_version !== report.version) {
      return Response.json({ error: "Only the current approved version can be emailed." }, { status: 409 });
    }
    const recipient = client.email?.trim().toLowerCase();
    if (!client.active || !recipient || !/^\S+@\S+\.\S+$/.test(recipient)) {
      return Response.json({ error: "Add a valid email to the active client record before sending." }, { status: 400 });
    }
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.LAB_REPORT_FROM_EMAIL;
    if (!apiKey || !from) return Response.json({ error: "Client email is not configured on the server." }, { status: 503 });
    const pdf = await renderLaboratoryPdf(report.snapshot as Record<string, unknown>, report.version);
    const deliveryId = crypto.randomUUID();
    const { error: claimError } = await db.from("lab_report_deliveries").insert({
      id: deliveryId, report_id: report.id, organization_id: actor.organization_id,
      recipient_email: recipient, sent_by: actor.id, status: "PENDING",
    });
    if (claimError) {
      if (claimError.code === "23505") return Response.json({ error: "This version has already been sent or is awaiting verification." }, { status: 409 });
      throw new Error(claimError.message);
    }
    let status: "ACCEPTED" | "FAILED" | "UNKNOWN" = "UNKNOWN";
    let providerMessageId: string | null = null;
    let errorMessage: string | null = null;
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "Idempotency-Key": deliveryId },
        body: JSON.stringify({
          from, to: [recipient], subject: `Hayked coffee sample report ${sample.sample_code} (version ${report.version})`,
          text: `Dear ${client.legal_name},\n\nPlease find attached the approved evaluation for sample ${sample.sample_code}.\n\nRegards,\nHayked Coffee Laboratory`,
          attachments: [{ filename: `${sample.sample_code}-v${report.version}.pdf`, content: Buffer.from(pdf).toString("base64") }],
        }),
      });
      const payload = await response.json().catch(() => null) as { id?: string; message?: string } | null;
      if (response.ok && payload?.id) { status = "ACCEPTED"; providerMessageId = payload.id; }
      else if (response.ok) { errorMessage = "Email provider response needs verification."; }
      else if (response.status >= 500 || response.status === 408) {
        errorMessage = "The email provider response is uncertain. Check the provider before retrying.";
      } else {
        status = "FAILED"; errorMessage = payload?.message ?? `Email provider rejected the request (${response.status}).`;
      }
    } catch { errorMessage = "The email provider response is unknown. Check the provider before retrying."; }
    const { error: updateError } = await db.from("lab_report_deliveries").update({
      status, provider_message_id: providerMessageId, error_message: errorMessage, updated_at: new Date().toISOString(),
    }).eq("id", deliveryId);
    if (updateError) throw new Error("Email status could not be saved. Check the provider before retrying.");
    if (status !== "ACCEPTED") return Response.json({ error: errorMessage, status }, { status: status === "FAILED" ? 502 : 503 });
    return Response.json({ status, recipient, providerMessageId });
  } catch (error) { return laboratoryError(error); }
}
