import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { renderLaboratoryPdf } from "../lib/laboratory-pdf.ts";
import { laboratoryGrades, validLaboratoryGrade } from "../lib/laboratory-fields.ts";

test("grades follow the selected coffee category", () => {
  assert.deepEqual(laboratoryGrades("Washed"), ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5"]);
  assert.deepEqual(laboratoryGrades("Natural"), laboratoryGrades("Washed"));
  assert.deepEqual(laboratoryGrades("UG"), ["UG"]);
  assert.equal(validLaboratoryGrade("Natural", "UG"), false);
  assert.equal(validLaboratoryGrade("UG", "Grade 5"), false);
});

const snapshot = {
  sample_code: "LAB-2026-000001", client_name: "Guji Specialty Coffee PLC", received_on: "2026-10-20",
  origin: "Wellega", process: "Natural", moisture_percent: 11.2, screen_14_percent: 93,
  shape_make: "Mixed", green_odour: "Strong", green_colour: "Brownish",
  green_quality: "Poor to fair", green_comment: "Physical defects observed.",
  cup_cleanliness: "Clean", acidity: "Light", body: "Thin", flavour: "Fair", cup_overall: "Fair",
  cup_comment: "All cups were assessed.", green_value: 11, cup_value: 16, total_value: 27,
  proposed_grade: "Grade 5", recommendation: "Review physical defects.", reviewer_name: "Reviewer Name",
  approved_at: "2026-10-20T08:00:00Z",
};

test("an approved snapshot becomes a valid, versioned PDF", async () => {
  const bytes = await renderLaboratoryPdf(snapshot, 1);
  assert.match(Buffer.from(bytes.subarray(0, 8)).toString(), /^%PDF-/);
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 1);
  const { width, height } = document.getPage(0).getSize();
  assert.ok(Math.abs(width - 595.28) < 0.01 && Math.abs(height - 841.89) < 0.01);
});

test("long observations continue on later pages", async () => {
  const bytes = await renderLaboratoryPdf({ ...snapshot, cup_comment: "Cup observation. ".repeat(350) }, 2);
  assert.ok((await PDFDocument.load(bytes)).getPageCount() > 1);
});

test("unsupported report text is rejected instead of silently changed", async () => {
  await assert.rejects(renderLaboratoryPdf({ ...snapshot, client_name: "የቡና ኩባንያ" }, 1), /font cannot display/);
});
