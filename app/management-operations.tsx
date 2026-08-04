"use client";

import { AlertTriangle, ArrowRight, Check, Clock3, Download, FileCheck2, FileText, History, LockKeyhole, Printer, Scale, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { advanceArrearsCase, appendAudit, nextArrearsStage, type ArrearsStage, type AuditEntry } from "./management-rules";
import { decideApproval, loadManagementData, loadOperationalReport, updateProfile, uploadBusinessDocument, type BusinessReference } from "@/lib/erp-data";

export const managementViews = ["Arrears Cases", "Reports", "Documents", "Approvals", "Audit History", "Administration"];

const reports = [
  ["Current stock position", "Operations", "Live", "Client, lot, ownership, section, bags and kilograms"],
  ["Warehouse receipts", "Warehouse", "Daily", "GRN status, arrival date, vehicle and posted quantity"],
  ["Processing reconciliation", "Processing", "Per shift", "Input and four-part output mass balance"],
  ["Dispatch and ECS", "Dispatch", "Daily", "Released, in-transit and destination-received quantities"],
  ["Outstanding balances", "Finance", "Daily", "Issued invoices, allocated payments and arrears stage"],
];

const documents = [
  ["DOC-2026-0142", "Warehouse receipt", "GRN-2026-0040", "v1", "POSTED"],
  ["DOC-2026-0138", "Processing reconciliation", "PRO-2026-0014", "v2", "APPROVED"],
  ["DOC-2026-0131", "Dispatch release", "DSP-2026-0008", "v1", "AWAITING_APPROVAL"],
  ["DOC-2026-0127", "Invoice", "INV-2026-0018", "v1", "ISSUED"],
  ["DOC-2026-0119", "Credit approval", "CRD-2026-0003", "v1", "EXPIRED"],
];

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

export function ManagementOperations({ activeView }: { activeView: string }) {
  const [scopedMessage, setScopedMessage] = useState({ view: "", text: "" });
  const message = scopedMessage.view === activeView ? scopedMessage.text : "";
  const setMessage = (text: string) => setScopedMessage({ view: activeView, text });
  const [arrearsStage, setArrearsStage] = useState<ArrearsStage>("PAYMENT_REMINDER");
  const [approvals, setApprovals] = useState<{ databaseId: string; reference: string; request: string; requestedBy: string; age: string; status: string }[]>([]);
  const [documentRows, setDocumentRows] = useState(documents);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [profiles, setProfiles] = useState<{ id: string; email?: string; full_name: string; role: string; active: boolean; last_sign_in_at?: string | null }[]>([]);
  const [businessReferences, setBusinessReferences] = useState<BusinessReference[]>([]);

  const next = nextArrearsStage(arrearsStage);
  const notice = message && <div className="operation-message" role="status"><Check size={17} />{message}<button type="button" onClick={() => setScopedMessage({ view: activeView, text: "" })}>Close</button></div>;

  async function reloadManagement() {
    try {
      const data = await loadManagementData();
      const profileById = new Map(data.profiles.map((profile) => [profile.id, profile.full_name]));
      setProfiles(data.adminUsers.length ? data.adminUsers : data.profiles);
      setBusinessReferences(data.businessReferences);
      setApprovals(data.approvals.map((item) => ({ databaseId: item.id, reference: item.business_reference ?? item.reference_id.slice(0, 8).toUpperCase(), request: item.request_type.replaceAll("_", " "), requestedBy: profileById.get(item.requested_by) ?? "Unknown user", age: new Date(item.requested_at).toLocaleString(), status: item.status })));
      setDocumentRows(data.documents.map((item) => [item.document_number, item.document_type.replaceAll("_", " "), `${item.reference_type.replaceAll("_", " ")}: ${item.business_reference}`, `v${item.version}`, item.status]));
      setAudit(data.audit.map((item) => ({ id: item.id.slice(0, 8).toUpperCase(), at: new Date(item.occurred_at).toLocaleString(), actor: profileById.get(item.actor_id) ?? "Unknown user", action: item.action.replaceAll("_", " "), reference: `${item.reference_type.replaceAll("_", " ")}: ${item.business_reference}` })));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Management records could not be loaded.");
    }
  }

  async function exportReport(title: string) {
    try { downloadReport(title, await loadOperationalReport(title)); setMessage(`${title} exported from current database records.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Report export failed."); }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void reloadManagement(); }, []);

  function advanceCase() {
    if (!next) return;
    const result = advanceArrearsCase(arrearsStage, next);
    setArrearsStage(result.stage);
    setAudit((log) => appendAudit(log, { id: `AUD-LOCAL-${log.length + 1}`, at: "01 Aug 2026 - now", actor: "Meron Tadesse", action: `Arrears moved to ${result.stage.replaceAll("_", " ")}`, reference: "ARR-2026-0004" }));
    setMessage("Arrears stage updated. No stock or ownership movement was created.");
  }

  async function approve(reference: string) {
    const item = approvals.find((approval) => approval.reference === reference);
    if (!item) return;
    try {
      await decideApproval(item.databaseId, "APPROVED");
      await reloadManagement();
      setMessage(`${reference} approved by an independent reviewer.`);
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

  return <div className="module-page management-page">
    <section className="module-heading"><div><span className="demo-label">MANAGEMENT CONTROL</span><h1>{activeView}</h1><p>Agreement-aligned oversight with maker-checker controls and traceable records.</p></div>{activeView === "Audit History" && <button className="secondary-button" type="button" onClick={() => window.print()}><Printer size={16} />Print audit view</button>}</section>
    {notice}

    {activeView === "Arrears Cases" && <div className="arrears-layout">
      <section className="panel arrears-case"><header><div><h2>ARR-2026-0004 - Guji Specialty Coffee PLC</h2><p>Opened from unpaid invoice INV-2026-0018</p></div><Status value={arrearsStage} /></header><div className="arrears-summary"><div><span>Outstanding</span><strong>ETB 54,640</strong></div><div><span>Oldest due date</span><strong>15 Jul 2026</strong></div><div><span>Days overdue</span><strong>17 days</strong></div></div><div className="arrears-timeline">{["MONITORING", "PAYMENT_REMINDER", "FORMAL_NOTICE", "MANAGEMENT_REVIEW", "LEGAL_REVIEW", "AGREED_SETTLEMENT", "CLOSED"].map((stage) => <span className={stage === arrearsStage ? "active" : ""} key={stage}>{stage.replaceAll("_", " ")}</span>)}</div><footer><AlertTriangle size={17} /><p>Recovery actions never transfer, sell, reserve, or otherwise move client-owned coffee.</p>{next && <button className="primary-button" type="button" onClick={advanceCase}>Move to {next.replaceAll("_", " ")} <ArrowRight size={15} /></button>}</footer></section>
      <section className="panel recovery-evidence"><header><div><h2>Recovery evidence</h2><p>Required before legal escalation</p></div><Scale size={19} /></header><label><input type="checkbox" defaultChecked /> Invoice and statement attached</label><label><input type="checkbox" defaultChecked /> Payment reminder delivered</label><label><input type="checkbox" /> Formal notice acknowledged</label><label><input type="checkbox" /> Management review recorded</label><div><LockKeyhole size={16} />Client stock remains under the normal release controls.</div></section>
    </div>}

    {activeView === "Reports" && <section className="report-grid">{reports.map(([title, owner, cadence, description]) => <article className="panel report-card" key={title}><header><div><h2>{title}</h2><p>{description}</p></div><FileCheck2 size={19} /></header><div><span>Owner<strong>{owner}</strong></span><span>Refresh<strong>{cadence}</strong></span></div><footer><button className="secondary-button" type="button" onClick={() => window.print()}><Printer size={15} />Print</button><button className="primary-button" type="button" onClick={() => void exportReport(title)}><Download size={15} />CSV</button></footer></article>)}</section>}

    {activeView === "Documents" && <><div className="document-rule"><FileText size={19} /><div><strong>Controlled document register</strong><p>Uploads are checksummed. A correction creates a linked version instead of overwriting the previous file.</p></div></div><form className="document-upload" onSubmit={uploadDocument}><label>Document type<select name="documentType" defaultValue="SUPPORTING_DOCUMENT"><option value="GRN_SCAN">GRN scan</option><option value="PROCESSING_EVIDENCE">Processing evidence</option><option value="DISPATCH_RELEASE">Dispatch release</option><option value="CREDIT_APPROVAL">Credit approval</option><option value="SUPPORTING_DOCUMENT">Supporting document</option></select></label><label>Business reference<select name="referenceId" required defaultValue=""><option value="" disabled>Select record</option>{businessReferences.map((item) => <option key={`${item.type}-${item.id}`} value={item.id}>{item.label} - {item.type.replaceAll("_", " ")}</option>)}</select></label><label>File<input name="file" type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" required /></label><button className="primary-button" type="submit"><FileText size={15} />Upload draft</button></form><section className="record-panel"><div className="record-table document-cols"><div className="table-head"><span>Document</span><span>Type</span><span>Business reference</span><span>Version</span><span>Status</span></div>{documentRows.map((row) => <div key={row[0]}>{row.map((cell, index) => index === 4 ? <Status value={cell} key={cell} /> : <span className={index === 0 ? "reference" : ""} key={cell}>{cell}</span>)}</div>)}</div></section></>}

    {activeView === "Approvals" && <><div className="document-rule"><ShieldCheck size={19} /><div><strong>Independent approval queue</strong><p>The user who requested or prepared a transaction cannot approve it.</p></div></div><section className="record-panel"><div className="record-table approval-cols"><div className="table-head"><span>Reference</span><span>Request</span><span>Requested by</span><span>Age</span><span>Status</span><span>Action</span></div>{approvals.map((item) => <div key={item.reference}><span className="reference">{item.reference}</span><span>{item.request}</span><span>{item.requestedBy}</span><span>{item.age}</span><Status value={item.status} /><span className="row-actions"><button type="button" disabled={item.status !== "PENDING"} onClick={() => approve(item.reference)}>{item.status === "APPROVED" ? "Approved" : "Approve"}</button></span></div>)}</div></section></>}

    {activeView === "Audit History" && <><div className="document-rule"><History size={19} /><div><strong>Append-only activity history</strong><p>Events record who did what, when, and against which business record.</p></div><span>{audit.length} events</span></div><section className="record-panel"><div className="record-table audit-cols"><div className="table-head"><span>Event</span><span>Date and time</span><span>Actor</span><span>Action</span><span>Reference</span></div>{audit.map((item) => <div key={item.id}><span className="reference">{item.id}</span><span><Clock3 size={13} /> {item.at}</span><span>{item.actor}</span><span>{item.action}</span><span>{item.reference}</span></div>)}</div></section></>}

    {activeView === "Administration" && <><div className="document-rule"><ShieldCheck size={19} /><div><strong>User access administration</strong><p>Admin can review every account and assign the operational role used by database policies.</p></div></div><section className="record-panel"><div className="record-table five-cols"><div className="table-head"><span>User</span><span>Role</span><span>Access</span><span>Last sign-in</span><span>Action</span></div>{profiles.map((profile) => <div key={profile.id}><span><strong>{profile.full_name}</strong><small>{profile.email ?? profile.id}</small></span><span><select aria-label={`Role for ${profile.full_name}`} value={profile.role} onChange={(event) => setProfiles((items) => items.map((item) => item.id === profile.id ? { ...item, role: event.target.value } : item))}>{["system_admin", "warehouse_manager", "warehouse_officer", "processing_supervisor", "finance_officer", "auditor", "viewer"].map((role) => <option key={role} value={role}>{role.replaceAll("_", " ")}</option>)}</select></span><span><label><input type="checkbox" checked={profile.active} onChange={(event) => setProfiles((items) => items.map((item) => item.id === profile.id ? { ...item, active: event.target.checked } : item))} /> Active</label></span><span>{profile.last_sign_in_at ? new Date(profile.last_sign_in_at).toLocaleString() : "Never"}</span><span><button className="table-action" type="button" onClick={() => saveProfile(profile.id, profile.role, profile.active)}>Save</button></span></div>)}</div></section></>}
  </div>;
}
