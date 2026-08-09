"use client";

import { AlertTriangle, ArrowRight, Check, Clock3, Download, FileText, History, LockKeyhole, Printer, Scale, Search, ShieldCheck, UserPlus } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { advanceArrearsCase, nextArrearsStage, type ArrearsStage, type AuditEntry } from "./management-rules";
import { createAdminUser, decideApproval, loadManagementData, loadReportTable, updateProfile, uploadBusinessDocument, type ApprovalRow, type BusinessReference, type ReportTable, type ReportType } from "@/lib/erp-data";

export const managementViews = ["Arrears Cases", "Reports", "Documents", "Approvals", "Audit History", "Administration"];

const documents = [
  ["DOC-2026-0142", "Warehouse receipt", "GRN-2026-0040", "v1", "POSTED"],
  ["DOC-2026-0138", "Processing reconciliation", "PRO-2026-0014", "v2", "APPROVED"],
  ["DOC-2026-0131", "Dispatch release", "DSP-2026-0008", "v1", "AWAITING_APPROVAL"],
  ["DOC-2026-0127", "Invoice", "INV-2026-0018", "v1", "ISSUED"],
  ["DOC-2026-0119", "Credit approval", "CRD-2026-0003", "v1", "EXPIRED"],
];
const roles = ["system_admin", "warehouse_manager", "warehouse_officer", "processing_supervisor", "finance_officer", "auditor", "viewer"];
type ApprovalItem = ApprovalRow & { reference: string; request: string; requestedBy: string; age: string };
type AuditViewRow = AuditEntry & { occurredAt: string; userId: string; module: string; referenceType: string; referenceId: string };

function Status({ value }: { value: string }) {
  return <span className={`status-pill ${value.toLowerCase().replaceAll("_", "-")}`}>{value.replaceAll("_", " ")}</span>;
}

function downloadReport(title: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title.toLowerCase().replaceAll(" ", "-")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ManagementOperations({ activeView, onNavigate }: { activeView: string; onNavigate?: (intent: { view: string; focusId?: string }) => void }) {
  const [scopedMessage, setScopedMessage] = useState({ view: "", text: "" });
  const message = scopedMessage.view === activeView ? scopedMessage.text : "";
  const setMessage = (text: string) => setScopedMessage({ view: activeView, text });
  const [arrearsStage, setArrearsStage] = useState<ArrearsStage>("PAYMENT_REMINDER");
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [selectedApprovalId, setSelectedApprovalId] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [documentRows, setDocumentRows] = useState(documents);
  const [audit, setAudit] = useState<AuditViewRow[]>([]);
  const [profiles, setProfiles] = useState<{ id: string; email?: string; full_name: string; role: string; active: boolean; last_sign_in_at?: string | null }[]>([]);
  const [businessReferences, setBusinessReferences] = useState<BusinessReference[]>([]);
  const [reportClients, setReportClients] = useState<{ id: string; legal_name: string }[]>([]);
  const [reportType, setReportType] = useState<ReportType>("Stock");
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [reportClientId, setReportClientId] = useState("");
  const [reportSearch, setReportSearch] = useState("");
  const [reportTable, setReportTable] = useState<ReportTable>({ columns: [], rows: [] });
  const [reportLoading, setReportLoading] = useState(false);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const [auditUser, setAuditUser] = useState("All");
  const [auditModule, setAuditModule] = useState("All");
  const [auditAction, setAuditAction] = useState("All");

  const next = nextArrearsStage(arrearsStage);
  const selectedApproval = approvals.find((item) => item.id === selectedApprovalId);
  const notice = message && <div className="operation-message" role="status"><Check size={17} />{message}<button type="button" onClick={() => setScopedMessage({ view: activeView, text: "" })}>Close</button></div>;

  async function reloadManagement() {
    try {
      const data = await loadManagementData();
      const profileById = new Map(data.profiles.map((profile) => [profile.id, profile.full_name]));
      setProfiles(data.adminUsers.length ? data.adminUsers : data.profiles);
      setBusinessReferences(data.businessReferences);
      setReportClients(data.clients);
      const nextApprovals = data.approvals.map((item) => ({ ...item, reference: item.business_reference ?? item.reference_id.slice(0, 8).toUpperCase(), request: item.request_type.replaceAll("_", " "), requestedBy: profileById.get(item.requested_by) ?? "Unknown user", age: new Date(item.requested_at).toLocaleString() }));
      setApprovals(nextApprovals);
      setSelectedApprovalId((current) => nextApprovals.some((item) => item.id === current) ? current : nextApprovals[0]?.id ?? "");
      setDocumentRows(data.documents.map((item) => [item.document_number, item.document_type.replaceAll("_", " "), `${item.reference_type.replaceAll("_", " ")}: ${item.business_reference}`, `v${item.version}`, item.status]));
      setAudit(data.audit.map((item) => ({ id: item.id.slice(-8).toUpperCase(), occurredAt: item.occurred_at, at: new Date(item.occurred_at).toLocaleString(), userId: item.actor_id, actor: profileById.get(item.actor_id) ?? "Unknown user", module: item.reference_type.replaceAll("_", " "), referenceType: item.reference_type, referenceId: item.reference_id, action: item.action.replaceAll("_", " "), reference: item.business_reference ?? item.reference_id.slice(-8).toUpperCase() })));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Management records could not be loaded.");
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void reloadManagement(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (activeView === "Reports" && reportTable.columns.length === 0) void refreshReport("Stock"); }, [activeView]);

  function advanceCase() {
    if (!next) return;
    const result = advanceArrearsCase(arrearsStage, next);
    setArrearsStage(result.stage);
    setAudit((log) => [...log, { id: `AUD-LOCAL-${log.length + 1}`, occurredAt: new Date().toISOString(), at: new Date().toLocaleString(), userId: "local", actor: "Local user", module: "ARREARS CASE", referenceType: "ARREARS_CASE", referenceId: "ARR-2026-0004", action: `Arrears moved to ${result.stage.replaceAll("_", " ")}`, reference: "ARR-2026-0004" }]);
    setMessage("Arrears stage updated. No stock or ownership movement was created.");
  }

  async function decideSelected(decision: "APPROVED" | "REJECTED") {
    const item = approvals.find((approval) => approval.id === selectedApprovalId);
    if (!item) return;
    if (!decisionNote.trim()) { setMessage("Enter a decision note before approving or rejecting."); return; }
    try {
      await decideApproval(item.id, decision, decisionNote.trim());
      await reloadManagement();
      setDecisionNote("");
      setMessage(`${item.reference} ${decision.toLowerCase()} by an independent reviewer.`);
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
      setMessage(error instanceof Error ? error.message : "User access could not be updated.");
    }
  }

  async function addUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await createAdminUser({ email: String(values.get("email")), fullName: String(values.get("fullName")), role: String(values.get("role")), password: String(values.get("password")) });
      form.reset(); await reloadManagement(); setMessage("User account created and activated.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "User account could not be created."); }
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const file = values.get("file");
    const reference = businessReferences.find((item) => item.id === values.get("referenceId"));
    if (!(file instanceof File) || !reference) { setMessage("Choose a business reference and a document file."); return; }
    try {
      const number = await uploadBusinessDocument(file, String(values.get("documentType")), reference);
      form.reset();
      await reloadManagement();
      setMessage(`${number} uploaded as a controlled draft version.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Document upload failed."); }
  }

  const filteredReportRows = useMemo(() => {
    const needle = reportSearch.trim().toLowerCase();
    return reportTable.rows.filter((row) => !needle || row.values.some((value) => value.toLowerCase().includes(needle)));
  }, [reportSearch, reportTable.rows]);
  const auditUsers = [...new Set(audit.map((item) => item.actor))].sort();
  const auditModules = [...new Set(audit.map((item) => item.module))].sort();
  const auditActions = [...new Set(audit.map((item) => item.action))].sort();
  const filteredAudit = useMemo(() => {
    const needle = auditSearch.trim().toLowerCase();
    return audit.filter((item) => (!auditFrom || item.occurredAt.slice(0, 10) >= auditFrom) && (!auditTo || item.occurredAt.slice(0, 10) <= auditTo) && (auditUser === "All" || item.actor === auditUser) && (auditModule === "All" || item.module === auditModule) && (auditAction === "All" || item.action === auditAction) && (!needle || `${item.reference} ${item.actor} ${item.action} ${item.module}`.toLowerCase().includes(needle)));
  }, [audit, auditAction, auditFrom, auditModule, auditSearch, auditTo, auditUser]);

  async function refreshReport(nextType = reportType, reset = false) {
    setReportLoading(true);
    try {
      const next = await loadReportTable(nextType, { from: reset ? "" : reportFrom, to: reset ? "" : reportTo, clientId: reset ? "" : reportClientId });
      setReportTable(next);
      if (reset) { setReportFrom(""); setReportTo(""); setReportClientId(""); setReportSearch(""); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Report data could not be loaded."); }
    finally { setReportLoading(false); }
  }

  function exportCurrentReport() {
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = [reportTable.columns.map(escape).join(","), ...filteredReportRows.map((row) => row.values.map(escape).join(","))].join("\n");
    downloadReport(`${reportType} report`, csv);
    setMessage(`${reportType} report exported with the current filters.`);
  }

  function auditTarget(referenceType: string) {
    if (referenceType === "WAREHOUSE_RECEIPT") return "Warehouse Receipts";
    if (referenceType === "PROCESSING_ORDER" || referenceType === "PROCESSING_REQUEST") return "Processing";
    if (referenceType === "DISPATCH_ORDER") return "Dispatch";
    if (referenceType === "INVOICE") return "Finance";
    if (referenceType === "COFFEE_LOT") return "Coffee Lots";
    return "Audit History";
  }

  return <div className="module-page management-page">
    <section className="module-heading"><div><span className="demo-label">MANAGEMENT CONTROL</span><h1>{activeView}</h1><p>Agreement-aligned oversight with maker-checker controls and traceable records.</p></div>{activeView === "Audit History" && <button className="secondary-button" type="button" onClick={() => window.print()}><Printer size={16} />Print audit view</button>}</section>
    {notice}

    {activeView === "Arrears Cases" && <div className="arrears-layout">
      <section className="panel arrears-case"><header><div><h2>ARR-2026-0004 - Guji Specialty Coffee PLC</h2><p>Opened from unpaid invoice INV-2026-0018</p></div><Status value={arrearsStage} /></header><div className="arrears-summary"><div><span>Outstanding</span><strong>ETB 54,640</strong></div><div><span>Oldest due date</span><strong>15 Jul 2026</strong></div><div><span>Days overdue</span><strong>17 days</strong></div></div><div className="arrears-timeline">{["MONITORING", "PAYMENT_REMINDER", "FORMAL_NOTICE", "MANAGEMENT_REVIEW", "LEGAL_REVIEW", "AGREED_SETTLEMENT", "CLOSED"].map((stage) => <span className={stage === arrearsStage ? "active" : ""} key={stage}>{stage.replaceAll("_", " ")}</span>)}</div><footer><AlertTriangle size={17} /><p>Recovery actions never transfer, sell, reserve, or otherwise move client-owned coffee.</p>{next && <button className="primary-button" type="button" onClick={advanceCase}>Move to {next.replaceAll("_", " ")} <ArrowRight size={15} /></button>}</footer></section>
      <section className="panel recovery-evidence"><header><div><h2>Recovery evidence</h2><p>Required before legal escalation</p></div><Scale size={19} /></header><label><input type="checkbox" defaultChecked /> Invoice and statement attached</label><label><input type="checkbox" defaultChecked /> Payment reminder delivered</label><label><input type="checkbox" /> Formal notice acknowledged</label><label><input type="checkbox" /> Management review recorded</label><div><LockKeyhole size={16} />Client stock remains under the normal release controls.</div></section>
    </div>}

    {activeView === "Reports" && <><section className="filter-toolbar report-filter-toolbar"><label>From date<input type="date" value={reportFrom} onChange={(event) => setReportFrom(event.target.value)} /></label><label>To date<input type="date" min={reportFrom} value={reportTo} onChange={(event) => setReportTo(event.target.value)} /></label><label>Report type<select value={reportType} onChange={(event) => { const nextType = event.target.value as ReportType; setReportType(nextType); void refreshReport(nextType); }}>{(["Stock", "Receipts", "Processing", "Dispatch", "Billing"] as ReportType[]).map((type) => <option key={type}>{type}</option>)}</select></label><label>Client<select value={reportClientId} onChange={(event) => setReportClientId(event.target.value)}><option value="">All clients</option>{reportClients.map((client) => <option key={client.id} value={client.id}>{client.legal_name}</option>)}</select></label><label className="filter-search"><Search size={15} /><input value={reportSearch} onChange={(event) => setReportSearch(event.target.value)} placeholder="Search current report" /></label><button className="primary-button" type="button" onClick={() => void refreshReport()}>Apply</button><button className="secondary-button" type="button" onClick={() => void refreshReport(reportType, true)}>Reset</button></section><section className="report-workspace panel"><header><div><h2>{reportType} report</h2><p>{reportLoading ? "Loading database records..." : `${filteredReportRows.length} record${filteredReportRows.length === 1 ? "" : "s"} with the current filters`}</p></div><div><button className="secondary-button" type="button" onClick={() => window.print()}><Printer size={15} />Print</button><button className="primary-button" type="button" onClick={exportCurrentReport} disabled={!reportTable.columns.length}><Download size={15} />Export CSV</button></div></header><div className="report-table-scroll"><div className="dynamic-report-table" style={{ "--report-columns": reportTable.columns.length } as React.CSSProperties}><div className="table-head">{reportTable.columns.map((column) => <span key={column}>{column}</span>)}</div>{filteredReportRows.map((row) => <div key={row.id}>{row.values.map((value, index) => <span className={index === 1 ? "reference" : ""} key={`${row.id}-${index}`}>{value}</span>)}</div>)}</div>{!reportLoading && filteredReportRows.length === 0 && <p className="empty-result">No report rows match the selected filters.</p>}</div></section></>}

    {activeView === "Documents" && <><div className="document-rule"><FileText size={19} /><div><strong>Controlled document register</strong><p>Uploads are checksummed. A correction creates a linked version instead of overwriting the previous file.</p></div></div><form className="document-upload" onSubmit={uploadDocument}><label>Document type<select name="documentType" defaultValue="SUPPORTING_DOCUMENT"><option value="GRN_SCAN">GRN scan</option><option value="PROCESSING_EVIDENCE">Processing evidence</option><option value="DISPATCH_RELEASE">Dispatch release</option><option value="CREDIT_APPROVAL">Credit approval</option><option value="SUPPORTING_DOCUMENT">Supporting document</option></select></label><label>Business reference<select name="referenceId" required defaultValue=""><option value="" disabled>Select record</option>{businessReferences.map((item) => <option key={`${item.type}-${item.id}`} value={item.id}>{item.label} - {item.type.replaceAll("_", " ")}</option>)}</select></label><label>File<input name="file" type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" required /></label><button className="primary-button" type="submit"><FileText size={15} />Upload draft</button></form><section className="record-panel"><div className="record-table document-cols"><div className="table-head"><span>Document</span><span>Type</span><span>Business reference</span><span>Version</span><span>Status</span></div>{documentRows.map((row) => <div key={row[0]}>{row.map((cell, index) => index === 4 ? <Status value={cell} key={cell} /> : <span className={index === 0 ? "reference" : ""} key={cell}>{cell}</span>)}</div>)}</div></section></>}

    {activeView === "Approvals" && <><div className="document-rule"><ShieldCheck size={19} /><div><strong>Independent approval queue</strong><p>Review the source transaction and evidence before recording a decision.</p></div></div><div className="approval-layout"><section className="record-panel"><div className="record-table approval-cols"><div className="table-head"><span>Reference</span><span>Request</span><span>Requested by</span><span>Age</span><span>Status</span><span>Action</span></div>{approvals.map((item) => <div className={item.id === selectedApprovalId ? "selected-row" : ""} key={item.id}><span className="reference">{item.reference}</span><span>{item.request}</span><span>{item.requestedBy}</span><span>{item.age}</span><Status value={item.status} /><span className="row-actions"><button type="button" onClick={() => { setSelectedApprovalId(item.id); setDecisionNote(""); }}>Details</button></span></div>)}</div></section>{selectedApproval && <aside className="panel approval-detail"><header><div><h2>{selectedApproval.reference}</h2><p>{selectedApproval.request}</p></div><Status value={selectedApproval.status} /></header><dl><div><dt>Requested by</dt><dd>{selectedApproval.requestedBy}</dd></div><div><dt>Requested at</dt><dd>{selectedApproval.age}</dd></div><div><dt>Client</dt><dd>{selectedApproval.detail?.client ?? "-"}</dd></div><div><dt>Source status</dt><dd>{selectedApproval.detail?.status.replaceAll("_", " ") ?? "-"}</dd></div>{selectedApproval.detail?.fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}<div><dt>Evidence</dt><dd>{selectedApproval.detail?.documentCount ?? 0} document(s), {selectedApproval.detail?.auditCount ?? 0} audit event(s)</dd></div></dl>{selectedApproval.status === "PENDING" ? <div className="approval-decision"><label>Decision note<textarea value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="Reason and evidence checked" /></label><div><button className="primary-button" type="button" onClick={() => decideSelected("APPROVED")} disabled={!decisionNote.trim()}>Approve</button><button className="secondary-button reject" type="button" onClick={() => decideSelected("REJECTED")} disabled={!decisionNote.trim()}>Reject</button></div></div> : <p className="decision-record">Decision: {selectedApproval.decision_note ?? "No note recorded"}</p>}</aside>}</div></>}

    {activeView === "Audit History" && <><div className="document-rule"><History size={19} /><div><strong>Append-only activity history</strong><p>Search and filter posted events. Audit records remain read-only.</p></div><span>{filteredAudit.length} events</span></div><section className="filter-toolbar audit-filter-toolbar"><label className="filter-search"><Search size={15} /><input value={auditSearch} onChange={(event) => setAuditSearch(event.target.value)} placeholder="Search reference, user, action..." /></label><label>From date<input type="date" value={auditFrom} onChange={(event) => setAuditFrom(event.target.value)} /></label><label>To date<input type="date" min={auditFrom} value={auditTo} onChange={(event) => setAuditTo(event.target.value)} /></label><label>User<select value={auditUser} onChange={(event) => setAuditUser(event.target.value)}><option>All</option>{auditUsers.map((user) => <option key={user}>{user}</option>)}</select></label><label>Module<select value={auditModule} onChange={(event) => setAuditModule(event.target.value)}><option>All</option>{auditModules.map((module) => <option key={module}>{module}</option>)}</select></label><label>Action<select value={auditAction} onChange={(event) => setAuditAction(event.target.value)}><option>All</option>{auditActions.map((action) => <option key={action}>{action}</option>)}</select></label><button className="secondary-button" type="button" onClick={() => { setAuditSearch(""); setAuditFrom(""); setAuditTo(""); setAuditUser("All"); setAuditModule("All"); setAuditAction("All"); }}>Reset</button></section><section className="record-panel"><div className="record-table audit-workspace-cols"><div className="table-head"><span>Date & Time</span><span>User</span><span>Module</span><span>Action</span><span>Reference</span></div>{filteredAudit.map((item) => <div key={item.id}><span><Clock3 size={13} /> {item.at}</span><span>{item.actor}</span><span>{item.module}</span><span>{item.action}</span><span>{onNavigate && auditTarget(item.referenceType) !== "Audit History" ? <button className="link-button reference" type="button" onClick={() => onNavigate({ view: auditTarget(item.referenceType), focusId: item.referenceId })}>{item.reference}</button> : item.reference}</span></div>)}</div>{filteredAudit.length === 0 && <p className="empty-result">No audit events match the selected filters.</p>}</section></>}

    {activeView === "Administration" && <><div className="document-rule"><ShieldCheck size={19} /><div><strong>User access administration</strong><p>Create staff accounts, assign operational roles, and suspend access without deleting history.</p></div></div><form className="admin-user-form" onSubmit={addUser}><div><UserPlus size={18} /><span><strong>Create staff user</strong><small>The temporary password must be changed through the normal recovery flow.</small></span></div><label>Full name<input name="fullName" required /></label><label>Work email<input name="email" type="email" required /></label><label>Role<select name="role" defaultValue="viewer">{roles.map((role) => <option key={role} value={role}>{role.replaceAll("_", " ")}</option>)}</select></label><label>Temporary password<input name="password" type="password" minLength={10} required /></label><button className="primary-button" type="submit"><UserPlus size={15} />Create user</button></form><section className="record-panel"><div className="record-table five-cols"><div className="table-head"><span>User</span><span>Role</span><span>Access</span><span>Last sign-in</span><span>Action</span></div>{profiles.map((profile) => <div key={profile.id}><span><strong>{profile.full_name}</strong><small>{profile.email ?? profile.id}</small></span><span><select aria-label={`Role for ${profile.full_name}`} value={profile.role} onChange={(event) => setProfiles((items) => items.map((item) => item.id === profile.id ? { ...item, role: event.target.value } : item))}>{roles.map((role) => <option key={role} value={role}>{role.replaceAll("_", " ")}</option>)}</select></span><span><label><input type="checkbox" checked={profile.active} onChange={(event) => setProfiles((items) => items.map((item) => item.id === profile.id ? { ...item, active: event.target.checked } : item))} /> Active</label></span><span>{profile.last_sign_in_at ? new Date(profile.last_sign_in_at).toLocaleString() : "Never"}</span><span><button className="table-action" type="button" onClick={() => saveProfile(profile.id, profile.role, profile.active)}>Save</button></span></div>)}</div></section></>}
  </div>;
}
