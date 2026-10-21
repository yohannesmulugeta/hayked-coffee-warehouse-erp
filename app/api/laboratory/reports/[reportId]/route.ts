import { authorizedLaboratoryReport, laboratoryError } from "@/lib/laboratory-server";
import { renderLaboratoryPdf } from "@/lib/laboratory-pdf";

export async function GET(request: Request, context: { params: Promise<{ reportId: string }> }) {
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
