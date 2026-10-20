import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

type Snapshot = Record<string, unknown>;

function value(snapshot: Snapshot, key: string) {
  const item = snapshot[key];
  return item === null || item === undefined || item === "" ? "Not recorded" : String(item);
}

export async function renderLaboratoryPdf(snapshot: Snapshot, version: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.06, 0.16, 0.28);
  const teal = rgb(0.04, 0.51, 0.57);
  const muted = rgb(0.36, 0.43, 0.50);
  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 46;
  const lineWidth = pageSize[0] - margin * 2;
  let page!: PDFPage;
  let y!: number;

  function newPage() {
    page = pdf.addPage(pageSize);
    y = pageSize[1] - 48;
    page.drawRectangle({ x: 0, y: pageSize[1] - 16, width: pageSize[0], height: 16, color: navy });
    page.drawText("HAYKED", { x: margin, y, font: bold, size: 21, color: navy });
    page.drawText("COFFEE LABORATORY", { x: margin + 122, y: y + 4, font: bold, size: 10, color: teal });
    y -= 28;
    page.drawLine({ start: { x: margin, y }, end: { x: pageSize[0] - margin, y }, thickness: 1, color: teal });
    y -= 30;
  }

  function ensure(height: number) { if (y - height < 62) newPage(); }
  function lines(text: string, font: PDFFont, size: number, width: number) {
    try { font.encodeText(text); } catch { throw new Error("The report contains characters the PDF font cannot display. Use Latin text for this report."); }
    const result: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
        if (line) result.push(line);
        line = "";
        for (const char of word) {
          if (font.widthOfTextAtSize(line + char, size) > width && line) { result.push(line); line = ""; }
          line += char;
        }
      }
      result.push(line);
    }
    return result;
  }
  function section(title: string) {
    ensure(38); y -= 5;
    page.drawRectangle({ x: margin, y: y - 6, width: lineWidth, height: 25, color: rgb(0.91, 0.96, 0.97) });
    page.drawText(title, { x: margin + 9, y, font: bold, size: 10, color: navy }); y -= 27;
  }
  function field(label: string, text: string) {
    const labelWidth = 126;
    const wrapped = lines(text, regular, 10, lineWidth - labelWidth - 12);
    ensure(19);
    page.drawText(label, { x: margin + 3, y, font: bold, size: 9, color: muted });
    for (const line of wrapped) { ensure(13); page.drawText(line, { x: margin + labelWidth, y, font: regular, size: 10, color: navy }); y -= 13; }
    y -= 5;
  }

  newPage();
  page.drawText("Coffee sample evaluation", { x: margin, y, font: bold, size: 17, color: navy });
  y -= 29;
  field("Report", `${value(snapshot, "sample_code")} / version ${version}`);
  field("Approved", value(snapshot, "approved_at").replace("T", " ").slice(0, 19) + " UTC");
  section("SAMPLE DETAILS");
  field("Client", value(snapshot, "client_name"));
  if (snapshot.lot_number) field("Warehouse lot", value(snapshot, "lot_number"));
  field("Received on", value(snapshot, "received_on"));
  field("Origin", value(snapshot, "origin"));
  field("Process", value(snapshot, "process"));
  section("GREEN COFFEE ASSESSMENT");
  field("Moisture", snapshot.moisture_percent == null ? "Not recorded" : `${snapshot.moisture_percent}%`);
  field("Screen 14 and above", snapshot.screen_14_percent == null ? "Not recorded" : `${snapshot.screen_14_percent}%`);
  field("Shape and make", value(snapshot, "shape_make"));
  field("Odour", value(snapshot, "green_odour"));
  field("Colour", value(snapshot, "green_colour"));
  field("Green quality", value(snapshot, "green_quality"));
  field("Observations", value(snapshot, "green_comment"));
  section("CUP ASSESSMENT");
  field("Cleanliness", value(snapshot, "cup_cleanliness"));
  field("Acidity", value(snapshot, "acidity"));
  field("Body", value(snapshot, "body"));
  field("Flavour", value(snapshot, "flavour"));
  field("Overall", value(snapshot, "cup_overall"));
  field("Observations", value(snapshot, "cup_comment"));
  section("CONCLUSION");
  field("Green value", value(snapshot, "green_value"));
  field("Cup value", value(snapshot, "cup_value"));
  field("Total value", value(snapshot, "total_value"));
  field("Proposed grade", value(snapshot, "proposed_grade"));
  field("Recommendation", value(snapshot, "recommendation"));
  field("Approved by", value(snapshot, "reviewer_name"));

  for (const [index, sheet] of pdf.getPages().entries()) {
    sheet.drawLine({ start: { x: margin, y: 47 }, end: { x: pageSize[0] - margin, y: 47 }, thickness: 0.7, color: rgb(0.80, 0.85, 0.88) });
    sheet.drawText("Result applies to the identified submitted sample.", { x: margin, y: 32, font: regular, size: 8, color: muted });
    sheet.drawText(`${index + 1} / ${pdf.getPageCount()}`, { x: pageSize[0] - margin - 28, y: 32, font: regular, size: 8, color: muted });
  }
  return pdf.save();
}
