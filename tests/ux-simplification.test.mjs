import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { daysOverdue, lotStatusLabel, lotTypeLabel, notificationTarget, stockMatches } from "../app/ux-rules.ts";
import { agreementCountdown, agreementDisplayStatus, agreementExpiryFromTerm } from "../app/client-onboarding.ts";

const baseLot = {
  lotNumber: "LOT-001",
  sourceGrn: "GRN-001",
  client: "Guji Coffee",
  coffee: "Washed",
  grade: "Grade 1",
  section: "A-01",
  bags: 10,
  weightKg: 600,
  status: "ARRIVAL_IN_STORAGE",
  lotCategory: "ARRIVAL",
  ownershipType: "CLIENT",
};

test("coffee stock keeps type and workflow status separate", () => {
  assert.equal(lotTypeLabel(baseLot), "Arrival");
  assert.equal(lotStatusLabel(baseLot.status), "Available");
  assert.equal(lotStatusLabel("IN_PROCESS"), "In Processing");
  assert.equal(stockMatches(baseLot, "Arrival", "Available", "Guji Coffee", "GRN-001"), true);
  assert.equal(stockMatches(baseLot, "Processed", "Available", "Guji Coffee", ""), false);
});

test("actionable attention labels route to the correct workspace", () => {
  assert.deepEqual(notificationTarget("Pending approvals"), { view: "Approvals" });
  assert.deepEqual(notificationTarget("Agreements expiring"), { view: "Agreements" });
  assert.equal(notificationTarget("Processing exceptions").view, "Processing");
  assert.deepEqual(notificationTarget("Open invoices"), { view: "Finance" });
});

test("overdue days never become negative", () => {
  const today = new Date("2026-08-09T12:00:00Z");
  assert.equal(daysOverdue("2026-08-01", today), 8);
  assert.equal(daysOverdue("2026-08-20", today), 0);
});

test("agreement presets calculate inclusive dates and a clear countdown", () => {
  assert.equal(agreementExpiryFromTerm("2026-08-29", "ONE_YEAR"), "2027-08-28");
  assert.equal(agreementExpiryFromTerm("2026-08-29", "TWO_YEARS"), "2028-08-28");
  assert.equal(agreementCountdown("2028-08-28", "2026-08-29").label, "1 year, 11 months, 30 days left");
  assert.equal(agreementDisplayStatus("ACTIVE", "2026-01-01", "2026-09-20", "2026-08-29"), "EXPIRING_SOON");
  assert.equal(agreementDisplayStatus("ACTIVE", "2026-01-01", "2026-08-20", "2026-08-29"), "EXPIRED");
});

test("dashboard exposes actionable navigation without the day-shift strip", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /className="shift-strip"/);
  assert.match(source, /No items need your attention\./);
  assert.match(source, /notificationTarget\(item\.label\)/);
  assert.match(source, /stockType: "Arrival"/);
  assert.match(source, /processingState: "Ready to Start"/);
});

test("client onboarding and stock views retain the required daily controls", async () => {
  const source = await readFile(new URL("../app/core-operations.tsx", import.meta.url), "utf8");
  assert.match(source, /Client details/);
  assert.match(source, /Agreement/);
  assert.match(source, /Authorized representatives/);
  assert.match(source, /Add representative/i);
  assert.match(source, /createClientSetup/);
  assert.match(source, /<span>Type<\/span>/);
  assert.match(source, /<span>Status<\/span>/);
  assert.match(source, /stockMatches/);
});

test("processing, storage loss, billing, reports and audit use guided workspaces", async () => {
  const [processing, storage, finance, management] = await Promise.all([
    readFile(new URL("../app/processing-operations.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/warehouse-controls.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/finance-operations.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/management-operations.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(processing, /Waiting Approval/);
  assert.match(processing, /Ready to Start/);
  assert.match(processing, /AddInputLotDialog/);
  assert.match(storage, /System quantity/);
  assert.match(storage, /Physical measurement/);
  assert.match(storage, /postStorageLoss/);
  assert.match(finance, /Unbilled Services/);
  assert.match(finance, /serviceEvents/);
  assert.match(finance, /daysOverdue/);
  assert.match(finance, /Current outstanding always\s+shows the complete account balance/);
  assert.match(finance, /Show changes only/);
  assert.match(finance, /Storage Charges/);
  assert.match(finance, /Daily charge is blocked because no active storage tariff covers this period/);
  assert.doesNotMatch(finance, /More billing tools/);
  assert.match(management, /loadReportTable/);
  assert.match(management, /Export CSV/);
  assert.match(management, /Search reference, user, action/);
  assert.doesNotMatch(management, /<span>Event ID<\/span>/);
});

test("daily work has direct, plain-language actions and complete finance evidence", async () => {
  const [page, clients, processing, dispatch, finance] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/core-operations.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/processing-operations.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dispatch-operations.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/finance-operations.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /reportType/);
  assert.match(page, /onNavigate=\{navigate\}/);
  assert.match(page, /Search any client, coffee, payment or document/);
  assert.match(clients, /Edit client/);
  assert.match(clients, /Add agreement/);
  assert.match(clients, /Add representative/);
  assert.match(clients, /initialClientId/);
  assert.match(clients, /updateClientProfile/);
  assert.match(clients, /This agreement tells the ERP/);
  assert.match(processing, /Submit for Approval/);
  assert.match(processing, /Attachments are optional/);
  assert.match(processing, /Review Request/);
  assert.match(processing, /View Summary/);
  assert.doesNotMatch(processing, /Complete ECX check/);
  assert.doesNotMatch(processing, /Request & ECX/);
  assert.doesNotMatch(processing, /Order & files/);
  assert.match(dispatch, /Open dispatch report/);
  assert.match(dispatch, /Fix missing document information/);
  assert.match(dispatch, /Post transfer departure/);
  assert.doesNotMatch(dispatch, /const \[ecs, setEcs\]/);
  assert.match(finance, /Transaction \/ receipt reference/);
  assert.match(finance, /Payer name/);
  assert.match(finance, /Full client account/);
  assert.match(finance, /database rate record/i);
});

test("client readiness can be completed later and receipt self-approval is explained before action", async () => {
  const [page, core, data, grn] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/core-operations.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/erp-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/grn-workflow.ts", import.meta.url), "utf8"),
  ]);

  assert.match(core, /setMasterModal\(\{ kind: "agreement", clientId: selectedMaster\.record\.id \}\)/);
  assert.match(core, /setMasterModal\(\{ kind: "representative", clientId: selectedMaster\.record\.id \}\)/);
  assert.match(core, /receipt\.preparedById === userId/);
  assert.match(core, /Another employee approves/);
  assert.match(page, /<CoreOperations activeView=\{activeView\} userId=\{profile\.id\}/);
  assert.match(data, /preparedById: item\.prepared_by/);
  assert.match(grn, /preparedById\?: string/);
});

test("certification and ECX controls are database-authoritative", async () => {
  const [migration, core, finance, dispatch] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260829180708_simplify_client_stock_certification_flows.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/core-operations.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/finance-operations.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dispatch-operations.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /lot_is_certified_for_period/);
  assert.match(migration, /update_grn_certification/);
  assert.match(migration, /post_ecx_transfer_v2/);
  assert.match(migration, /destination_document_reference/);
  assert.match(core, /Certificate received - needs checking/);
  assert.match(finance, /Verified certified rate applies/);
  assert.doesNotMatch(finance, /setCertified/);
  assert.match(dispatch, /ECX WAREHOUSE TRANSFER/);
});

test("client agreements, representatives and stock movements open controlled records", async () => {
  const [core, data] = await Promise.all([
    readFile(new URL("../app/core-operations.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/erp-data.ts", import.meta.url), "utf8"),
  ]);
  assert.match(core, /Agreement time filters/);
  assert.match(core, /Time left/);
  assert.match(core, /EditAgreementModal/);
  assert.match(core, /EditRepresentativeModal/);
  assert.match(core, /Open processing record/);
  assert.match(core, /movement-record-row/);
  assert.match(data, /reference_type,reference_id/);
  assert.match(data, /update_client_agreement/);
  assert.match(data, /update_authorized_representative/);
});

test("manual services never arise automatically from processing completion", async () => {
  const [migration, services, finance] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260830050652_simplify_service_navigation_and_controls.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/warehouse-controls.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/finance-operations.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /post_manual_service_record/);
  assert.match(migration, /'automatic', false/);
  assert.doesNotMatch(migration, /trigger[\s\S]{0,120}processing_orders/i);
  assert.match(services, /Completing a processing order never charges the client by itself/);
  assert.match(services, /Record manual service/);
  assert.match(finance, /Add to invoice preparation/);
  assert.match(finance, /This is work awaiting invoice preparation, not a payment/);
});

test("payments keep collections balances synchronized", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260830050652_simplify_service_navigation_and_controls.sql", import.meta.url), "utf8");
  assert.match(migration, /sync_arrears_after_payment/);
  assert.match(migration, /ARREARS_BALANCE_SYNCED/);
  assert.match(migration, /Closed automatically after full payment/);
});
