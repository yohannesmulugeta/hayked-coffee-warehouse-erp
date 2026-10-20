"use client";

import { Check, Download, FileText, FlaskConical, Plus, RefreshCw, Send } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { supabaseConfigured } from "@/lib/supabase/client";
import { EvidenceUploader } from "./workflow-ui";
import {
  createLabSample, downloadLabReport, labResultsFromSample, loadLaboratoryData,
  saveLabSample, sendLabReport, transitionLabSample,
  type LabResults,
} from "@/lib/laboratory";

type LabData = Awaited<ReturnType<typeof loadLaboratoryData>>;
const canRecord = (role: string) => ["system_admin", "warehouse_manager", "processing_supervisor"].includes(role);
const canApprove = (role: string) => ["system_admin", "warehouse_manager"].includes(role);
const emptyResults: LabResults = {
  moisturePercent: "", screen14Percent: "", shapeMake: "", greenOdour: "", greenColour: "",
  greenQuality: "", greenComment: "",
  cupCleanliness: "", acidity: "", body: "", flavour: "", cupOverall: "", cupComment: "",
  greenValue: "", cupValue: "", totalValue: "", proposedGrade: "", recommendation: "",
};

function LaboratoryPreview() {
  const previewFields = (fields: string[]) => fields.map((label) =>
    <label key={label}>{label}<input disabled placeholder="Recorded by laboratory staff" /></label>
  );

  return <div className="lab-preview">
    <div className="prototype-note" role="status"><FlaskConical size={18} /><span><strong>Interface preview only</strong>Explore the laboratory process below. This preview has no database connection: samples cannot be saved, reports cannot be approved, and emails cannot be sent.</span></div>
    <section className="lab-card">
      <div className="lab-section-head"><h2>1. Register a sample</h2><p>Record the client and origin. The sample can be linked to a warehouse lot or handled independently.</p></div>
      <div className="lab-grid">
        <label>Client<input disabled placeholder="Select an existing client" /></label>
        <label>Warehouse lot (optional)<input disabled placeholder="Independent sample or linked lot" /></label>
        <label>Received on<input disabled placeholder="Date received" /></label>
        <label>Origin<input disabled placeholder="Coffee origin" /></label>
        <label>Process<input disabled placeholder="Washed or natural" /></label>
        <button className="primary-button" type="button" disabled><Plus size={16} />Register sample</button>
      </div>
    </section>
    <section className="lab-card">
      <div className="lab-section-head"><h2>2. Evaluate the coffee</h2><p>Staff enter the physical analysis and cup observations from the sample assessment.</p></div>
      <div className="lab-steps"><span className="done">1. Register</span><span>2. Evaluate</span><span>3. Approve</span><span>4. Email</span></div>
      <h3>Green coffee assessment</h3>
      <div className="lab-grid">{previewFields(["Moisture %", "Screen 14 and above %", "Shape and make", "Odour", "Colour", "Green quality"])}<label className="lab-wide">Overall green quality observations<textarea disabled placeholder="Defects and physical observations" /></label></div>
      <h3>Cup assessment</h3>
      <div className="lab-grid">{previewFields(["Cup cleanliness", "Acidity", "Body", "Flavour", "Overall cup impression"])}<label className="lab-wide">Overall cup observations<textarea disabled placeholder="Cupping observations" /></label></div>
      <h3>Conclusion</h3>
      <div className="lab-grid">{previewFields(["Green value", "Cup value", "Total value", "Proposed grade"])}<label className="lab-wide">Recommendation<textarea disabled placeholder="Laboratory recommendation" /></label></div>
      <p className="lab-note">Scores and grades are entered by staff; no grading formula is assumed from the supplied form.</p>
      <div className="lab-actions"><button className="secondary-button" type="button" disabled>Save draft</button><button className="primary-button" type="button" disabled>Save and submit</button></div>
    </section>
    <section className="lab-card lab-preview-finish">
      <div><h2>3. Review and approve</h2><p>A different authorized staff member reviews the evaluation. Approval creates a versioned PDF report.</p><button className="secondary-button" type="button" disabled><Check size={16} />Approve report</button></div>
      <div><h2>4. Send to the client</h2><p>The approved PDF is sent to the email on the client record. The delivery attempt is recorded.</p><button className="secondary-button" type="button" disabled><Send size={16} />Send approved PDF</button></div>
    </section>
  </div>;
}

export function LaboratoryOperations({ role, userId, onNavigate }: { role: string; userId: string; onNavigate: (intent: { view: string; focusId?: string }) => void }) {
  const [data, setData] = useState<LabData | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [results, setResults] = useState<LabResults>(emptyResults);
  const [clientId, setClientId] = useState("");
  const [lotId, setLotId] = useState("");
  const [receivedOn, setReceivedOn] = useState(new Date().toISOString().slice(0, 10));
  const [origin, setOrigin] = useState("");
  const [process, setProcess] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const selected = data?.samples.find((item) => item.id === selectedId);
  const client = data?.clients.find((item) => item.id === selected?.client_id);
  const reports = data?.reports.filter((item) => item.sample_id === selectedId) ?? [];
  const currentReport = reports.find((item) => item.version === selected?.report_version);
  const delivery = data?.deliveries.find((item) => item.report_id === currentReport?.id);

  async function reload(focusId?: string) {
    setLoading(true);
    try {
      const next = await loadLaboratoryData();
      setData(next);
      setSelectedId(focusId || selectedId || next.samples[0]?.id || "");
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Laboratory records could not be loaded."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (!supabaseConfigured) { setLoading(false); return; }
    let active = true;
    void loadLaboratoryData().then((next) => {
      if (!active) return;
      setData(next); setSelectedId(next.samples[0]?.id ?? ""); setLoading(false);
    }).catch((cause: unknown) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : "Laboratory records could not be loaded."); setLoading(false);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => { setResults(selected ? labResultsFromSample(selected) : emptyResults); }, [selected]);

  async function run(action: () => Promise<unknown>, success: string, focusId?: string) {
    setBusy(true); setMessage(""); setError("");
    try { await action(); await reload(focusId); setMessage(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The laboratory action failed."); }
    finally { setBusy(false); }
  }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const id = await createLabSample({ clientId, lotId, receivedOn, origin: origin.trim(), process: process.trim() });
      await reload(id);
      setOrigin(""); setProcess(""); setLotId("");
      setMessage("Sample registered. Record the evaluation below.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The sample could not be registered."); }
    finally { setBusy(false); }
  }

  function input<K extends keyof LabResults>(key: K, label: string, options?: { number?: boolean; required?: boolean }) {
    return <label key={key}>{label}<input type={options?.number ? "number" : "text"} min={options?.number ? "0" : undefined}
      max={options?.number && (key === "moisturePercent" || key === "screen14Percent") ? "100" : undefined}
      step={options?.number ? "0.01" : undefined} maxLength={options?.number ? undefined : 180}
      required={options?.required} value={results[key]} disabled={selected?.status !== "DRAFT" || busy}
      onChange={(event) => setResults((current) => ({ ...current, [key]: event.target.value }))} /></label>;
  }
  function notes<K extends keyof LabResults>(key: K, label: string, required = false) {
    return <label className="lab-wide" key={key}>{label}<textarea rows={3} maxLength={2000} required={required}
      value={results[key]} disabled={selected?.status !== "DRAFT" || busy}
      onChange={(event) => setResults((current) => ({ ...current, [key]: event.target.value }))} /></label>;
  }

  return <div className="module-page laboratory-page">
    <header className="lab-heading"><div><span className="demo-label">QUALITY SERVICES</span><h1>Laboratory</h1><p>Register samples, record green and cup observations, approve a report, then email the approved PDF to the client.</p></div><FlaskConical size={30} aria-hidden="true" /></header>
    {error && <div className="request-form-error" role="alert">{error}</div>}
    {message && <div className="prototype-note" role="status"><Check size={18} /><span>{message}</span></div>}
    {!supabaseConfigured && <LaboratoryPreview />}
    {loading && <p className="empty-result" role="status">Loading laboratory records...</p>}
    {!loading && supabaseConfigured && canRecord(role) && <section className="lab-card"><div className="lab-section-head"><h2>Register a sample</h2><p>A sample may be linked to warehouse stock or received separately.</p></div>
      <form className="lab-grid" onSubmit={register}>
        <label>Client<select required value={clientId} onChange={(event) => { setClientId(event.target.value); setLotId(""); }}><option value="">Select client</option>{data?.clients.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.legal_name}</option>)}</select></label>
        <label>Warehouse lot (optional)<select value={lotId} onChange={(event) => setLotId(event.target.value)} disabled={!clientId}><option value="">Independent sample</option>{data?.lots.filter((item) => item.client_id === clientId).map((item) => <option key={item.id} value={item.id}>{item.lot_number}</option>)}</select></label>
        <label>Received on<input type="date" required max={new Date().toISOString().slice(0, 10)} value={receivedOn} onChange={(event) => setReceivedOn(event.target.value)} /></label>
        <label>Origin<input required maxLength={120} minLength={2} value={origin} onChange={(event) => setOrigin(event.target.value)} /></label>
        <label>Process<input required maxLength={120} minLength={2} value={process} onChange={(event) => setProcess(event.target.value)} /></label>
        <button className="primary-button" type="submit" disabled={busy}><Plus size={16} />{busy ? "Saving..." : "Register sample"}</button>
      </form>
    </section>}
    {!loading && supabaseConfigured && <div className="lab-workspace"><section className="lab-card lab-list"><div className="lab-section-head"><h2>Samples</h2><p>{data?.samples.length ?? 0} registered</p></div>
      {!data?.samples.length && <p className="empty-result">No laboratory samples recorded yet.</p>}
      {data?.samples.map((sample) => <button type="button" key={sample.id} className={`lab-sample-row ${sample.id === selectedId ? "selected" : ""}`} onClick={() => setSelectedId(sample.id)}>
        <strong>{sample.sample_code}</strong><span>{data.clients.find((item) => item.id === sample.client_id)?.legal_name ?? "Client"}</span><small>{sample.received_on} · {sample.origin}</small><b>{sample.status.replaceAll("_", " ")}</b>
      </button>)}
    </section>
    {selected && <section className="lab-card lab-detail"><div className="lab-section-head lab-record-head"><div><span className="demo-label">{selected.sample_code}</span><h2>{client?.legal_name}</h2><p>{selected.origin} · {selected.process} · received {selected.received_on} · {selected.lot_id ? `lot ${data?.lots.find((item) => item.id === selected.lot_id)?.lot_number ?? selected.lot_id}` : "independent sample"}</p>{selected.lot_id && <button type="button" className="link-button" onClick={() => onNavigate({ view: "Coffee Lots", focusId: selected.lot_id ?? undefined })}>Open linked lot</button>}</div><span className="lab-status">{selected.status}</span></div>
      <div className="lab-steps"><span className="done">1. Register</span><span className={selected.status !== "DRAFT" ? "done" : ""}>2. Evaluate</span><span className={selected.status === "APPROVED" ? "done" : ""}>3. Approve</span><span className={delivery?.status === "ACCEPTED" ? "done" : ""}>4. Email</span></div>
      <form onSubmit={(event) => { event.preventDefault(); void run(() => saveLabSample(selected.id, results), "Draft evaluation saved.", selected.id); }}>
        <h3>Green coffee assessment</h3><div className="lab-grid">
          {input("moisturePercent", "Moisture %", { number: true })}{input("screen14Percent", "Screen 14 and above %", { number: true })}
          {input("shapeMake", "Shape and make")}{input("greenOdour", "Odour")}
          {input("greenColour", "Colour")}{input("greenQuality", "Green quality")}
          {notes("greenComment", "Overall green quality observations", true)}
        </div>
        <h3>Cup assessment</h3><div className="lab-grid">
          {input("cupCleanliness", "Cup cleanliness")}{input("acidity", "Acidity")}{input("body", "Body")}{input("flavour", "Flavour")}{input("cupOverall", "Overall cup impression")}
          {notes("cupComment", "Overall cup observations", true)}
        </div>
        <h3>Conclusion</h3><div className="lab-grid">
          {input("greenValue", "Green value", { number: true })}{input("cupValue", "Cup value", { number: true })}{input("totalValue", "Total value", { number: true })}
          {input("proposedGrade", "Proposed grade", { required: true })}
          {notes("recommendation", "Recommendation")}
        </div>
        <p className="lab-note">Scores and grades are entered by staff. The sample form does not establish Hayked scoring rules.</p>
        {selected.status === "DRAFT" && canRecord(role) && <div className="lab-actions"><button type="submit" className="secondary-button" disabled={busy}>Save draft</button><button type="button" className="primary-button" disabled={busy || !results.greenComment.trim() || !results.cupComment.trim() || !results.proposedGrade.trim()} onClick={() => void run(async () => { await saveLabSample(selected.id, results); await transitionLabSample("submit", selected.id); }, "Assessment submitted for independent review.", selected.id)}>Save and submit</button></div>}
      </form>
      {selected.status === "SUBMITTED" && canApprove(role) && <div className="lab-review"><strong>Independent review</strong><p>Review every result above before approving. The person who submitted this assessment cannot approve it.</p><button className="primary-button" type="button" disabled={busy || selected.submitted_by === userId} onClick={() => void run(() => transitionLabSample("approve", selected.id), "Approved report created. It can now be downloaded or emailed.", selected.id)}><Check size={16} />Approve report</button></div>}
      {selected.status === "APPROVED" && canApprove(role) && <div className="lab-review"><strong>Need a correction?</strong><p>Reopening preserves the approved version. A corrected result must be submitted and approved as a new version.</p><button className="secondary-button" type="button" disabled={busy} onClick={() => void run(() => transitionLabSample("reopen", selected.id), "Sample reopened as a draft. The earlier approved report remains available.", selected.id)}><RefreshCw size={16} />Create revision</button></div>}
      <div className="lab-evidence"><EvidenceUploader reference={{ type: "LAB_SAMPLE", id: selected.id, label: selected.sample_code }} documentType="LAB_SOURCE_EVIDENCE" label="Source sheet or supporting evidence" help="Attach the original sample form or analysis evidence to this sample." /></div>
      <div className="lab-reports"><h3>Approved report versions</h3>{reports.length === 0 && <p className="empty-result">No report approved yet.</p>}
        {reports.map((report) => <div className="lab-report-row" key={report.id}><FileText size={20} /><span><strong>Version {report.version}</strong><small>Approved {new Date(report.approved_at).toLocaleString()}</small></span><button type="button" className="secondary-button" disabled={busy} onClick={() => { setError(""); void downloadLabReport(report.id, `${selected.sample_code}-v${report.version}.pdf`).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "The PDF could not be downloaded.")); }}><Download size={15} />PDF</button></div>)}
      </div>
      {selected.status === "APPROVED" && currentReport && <div className="lab-email"><h3>Email the current report</h3><p>The approved PDF will be attached to a message addressed to <strong>{client?.email || "No client email recorded"}</strong>.</p>
        {delivery ? <p className="lab-delivery">Email status: <strong>{delivery.status}</strong> · {delivery.recipient_email} · {new Date(delivery.created_at).toLocaleString()}{delivery.status === "ACCEPTED" && <span> The provider accepted the message; delivery to the mailbox is not confirmed.</span>}</p> : null}
        {canApprove(role) && <button className="primary-button" type="button" disabled={busy || !client?.email || (delivery && delivery.status !== "FAILED") === true} onClick={() => void run(async () => { const sent = await sendLabReport(currentReport.id); setMessage(`Email accepted for ${sent.recipient}.`); }, "Email submitted to the provider.", selected.id)}><Send size={16} />Send approved PDF to client</button>}
        {!canApprove(role) && <p className="lab-note">A warehouse manager or administrator sends client reports.</p>}
      </div>}
    </section>}
    </div>}
  </div>;
}
