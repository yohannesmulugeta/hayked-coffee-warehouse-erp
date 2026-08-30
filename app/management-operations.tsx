"use client";

import {
  ArrowRight,
  Check,
  Clock3,
  Download,
  Eye,
  FileText,
  History,
  LockKeyhole,
  Plus,
  Printer,
  Search,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  nextArrearsStage,
  type ArrearsStage,
  type AuditEntry,
} from "./management-rules";
import {
  advanceSavedArrearsCase,
  createAdminUser,
  createArrearsCase,
  decideApproval,
  getBusinessDocumentUrl,
  loadManagementData,
  loadReportTable,
  updateProfile,
  uploadBusinessDocument,
  type ApprovalRow,
  type ArrearsCaseRow,
  type ArrearsEventRow,
  type BusinessReference,
  type DocumentRow,
  type ReportTable,
  type ReportType,
} from "@/lib/erp-data";
import {
  DetailGrid,
  DetailSection,
  EvidenceUploader,
  RecordDetailDrawer,
} from "./workflow-ui";
import { daysOverdue } from "./ux-rules";

export const managementViews = [
  "Arrears Cases",
  "Reports",
  "Documents",
  "Approvals",
  "Audit History",
  "Administration",
];

const roles = [
  "system_admin",
  "warehouse_manager",
  "warehouse_officer",
  "processing_supervisor",
  "finance_officer",
  "auditor",
  "viewer",
];
type ApprovalItem = ApprovalRow & {
  reference: string;
  request: string;
  requestedBy: string;
  age: string;
};
type AuditViewRow = AuditEntry & {
  occurredAt: string;
  userId: string;
  module: string;
  referenceType: string;
  referenceId: string;
  eventData: Record<string, unknown>;
};
type ManagementInvoice = {
  id: string;
  invoice_number: string;
  client_id: string;
  status: string;
  total_etb: number;
  issued_on: string | null;
  due_on: string | null;
};
type ManagementPayment = {
  id: string;
  invoice_id: string;
  amount_etb: number;
  direction: string;
};

function Status({ value }: { value: string }) {
  return (
    <span className={`status-pill ${value.toLowerCase().replaceAll("_", "-")}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}

function downloadReport(title: string, csv: string) {
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title.toLowerCase().replaceAll(" ", "-")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ManagementOperations({
  activeView,
  onNavigate,
  initialReportType = "Stock",
}: {
  activeView: string;
  onNavigate?: (intent: { view: string; focusId?: string }) => void;
  initialReportType?: ReportType;
}) {
  const [scopedMessage, setScopedMessage] = useState({ view: "", text: "" });
  const message = scopedMessage.view === activeView ? scopedMessage.text : "";
  const setMessage = (text: string) =>
    setScopedMessage({ view: activeView, text });
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [selectedApprovalId, setSelectedApprovalId] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [documentRecords, setDocumentRecords] = useState<DocumentRow[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [audit, setAudit] = useState<AuditViewRow[]>([]);
  const [selectedAuditId, setSelectedAuditId] = useState("");
  const [selectedReportRowId, setSelectedReportRowId] = useState("");
  const [arrearsCases, setArrearsCases] = useState<ArrearsCaseRow[]>([]);
  const [arrearsEvents, setArrearsEvents] = useState<ArrearsEventRow[]>([]);
  const [managementInvoices, setManagementInvoices] = useState<
    ManagementInvoice[]
  >([]);
  const [managementPayments, setManagementPayments] = useState<
    ManagementPayment[]
  >([]);
  const [managementClients, setManagementClients] = useState<
    { id: string; code: string; legal_name: string }[]
  >([]);
  const [selectedArrearsId, setSelectedArrearsId] = useState("");
  const [newArrearsOpen, setNewArrearsOpen] = useState(false);
  const [arrearsNote, setArrearsNote] = useState("");
  const [arrearsNextDate, setArrearsNextDate] = useState("");
  const [profiles, setProfiles] = useState<
    {
      id: string;
      email?: string;
      full_name: string;
      role: string;
      active: boolean;
      last_sign_in_at?: string | null;
    }[]
  >([]);
  const [businessReferences, setBusinessReferences] = useState<
    BusinessReference[]
  >([]);
  const [reportClients, setReportClients] = useState<
    { id: string; legal_name: string }[]
  >([]);
  const [reportType, setReportType] = useState<ReportType>(initialReportType);
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [reportClientId, setReportClientId] = useState("");
  const [reportSearch, setReportSearch] = useState("");
  const [reportTable, setReportTable] = useState<ReportTable>({
    columns: [],
    rows: [],
  });
  const [reportLoading, setReportLoading] = useState(false);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const [auditUser, setAuditUser] = useState("All");
  const [auditModule, setAuditModule] = useState("All");
  const [auditAction, setAuditAction] = useState("All");

  const selectedApproval = approvals.find(
    (item) => item.id === selectedApprovalId,
  );
  const selectedArrears = arrearsCases.find(
    (item) => item.id === selectedArrearsId,
  );
  const selectedDocument = documentRecords.find(
    (item) => item.id === selectedDocumentId,
  );
  const selectedAudit = audit.find((item) => item.id === selectedAuditId);
  const selectedReportRow = reportTable.rows.find(
    (item) => item.id === selectedReportRowId,
  );
  const notice = message && (
    <div className="operation-message" role="status">
      <Check size={17} />
      {message}
      <button
        type="button"
        onClick={() => setScopedMessage({ view: activeView, text: "" })}
      >
        Close
      </button>
    </div>
  );

  async function reloadManagement() {
    try {
      const data = await loadManagementData();
      const profileById = new Map(
        data.profiles.map((profile) => [profile.id, profile.full_name]),
      );
      setProfiles(data.adminUsers.length ? data.adminUsers : data.profiles);
      setBusinessReferences(data.businessReferences);
      setReportClients(data.clients);
      setManagementClients(data.clients);
      setManagementInvoices(data.invoices as ManagementInvoice[]);
      setManagementPayments(data.payments as ManagementPayment[]);
      setArrearsCases(data.arrearsCases);
      setArrearsEvents(data.arrearsEvents);
      const nextApprovals = data.approvals.map((item) => ({
        ...item,
        reference:
          item.business_reference ??
          item.reference_id.slice(0, 8).toUpperCase(),
        request: item.request_type.replaceAll("_", " "),
        requestedBy: profileById.get(item.requested_by) ?? "Unknown user",
        age: new Date(item.requested_at).toLocaleString(),
      }));
      setApprovals(nextApprovals);
      setSelectedApprovalId((current) =>
        nextApprovals.some((item) => item.id === current)
          ? current
          : (nextApprovals[0]?.id ?? ""),
      );
      setDocumentRecords(data.documents);
      setAudit(
        data.audit.map((item) => ({
          id: item.id,
          occurredAt: item.occurred_at,
          at: new Date(item.occurred_at).toLocaleString(),
          userId: item.actor_id,
          actor: profileById.get(item.actor_id) ?? "Unknown user",
          module: item.reference_type.replaceAll("_", " "),
          referenceType: item.reference_type,
          referenceId: item.reference_id,
          action: item.action.replaceAll("_", " "),
          reference:
            item.business_reference ??
            item.reference_id.slice(-8).toUpperCase(),
          eventData: item.event_data ?? {},
        })),
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Management records could not be loaded.",
      );
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reloadManagement();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (activeView === "Reports" && reportTable.columns.length === 0)
      void refreshReport("Stock");
  }, [activeView]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openArrearsCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    try {
      const created = await createArrearsCase(
        String(values.get("invoiceId")),
        String(values.get("note")),
        String(values.get("nextActionOn")),
      );
      await reloadManagement();
      setSelectedArrearsId(created.id);
      setNewArrearsOpen(false);
      setMessage(`${created.case_number} opened and saved.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The arrears case could not be opened.",
      );
    }
  }

  async function advanceCase() {
    if (!selectedArrears || !arrearsNote.trim()) {
      setMessage("Enter an action note before moving the case.");
      return;
    }
    const next = nextArrearsStage(selectedArrears.stage as ArrearsStage);
    if (!next) return;
    try {
      await advanceSavedArrearsCase(
        selectedArrears.id,
        next,
        arrearsNote.trim(),
        arrearsNextDate,
      );
      await reloadManagement();
      setArrearsNote("");
      setMessage(
        `${selectedArrears.case_number} moved to ${next.replaceAll("_", " ")} and saved.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The arrears stage could not be saved.",
      );
    }
  }

  async function decideSelected(decision: "APPROVED" | "REJECTED") {
    const item = approvals.find(
      (approval) => approval.id === selectedApprovalId,
    );
    if (!item) return;
    if (!decisionNote.trim()) {
      setMessage("Enter a decision note before approving or rejecting.");
      return;
    }
    try {
      await decideApproval(item.id, decision, decisionNote.trim());
      await reloadManagement();
      setDecisionNote("");
      setMessage(
        `${item.reference} ${decision.toLowerCase()} by an independent reviewer.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Approval failed.");
    }
  }

  async function saveProfile(id: string, role: string, active: boolean) {
    try {
      await updateProfile(id, role, active);
      await reloadManagement();
      setMessage("User access updated.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "User access could not be updated.",
      );
    }
  }

  async function addUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await createAdminUser({
        email: String(values.get("email")),
        fullName: String(values.get("fullName")),
        role: String(values.get("role")),
        password: String(values.get("password")),
      });
      form.reset();
      await reloadManagement();
      setMessage("User account created and activated.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "User account could not be created.",
      );
    }
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const file = values.get("file");
    const reference = businessReferences.find(
      (item) => item.id === values.get("referenceId"),
    );
    if (!(file instanceof File) || !reference) {
      setMessage("Choose a business reference and a document file.");
      return;
    }
    try {
      const number = await uploadBusinessDocument(
        file,
        String(values.get("documentType")),
        reference,
      );
      form.reset();
      await reloadManagement();
      setMessage(`${number} uploaded as a controlled draft version.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Document upload failed.",
      );
    }
  }

  const filteredReportRows = useMemo(() => {
    const needle = reportSearch.trim().toLowerCase();
    return reportTable.rows.filter(
      (row) =>
        !needle ||
        row.values.some((value) => value.toLowerCase().includes(needle)),
    );
  }, [reportSearch, reportTable.rows]);
  const auditUsers = [...new Set(audit.map((item) => item.actor))].sort();
  const auditModules = [...new Set(audit.map((item) => item.module))].sort();
  const auditActions = [...new Set(audit.map((item) => item.action))].sort();
  const filteredAudit = useMemo(() => {
    const needle = auditSearch.trim().toLowerCase();
    return audit.filter(
      (item) =>
        (!auditFrom || item.occurredAt.slice(0, 10) >= auditFrom) &&
        (!auditTo || item.occurredAt.slice(0, 10) <= auditTo) &&
        (auditUser === "All" || item.actor === auditUser) &&
        (auditModule === "All" || item.module === auditModule) &&
        (auditAction === "All" || item.action === auditAction) &&
        (!needle ||
          `${item.reference} ${item.actor} ${item.action} ${item.module}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [
    audit,
    auditAction,
    auditFrom,
    auditModule,
    auditSearch,
    auditTo,
    auditUser,
  ]);
  const clientName = (id: string) =>
    managementClients.find((item) => item.id === id)?.legal_name ??
    "Unknown client";
  const invoicePaid = (invoiceId: string) =>
    managementPayments
      .filter((item) => item.invoice_id === invoiceId)
      .reduce(
        (sum, item) =>
          sum +
          (item.direction === "REVERSAL"
            ? -Number(item.amount_etb)
            : Number(item.amount_etb)),
        0,
      );
  const availableArrearsInvoices = managementInvoices.filter(
    (invoice) =>
      invoice.due_on &&
      daysOverdue(invoice.due_on) > 0 &&
      Number(invoice.total_etb) - invoicePaid(invoice.id) > 0 &&
      !arrearsCases.some(
        (item) => item.invoice_id === invoice.id && item.stage !== "CLOSED",
      ),
  );

  async function previewDocument() {
    if (!selectedDocument) return;
    try {
      const url = await getBusinessDocumentUrl(selectedDocument.object_path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The document preview could not be opened.",
      );
    }
  }

  async function refreshReport(nextType = reportType, reset = false) {
    setReportLoading(true);
    try {
      const next = await loadReportTable(nextType, {
        from: reset ? "" : reportFrom,
        to: reset ? "" : reportTo,
        clientId: reset ? "" : reportClientId,
      });
      setReportTable(next);
      if (reset) {
        setReportFrom("");
        setReportTo("");
        setReportClientId("");
        setReportSearch("");
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Report data could not be loaded.",
      );
    } finally {
      setReportLoading(false);
    }
  }

  function exportCurrentReport() {
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = [
      reportTable.columns.map(escape).join(","),
      ...filteredReportRows.map((row) => row.values.map(escape).join(",")),
    ].join("\n");
    downloadReport(`${reportType} report`, csv);
    setMessage(
      `Export CSV complete: ${reportType} report uses the current filters and opens in Excel.`,
    );
  }

  function auditTarget(referenceType: string) {
    if (referenceType === "WAREHOUSE_RECEIPT") return "Warehouse Receipts";
    if (
      referenceType === "PROCESSING_ORDER" ||
      referenceType === "PROCESSING_REQUEST"
    )
      return "Processing";
    if (referenceType === "DISPATCH_ORDER") return "Dispatch";
    if (referenceType === "INVOICE") return "Finance";
    if (referenceType === "COFFEE_LOT") return "Coffee Lots";
    return "Audit History";
  }

  return (
    <div className="module-page management-page">
      <section className="module-heading">
        <div>
          <span className="demo-label">MANAGEMENT CONTROL</span>
          <h1>{activeView === "Arrears Cases" ? "Collections & Arrears" : activeView}</h1>
          <p>{activeView === "Arrears Cases" ? "Follow overdue invoices from reminder to settlement. It records collection work only and never moves client coffee." : "Agreement-aligned oversight with maker-checker controls and traceable records."}</p>
        </div>
        {activeView === "Audit History" && (
          <button
            className="secondary-button"
            type="button"
            onClick={() => window.print()}
          >
            <Printer size={16} />
            Print audit view
          </button>
        )}
      </section>
      {notice}

      {activeView === "Arrears Cases" && (
        <>
          <section className="arrears-toolbar">
            <div>
              <strong>
                {arrearsCases.filter((item) => item.stage !== "CLOSED").length}{" "}
                open case(s)
              </strong>
              <span>Open a case only for an overdue invoice. Every reminder, notice, review, and settlement stays in one timeline.</span>
            </div>
            <button
              className="primary-button"
              type="button"
              onClick={() => setNewArrearsOpen(true)}
              disabled={!availableArrearsInvoices.length}
            >
              <Plus size={16} />
              Open arrears case
            </button>
          </section>
          <section className="record-panel">
            <div className="record-table arrears-list-cols">
              <div className="table-head">
                <span>Case / client</span>
                <span>Invoice</span>
                <span>Outstanding</span>
                <span>Overdue</span>
                <span>Stage</span>
                <span>Next action</span>
              </div>
              {arrearsCases.map((item) => {
                const invoice = managementInvoices.find(
                  (row) => row.id === item.invoice_id,
                );
                return (
                  <div
                    className="clickable-row"
                    role="button"
                    tabIndex={0}
                    key={item.id}
                    onClick={() => setSelectedArrearsId(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ")
                        setSelectedArrearsId(item.id);
                    }}
                  >
                    <span>
                      <strong className="reference">{item.case_number}</strong>
                      <small>{clientName(item.client_id)}</small>
                    </span>
                    <span>
                      {invoice?.invoice_number ?? item.invoice_id.slice(0, 8)}
                    </span>
                    <span>
                      <strong>
                        ETB {Number(item.outstanding_etb).toLocaleString()}
                      </strong>
                    </span>
                    <span>
                      {item.oldest_due_on
                        ? `${daysOverdue(item.oldest_due_on)} days`
                        : "-"}
                    </span>
                    <span>
                      <Status value={item.stage} />
                    </span>
                    <span>{item.next_action_on ?? "Not scheduled"}</span>
                  </div>
                );
              })}
            </div>
            {!arrearsCases.length && (
              <p className="empty-result">
                No arrears cases yet. Open one from an overdue invoice.
              </p>
            )}
          </section>
          {newArrearsOpen && (
            <div className="modal-backdrop">
              <form
                className="receipt-modal master-record-modal"
                onSubmit={openArrearsCase}
              >
                <header>
                  <div>
                    <span className="demo-label">SAVED RECOVERY CASE</span>
                    <h2>Open arrears case</h2>
                    <p>
                      Select an overdue invoice and record the first action.
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close arrears form"
                    onClick={() => setNewArrearsOpen(false)}
                  >
                    ×
                  </button>
                </header>
                <div className="form-grid">
                  <label className="wide">
                    Overdue invoice
                    <select name="invoiceId" required defaultValue="">
                      <option value="" disabled>
                        Select invoice
                      </option>
                      {availableArrearsInvoices.map((invoice) => (
                        <option key={invoice.id} value={invoice.id}>
                          {invoice.invoice_number} ·{" "}
                          {clientName(invoice.client_id)} · ETB{" "}
                          {(
                            Number(invoice.total_etb) - invoicePaid(invoice.id)
                          ).toLocaleString()}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Next action date
                    <input name="nextActionOn" type="date" />
                  </label>
                  <label className="wide">
                    Opening note
                    <textarea
                      name="note"
                      required
                      minLength={5}
                      rows={4}
                      placeholder="Reminder sent, person contacted, and agreed next step..."
                    />
                  </label>
                </div>
                <footer>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setNewArrearsOpen(false)}
                  >
                    Cancel
                  </button>
                  <button className="primary-button" type="submit">
                    Open and save case
                  </button>
                </footer>
              </form>
            </div>
          )}
        </>
      )}

      {activeView === "Reports" && (
        <>
          <section
            className="report-catalog"
            aria-label="All operational reports"
          >
            {(
              [
                "Stock",
                "Receipts",
                "Processing",
                "Dispatch",
                "Billing",
                "Storage Loss",
                "Bags",
                "Labour",
                "Generator",
                "Arrears",
                "Documents",
                "Audit",
              ] as ReportType[]
            ).map((type) => (
              <button
                className={reportType === type ? "active" : ""}
                type="button"
                key={type}
                onClick={() => {
                  setReportType(type);
                  void refreshReport(type);
                }}
              >
                {type}
                <small>
                  {type === "Bags"
                    ? "Client-owned bags"
                    : type === "Generator"
                      ? "Generator requests"
                      : `${type} records`}
                </small>
              </button>
            ))}
          </section>
          <section className="filter-toolbar report-filter-toolbar">
            <label>
              From date
              <input
                type="date"
                value={reportFrom}
                onChange={(event) => setReportFrom(event.target.value)}
              />
            </label>
            <label>
              To date
              <input
                type="date"
                min={reportFrom}
                value={reportTo}
                onChange={(event) => setReportTo(event.target.value)}
              />
            </label>
            <label>
              Report type
              <select
                value={reportType}
                onChange={(event) => {
                  const nextType = event.target.value as ReportType;
                  setReportType(nextType);
                  void refreshReport(nextType);
                }}
              >
                {(
                  [
                    "Stock",
                    "Receipts",
                    "Processing",
                    "Dispatch",
                    "Billing",
                    "Storage Loss",
                    "Bags",
                    "Labour",
                    "Generator",
                    "Arrears",
                    "Documents",
                    "Audit",
                  ] as ReportType[]
                ).map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label>
              Client
              <select
                value={reportClientId}
                onChange={(event) => setReportClientId(event.target.value)}
              >
                <option value="">All clients</option>
                {reportClients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.legal_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-search">
              <Search size={15} />
              <input
                value={reportSearch}
                onChange={(event) => setReportSearch(event.target.value)}
                placeholder="Search current report"
              />
            </label>
            <button
              className="primary-button"
              type="button"
              onClick={() => void refreshReport()}
            >
              Apply filters
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void refreshReport(reportType, true)}
            >
              Reset
            </button>
          </section>
          <section className="report-workspace panel print-surface">
            <header>
              <div>
                <h2>{reportType} report</h2>
                <p>
                  {reportLoading
                    ? "Loading database records..."
                    : `${filteredReportRows.length} record${filteredReportRows.length === 1 ? "" : "s"} with the current filters`}
                </p>
              </div>
              <div className="no-print">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => window.print()}
                >
                  <Printer size={15} />
                  Print / Save PDF
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={exportCurrentReport}
                  disabled={!reportTable.columns.length}
                >
                  <Download size={15} />
                  Export for Excel
                </button>
              </div>
            </header>
            <div className="report-table-scroll">
              <div
                className="dynamic-report-table"
                style={
                  {
                    "--report-columns": reportTable.columns.length,
                  } as React.CSSProperties
                }
              >
                <div className="table-head">
                  {reportTable.columns.map((column) => (
                    <span key={column}>{column}</span>
                  ))}
                </div>
                {filteredReportRows.map((row) => (
                  <div
                    className="clickable-row"
                    role="button"
                    tabIndex={0}
                    key={row.id}
                    onClick={() => setSelectedReportRowId(row.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ")
                        setSelectedReportRowId(row.id);
                    }}
                  >
                    {row.values.map((value, index) => (
                      <span
                        className={index === 1 ? "reference" : ""}
                        key={`${row.id}-${index}`}
                      >
                        {value}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
              {!reportLoading && filteredReportRows.length === 0 && (
                <p className="empty-result">
                  No report rows match the selected filters.
                </p>
              )}
            </div>
          </section>
        </>
      )}

      {activeView === "Documents" && (
        <>
          <div className="document-rule">
            <FileText size={19} />
            <div>
              <strong>Controlled document register</strong>
              <p>
                Choose the business record first, add one PDF/image, then touch
                any row to preview every detail.
              </p>
            </div>
          </div>
          <form
            className="document-upload professional-upload"
            onSubmit={uploadDocument}
          >
            <label>
              1. Document type
              <select name="documentType" defaultValue="SUPPORTING_DOCUMENT">
                <option value="GRN_SCAN">GRN scan</option>
                <option value="PROCESSING_EVIDENCE">Processing evidence</option>
                <option value="ECX_CHECK_EVIDENCE">ECX check evidence</option>
                <option value="PAYMENT_SLIP">Payment slip</option>
                <option value="DISPATCH_RELEASE">Dispatch release</option>
                <option value="CREDIT_APPROVAL">Credit approval</option>
                <option value="SUPPORTING_DOCUMENT">Supporting document</option>
              </select>
            </label>
            <label>
              2. Business record
              <select name="referenceId" required defaultValue="">
                <option value="" disabled>
                  Select record
                </option>
                {businessReferences.map((item) => (
                  <option key={`${item.type}-${item.id}`} value={item.id}>
                    {item.label} - {item.type.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="document-file-picker">
              3. Choose PDF or image
              <input
                name="file"
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                required
              />
            </label>
            <button className="primary-button" type="submit">
              <FileText size={15} />
              4. Upload draft
            </button>
          </form>
          <section className="record-panel">
            <div className="record-table document-cols">
              <div className="table-head">
                <span>Document</span>
                <span>Type</span>
                <span>Business reference</span>
                <span>Version</span>
                <span>Status</span>
              </div>
              {documentRecords.map((record) => (
                <div
                  className="clickable-row"
                  role="button"
                  tabIndex={0}
                  key={record.id}
                  onClick={() => setSelectedDocumentId(record.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ")
                      setSelectedDocumentId(record.id);
                  }}
                >
                  <span className="reference">
                    {record.document_number}
                    <small>{record.file_name}</small>
                  </span>
                  <span>{record.document_type.replaceAll("_", " ")}</span>
                  <span>
                    {record.reference_type.replaceAll("_", " ")}:{" "}
                    {record.business_reference}
                  </span>
                  <span>v{record.version}</span>
                  <Status value={record.status} />
                </div>
              ))}
            </div>
            {!documentRecords.length && (
              <p className="empty-result">No documents uploaded yet.</p>
            )}
          </section>
        </>
      )}

      {activeView === "Approvals" && (
        <>
          <div className="document-rule">
            <ShieldCheck size={19} />
            <div>
              <strong>Independent approval queue</strong>
              <p>
                Review the source transaction and evidence before recording a
                decision.
              </p>
            </div>
          </div>
          <div className="approval-layout">
            <section className="record-panel">
              <div className="record-table approval-cols">
                <div className="table-head">
                  <span>Reference</span>
                  <span>Request</span>
                  <span>Requested by</span>
                  <span>Age</span>
                  <span>Status</span>
                  <span>Action</span>
                </div>
                {approvals.map((item) => (
                  <div
                    className={
                      item.id === selectedApprovalId ? "selected-row" : ""
                    }
                    key={item.id}
                  >
                    <span className="reference">{item.reference}</span>
                    <span>{item.request}</span>
                    <span>{item.requestedBy}</span>
                    <span>{item.age}</span>
                    <Status value={item.status} />
                    <span className="row-actions">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedApprovalId(item.id);
                          setDecisionNote("");
                        }}
                      >
                        Details
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </section>
            {selectedApproval && (
              <aside className="panel approval-detail">
                <header>
                  <div>
                    <h2>{selectedApproval.reference}</h2>
                    <p>{selectedApproval.request}</p>
                  </div>
                  <Status value={selectedApproval.status} />
                </header>
                <dl>
                  <div>
                    <dt>Requested by</dt>
                    <dd>{selectedApproval.requestedBy}</dd>
                  </div>
                  <div>
                    <dt>Requested at</dt>
                    <dd>{selectedApproval.age}</dd>
                  </div>
                  <div>
                    <dt>Client</dt>
                    <dd>{selectedApproval.detail?.client ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>Source status</dt>
                    <dd>
                      {selectedApproval.detail?.status.replaceAll("_", " ") ??
                        "-"}
                    </dd>
                  </div>
                  {selectedApproval.detail?.fields.map((field) => (
                    <div key={field.label}>
                      <dt>{field.label}</dt>
                      <dd>{field.value}</dd>
                    </div>
                  ))}
                  <div>
                    <dt>Evidence</dt>
                    <dd>
                      {selectedApproval.detail?.documentCount ?? 0} document(s),{" "}
                      {selectedApproval.detail?.auditCount ?? 0} audit event(s)
                    </dd>
                  </div>
                </dl>
                {selectedApproval.status === "PENDING" ? (
                  <div className="approval-decision">
                    <label>
                      Decision note
                      <textarea
                        value={decisionNote}
                        onChange={(event) =>
                          setDecisionNote(event.target.value)
                        }
                        placeholder="Reason and evidence checked"
                      />
                    </label>
                    <div>
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => decideSelected("APPROVED")}
                        disabled={!decisionNote.trim()}
                      >
                        Approve
                      </button>
                      <button
                        className="secondary-button reject"
                        type="button"
                        onClick={() => decideSelected("REJECTED")}
                        disabled={!decisionNote.trim()}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="decision-record">
                    Decision:{" "}
                    {selectedApproval.decision_note ?? "No note recorded"}
                  </p>
                )}
              </aside>
            )}
          </div>
        </>
      )}

      {activeView === "Audit History" && (
        <>
          <div className="document-rule">
            <History size={19} />
            <div>
              <strong>Append-only activity history</strong>
              <p>
                Search and filter posted events. Touch an event to see the
                complete change data.
              </p>
            </div>
            <span>{filteredAudit.length} events</span>
          </div>
          <section className="filter-toolbar audit-filter-toolbar">
            <label className="filter-search">
              <Search size={15} />
              <input
                value={auditSearch}
                onChange={(event) => setAuditSearch(event.target.value)}
                placeholder="Search reference, user, action..."
              />
            </label>
            <label>
              From date
              <input
                type="date"
                value={auditFrom}
                onChange={(event) => setAuditFrom(event.target.value)}
              />
            </label>
            <label>
              To date
              <input
                type="date"
                min={auditFrom}
                value={auditTo}
                onChange={(event) => setAuditTo(event.target.value)}
              />
            </label>
            <label>
              User
              <select
                value={auditUser}
                onChange={(event) => setAuditUser(event.target.value)}
              >
                <option>All</option>
                {auditUsers.map((user) => (
                  <option key={user}>{user}</option>
                ))}
              </select>
            </label>
            <label>
              Module
              <select
                value={auditModule}
                onChange={(event) => setAuditModule(event.target.value)}
              >
                <option>All</option>
                {auditModules.map((module) => (
                  <option key={module}>{module}</option>
                ))}
              </select>
            </label>
            <label>
              Action
              <select
                value={auditAction}
                onChange={(event) => setAuditAction(event.target.value)}
              >
                <option>All</option>
                {auditActions.map((action) => (
                  <option key={action}>{action}</option>
                ))}
              </select>
            </label>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setAuditSearch("");
                setAuditFrom("");
                setAuditTo("");
                setAuditUser("All");
                setAuditModule("All");
                setAuditAction("All");
              }}
            >
              Reset
            </button>
          </section>
          <section className="record-panel">
            <div className="record-table audit-workspace-cols">
              <div className="table-head">
                <span>Date & Time</span>
                <span>User</span>
                <span>Module</span>
                <span>Action</span>
                <span>Reference</span>
              </div>
              {filteredAudit.map((item) => (
                <div
                  className="clickable-row"
                  role="button"
                  tabIndex={0}
                  key={item.id}
                  onClick={() => setSelectedAuditId(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ")
                      setSelectedAuditId(item.id);
                  }}
                >
                  <span>
                    <Clock3 size={13} /> {item.at}
                  </span>
                  <span>{item.actor}</span>
                  <span>{item.module}</span>
                  <span>{item.action}</span>
                  <span>{item.reference}</span>
                </div>
              ))}
            </div>
            {filteredAudit.length === 0 && (
              <p className="empty-result">
                No audit events match the selected filters.
              </p>
            )}
          </section>
        </>
      )}

      {activeView === "Administration" && (
        <>
          <div className="document-rule">
            <ShieldCheck size={19} />
            <div>
              <strong>User access administration</strong>
              <p>
                Create staff accounts, assign operational roles, and suspend
                access without deleting history.
              </p>
            </div>
          </div>
          <form className="admin-user-form" onSubmit={addUser}>
            <div>
              <UserPlus size={18} />
              <span>
                <strong>Create staff user</strong>
                <small>
                  The temporary password must be changed through the normal
                  recovery flow.
                </small>
              </span>
            </div>
            <label>
              Full name
              <input name="fullName" required />
            </label>
            <label>
              Work email
              <input name="email" type="email" required />
            </label>
            <label>
              Role
              <select name="role" defaultValue="viewer">
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {role.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Temporary password
              <input name="password" type="password" minLength={10} required />
            </label>
            <button className="primary-button" type="submit">
              <UserPlus size={15} />
              Create user
            </button>
          </form>
          <section className="record-panel">
            <div className="record-table five-cols">
              <div className="table-head">
                <span>User</span>
                <span>Role</span>
                <span>Access</span>
                <span>Last sign-in</span>
                <span>Action</span>
              </div>
              {profiles.map((profile) => (
                <div key={profile.id}>
                  <span>
                    <strong>{profile.full_name}</strong>
                    <small>{profile.email ?? profile.id}</small>
                  </span>
                  <span>
                    <select
                      aria-label={`Role for ${profile.full_name}`}
                      value={profile.role}
                      onChange={(event) =>
                        setProfiles((items) =>
                          items.map((item) =>
                            item.id === profile.id
                              ? { ...item, role: event.target.value }
                              : item,
                          ),
                        )
                      }
                    >
                      {roles.map((role) => (
                        <option key={role} value={role}>
                          {role.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </span>
                  <span>
                    <label>
                      <input
                        type="checkbox"
                        checked={profile.active}
                        onChange={(event) =>
                          setProfiles((items) =>
                            items.map((item) =>
                              item.id === profile.id
                                ? { ...item, active: event.target.checked }
                                : item,
                            ),
                          )
                        }
                      />{" "}
                      Active
                    </label>
                  </span>
                  <span>
                    {profile.last_sign_in_at
                      ? new Date(profile.last_sign_in_at).toLocaleString()
                      : "Never"}
                  </span>
                  <span>
                    <button
                      className="table-action"
                      type="button"
                      onClick={() =>
                        saveProfile(profile.id, profile.role, profile.active)
                      }
                    >
                      Save
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
      {selectedDocument && (
        <RecordDetailDrawer
          open
          eyebrow="CONTROLLED DOCUMENT"
          title={selectedDocument.document_number}
          subtitle={selectedDocument.file_name}
          status={<Status value={selectedDocument.status} />}
          onClose={() => setSelectedDocumentId("")}
          actions={
            <button
              className="primary-button"
              type="button"
              onClick={() => void previewDocument()}
            >
              <Eye size={16} />
              Preview file
            </button>
          }
        >
          <DetailGrid
            items={[
              {
                label: "Document type",
                value: selectedDocument.document_type.replaceAll("_", " "),
              },
              {
                label: "Business reference",
                value: selectedDocument.business_reference,
              },
              {
                label: "Reference type",
                value: selectedDocument.reference_type.replaceAll("_", " "),
              },
              { label: "Version", value: `v${selectedDocument.version}` },
              { label: "File type", value: selectedDocument.mime_type },
              {
                label: "Size",
                value: `${(selectedDocument.size_bytes / 1024).toFixed(1)} KB`,
              },
              {
                label: "Uploaded",
                value: new Date(selectedDocument.created_at).toLocaleString(),
              },
            ]}
          />
        </RecordDetailDrawer>
      )}
      {selectedAudit && (
        <RecordDetailDrawer
          open
          eyebrow="AUDIT EVENT"
          title={selectedAudit.action}
          subtitle={selectedAudit.reference}
          onClose={() => setSelectedAuditId("")}
          actions={
            onNavigate &&
            auditTarget(selectedAudit.referenceType) !== "Audit History" ? (
              <button
                className="primary-button"
                type="button"
                onClick={() =>
                  onNavigate({
                    view: auditTarget(selectedAudit.referenceType),
                    focusId: selectedAudit.referenceId,
                  })
                }
              >
                Open source record <ArrowRight size={15} />
              </button>
            ) : undefined
          }
        >
          <DetailGrid
            items={[
              { label: "Date and time", value: selectedAudit.at },
              { label: "User", value: selectedAudit.actor },
              { label: "Module", value: selectedAudit.module },
              { label: "Reference", value: selectedAudit.reference },
              { label: "Reference ID", value: selectedAudit.referenceId },
            ]}
          />
          <DetailSection
            title="Recorded change data"
            help="This database event is read-only."
          >
            <pre className="event-data">
              {JSON.stringify(selectedAudit.eventData, null, 2)}
            </pre>
          </DetailSection>
        </RecordDetailDrawer>
      )}
      {selectedReportRow && (
        <RecordDetailDrawer
          open
          eyebrow={`${reportType.toUpperCase()} REPORT RECORD`}
          title={
            selectedReportRow.values[1] ??
            selectedReportRow.values[0] ??
            "Report record"
          }
          subtitle="Complete values from the current report"
          onClose={() => setSelectedReportRowId("")}
        >
          <DetailGrid
            items={reportTable.columns.map((column, index) => ({
              label: column,
              value: selectedReportRow.values[index] ?? "-",
            }))}
          />
        </RecordDetailDrawer>
      )}
      {selectedArrears &&
        (() => {
          const invoice = managementInvoices.find(
            (item) => item.id === selectedArrears.invoice_id,
          );
          const next = nextArrearsStage(selectedArrears.stage as ArrearsStage);
          return (
            <RecordDetailDrawer
              open
              eyebrow="ARREARS CASE"
              title={selectedArrears.case_number}
              subtitle={`${clientName(selectedArrears.client_id)} · ${invoice?.invoice_number ?? "Invoice"}`}
              status={<Status value={selectedArrears.stage} />}
              onClose={() => setSelectedArrearsId("")}
            >
              <DetailGrid
                items={[
                  {
                    label: "Outstanding",
                    value: `ETB ${Number(selectedArrears.outstanding_etb).toLocaleString()}`,
                  },
                  {
                    label: "Oldest due date",
                    value: selectedArrears.oldest_due_on ?? "-",
                  },
                  {
                    label: "Days overdue",
                    value: selectedArrears.oldest_due_on
                      ? `${daysOverdue(selectedArrears.oldest_due_on)} days`
                      : "-",
                  },
                  {
                    label: "Next action",
                    value: selectedArrears.next_action_on ?? "Not scheduled",
                  },
                ]}
              />
              <div className="arrears-timeline compact">
                {[
                  "MONITORING",
                  "PAYMENT_REMINDER",
                  "FORMAL_NOTICE",
                  "MANAGEMENT_REVIEW",
                  "LEGAL_REVIEW",
                  "AGREED_SETTLEMENT",
                  "CLOSED",
                ].map((stage) => (
                  <span
                    className={stage === selectedArrears.stage ? "active" : ""}
                    key={stage}
                  >
                    {stage.replaceAll("_", " ")}
                  </span>
                ))}
              </div>
              <DetailSection title="Saved case history">
                {arrearsEvents
                  .filter((item) => item.case_id === selectedArrears.id)
                  .map((event) => (
                    <div className="detail-list-row" key={event.id}>
                      <span>
                        <strong>{event.to_stage.replaceAll("_", " ")}</strong>
                        <small>
                          {new Date(event.created_at).toLocaleString()}
                        </small>
                      </span>
                      <span>{event.note}</span>
                    </div>
                  ))}
              </DetailSection>
              {next && (
                <DetailSection
                  title={`Move to ${next.replaceAll("_", " ")}`}
                  help="A note is required and becomes part of the permanent history."
                >
                  <div className="drawer-form">
                    <label className="wide">
                      Action note
                      <textarea
                        rows={3}
                        value={arrearsNote}
                        onChange={(event) => setArrearsNote(event.target.value)}
                        placeholder="What was done, who was contacted, and the result"
                      />
                    </label>
                    <label>
                      Next action date
                      <input
                        type="date"
                        value={arrearsNextDate}
                        onChange={(event) =>
                          setArrearsNextDate(event.target.value)
                        }
                      />
                    </label>
                    <button
                      className="primary-button wide"
                      type="button"
                      onClick={() => void advanceCase()}
                      disabled={!arrearsNote.trim()}
                    >
                      Move to {next.replaceAll("_", " ")}{" "}
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </DetailSection>
              )}
              <EvidenceUploader
                reference={{
                  type: "ARREARS_CASE",
                  id: selectedArrears.id,
                  label: selectedArrears.case_number,
                }}
                documentType="ARREARS_EVIDENCE"
                label="Recovery evidence"
                help="Attach invoice, statement, reminder, notice, or settlement evidence."
              />
              <div className="stock-control-note">
                <LockKeyhole size={16} />
                Arrears actions never move or transfer client-owned coffee.
              </div>
            </RecordDetailDrawer>
          );
        })()}
    </div>
  );
}
