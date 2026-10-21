import { authorizedLaboratoryReport, laboratoryError } from "@/lib/laboratory-server";
import { renderLaboratoryPdf } from "@/lib/laboratory-pdf";
import { laboratoryDatabaseEnabled } from "@/lib/laboratory-config";

export async function GET(request: Request, context: { params: Promise<{ reportId: string }> }) {
  if (!laboratoryDatabaseEnabled) return Response.json({ error: "Laboratory records are not enabled on this site." }, { status: 503 });
  try {
    const { reportId } = await context.params;
    const { report, sample } = await authorizedLaboratoryReport(request, reportId, "read");
    const pdf = await renderLaboratoryPdf(report.snapshot as Record<string, unknown>, report.version);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${sample.sample_code}-v${report.version}.pdf"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) { return laboratoryError(error); }
}
