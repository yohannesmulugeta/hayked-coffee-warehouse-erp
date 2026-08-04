"use client";

import { AlertTriangle, ArrowRight, Check, Clock3, Factory, FileCheck2, Minus, PackageCheck, Paperclip, Plus, Scale, Send, ShieldCheck, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import {
  evaluateOutputCompletion,
  validateProcessingRequest,
  validateProcessingRequestLines,
  type CoffeeProcessingType,
  type ProcessingCertification,
  type ProcessingOutputCategory,
  type ProcessingOutputLine,
  type ProcessingRequest,
  type ProcessingRequestLine,
  type ProcessingRequestStatus,
} from "./processing-workflow";
import {
  completeProcessingOrder,
  createProcessingRequest,
  loadProcessingData,
  processingRpc,
  startProcessingOrder,
  type ProcessingData,
} from "@/lib/erp-data";

type Tab = "Requests" | "Queue" | "Active Orders" | "Intake" | "Completion" | "Output Lots" | "Exceptions";
type QueueItem = { databaseId: string; id: string; position: number; client: string; lot: string; coffeeType: CoffeeProcessingType; grade: string; inputBags: number; inputKg: number; received: string; readiness: "READY" | "BLOCKED"; note: string };
type Order = QueueItem & { status: "IN_PROCESS" | "COMPLETED"; completionNumber: string | null; machine: string; startedAt: string | null };
type RequestLineDraft = { key: number; lotId: string; preparationType: string; requestedBags: number; requestedKg: number; specialInstruction: string; remark: string };

const certifications: ProcessingCertification[] = ["Organic", "RFA", "C.A.F.E", "Non-certified", "Fairtrade", "Other"];
const outputCategories: { value: ProcessingOutputCategory; label: string }[] = [
  { value: "ACCEPTED_CLIENT_COFFEE", label: "Accepted client coffee" },
  { value: "CLIENT_REJECT", label: "Client reject" },
  { value: "HAYKED_BYPRODUCT", label: "Hayked byproduct" },
  { value: "REWORK", label: "Rework" },
  { value: "PROCESS_LOSS", label: "Process loss" },
];
let rowKey = 1;
const newRequestLine = (): RequestLineDraft => ({ key: rowKey++, lotId: "", preparationType: "Export preparation", requestedBags: 0, requestedKg: 0, specialInstruction: "", remark: "" });
const newOutputLine = (category: ProcessingOutputCategory, kg = 0): ProcessingOutputLine => ({ category, coffeeType: "WASHED", grade: "", preparation: "", bagCount: 0, bagWeightKg: null, quantityKg: kg, warehouseSection: "", certifications: [], weighingReference: "", evidencePath: "", reason: "" });

function Status({ value }: { value: string }) {
  return <span className={`status-pill ${value.toLowerCase().replaceAll("_", "-")}`}>{value.replaceAll("_", " ")}</span>;
}

function Empty({ title, text }: { title: string; text: string }) {
  return <section className="empty-operation"><Factory size={24} /><h2>{title}</h2><p>{text}</p></section>;
}

export function ProcessingOperations() {
  const [tab, setTab] = useState<Tab>("Requests");
  const [data, setData] = useState<ProcessingData | null>(null);
  const [requestFormOpen, setRequestFormOpen] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [clientEligibleLots, setClientEligibleLots] = useState<import("@/lib/erp-data").EligibleProcessingLot[]>([]);
  const [loadingLots, setLoadingLots] = useState(false);
  const [requestLines, setRequestLines] = useState<RequestLineDraft[]>([newRequestLine()]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [outputLines, setOutputLines] = useState<ProcessingOutputLine[]>([]);
  const [exceptionApproved, setExceptionApproved] = useState(false);
  const [evidencePath, setEvidencePath] = useState("");
  const [message, setMessage] = useState("");

  const clients = useMemo(() => data?.clients ?? [], [data?.clients]);
  const lots = useMemo(() => data?.lots ?? [], [data?.lots]);
  const requests = useMemo(() => data?.requests ?? [], [data?.requests]);
  const staff = useMemo(() => data?.profiles.filter((item) => item.active) ?? [], [data?.profiles]);
  const selectedClient = clients.find((item) => item.id === selectedClientId);
  const receiptById = new Map((data?.receipts ?? []).map((item) => [item.id, item]));
  const lotById = new Map(lots.map((item) => [item.id, item]));
  const clientById = new Map(clients.map((item) => [item.id, item.legal_name]));
  const requestById = new Map(requests.map((item) => [item.id, item]));
  const intakeByOrder = new Map((data?.intakes ?? []).map((item) => [item.order_id, item]));
  const inputByOrder = new Map<string, number>();
  (data?.orderInputs ?? []).forEach((item) => inputByOrder.set(item.order_id, (inputByOrder.get(item.order_id) ?? 0) + item.input_bags));

  // Load eligible lots dynamically from database when client changes
  useEffect(() => {
    let canceled = false;
    if (!selectedClientId) return;
    void Promise.resolve().then(() => {
      if (!canceled) setLoadingLots(true);
      return import("@/lib/erp-data");
    }).then(({ listEligibleProcessingLots }) => {
      return listEligibleProcessingLots(selectedClientId);
    }).then((result) => {
      if (!canceled) {
        setClientEligibleLots(result);
        setLoadingLots(false);
      }
    }).catch(() => {
      if (!canceled) setLoadingLots(false);
    });
    return () => { canceled = true; };
  }, [selectedClientId]);

  // Combine RPC lots with local fallback lots for demo mode
  const eligibleLotsList = useMemo(() => {
    if (clientEligibleLots.length > 0) return clientEligibleLots;
    return lots
      .filter((lot) => lot.client_id === selectedClientId && Number(lot.quantity_kg) > 0 && !["DISPATCHED", "CLOSED", "REVERSED", "IN_PROCESS"].includes(lot.status) && lot.ownership_type !== "HAYKED")
      .map((lot) => ({
        lot_id: lot.id,
        lot_number: lot.lot_number,
        client_id: lot.client_id,
        lot_category: (lot.receipt_id ? "ARRIVAL" : lot.lot_number.includes("-RJ") ? "CLIENT_REJECT" : lot.lot_number.includes("-AC") ? "ACCEPTED_PROCESSED" : "ARRIVAL") as "ARRIVAL" | "ACCEPTED_PROCESSED" | "CLIENT_REJECT" | "HAYKED_BYPRODUCT" | "OTHER",
        coffee_type: lot.coffee_type,
        grade: "Grade 1",
        section: lot.section,
        bag_count: lot.bag_count,
        quantity_kg: Number(lot.quantity_kg),
        reserved_kg: 0,
        available_kg: Number(lot.quantity_kg),
        available_bags: lot.bag_count,
        status: lot.status,
        created_at: new Date().toISOString()
      }));
  }, [clientEligibleLots, lots, selectedClientId]);

  const availableKg = useMemo(() => new Map(lots.map((lot) => [lot.id, Number(lot.quantity_kg)])), [lots]);
  const availableBags = useMemo(() => new Map(lots.map((lot) => [lot.id, Number(lot.bag_count)])), [lots]);
  const queue: QueueItem[] = (data?.orders ?? []).filter((item) => ["QUEUED", "BLOCKED"].includes(item.status)).sort((a, b) => a.queue_position - b.queue_position).map((item) => {
    const lot = lotById.get(item.lot_id);
    const request = item.request_id ? requestById.get(item.request_id) : undefined;
    const inputs = data?.orderInputs.filter((input) => input.order_id === item.id) ?? [];
    const blocked = item.status === "BLOCKED" || inputs.some((input) => (availableKg.get(input.lot_id) ?? 0) < Number(input.input_kg) || (availableBags.get(input.lot_id) ?? 0) < input.input_bags);
    if (!blocked) inputs.forEach((input) => { availableKg.set(input.lot_id, (availableKg.get(input.lot_id) ?? 0) - Number(input.input_kg)); availableBags.set(input.lot_id, (availableBags.get(input.lot_id) ?? 0) - input.input_bags); });
    return { databaseId: item.id, id: item.order_number, position: item.queue_position, client: clientById.get(item.client_id) ?? "Unknown client", lot: lot?.lot_number ?? "Single source lot", coffeeType: lot?.coffee_type === "WASHED" ? "Washed" : "Unwashed / UG", grade: request?.grade ?? "-", inputBags: inputByOrder.get(item.id) ?? 0, inputKg: Number(item.input_kg), received: request?.requestDate ?? "-", readiness: blocked ? "BLOCKED" : "READY", note: blocked ? "Current unissued stock is insufficient" : request ? `${request.preparationType} - paper note ${request.noteNumber}` : "Approved processing order" };
  });
  const orders: Order[] = (data?.orders ?? []).filter((item) => ["IN_PROCESS", "POSTED"].includes(item.status)).map((item) => {
    const lot = lotById.get(item.lot_id);
    const intake = intakeByOrder.get(item.id);
    return { databaseId: item.id, id: item.order_number, position: item.queue_position, client: clientById.get(item.client_id) ?? "Unknown client", lot: lot?.lot_number ?? "Single source lot", coffeeType: lot?.coffee_type === "WASHED" ? "Washed" : "Unwashed / UG", grade: requestById.get(item.request_id ?? "")?.grade ?? "-", inputBags: inputByOrder.get(item.id) ?? 0, inputKg: Number(item.input_kg), received: "-", readiness: "READY", note: "", status: item.status === "POSTED" ? "COMPLETED" : "IN_PROCESS", completionNumber: item.completion_number, machine: intake?.machine_line ?? "-", startedAt: item.started_at };
  });
  const activeOrders = orders.filter((item) => item.status === "IN_PROCESS");
  const selectedOrder = orders.find((item) => item.databaseId === selectedOrderId) ?? activeOrders[0];
  const completion = evaluateOutputCompletion(selectedOrder?.inputKg ?? 0, selectedOrder?.coffeeType ?? "Washed", outputLines, exceptionApproved);

  async function reload() {
    try { setData(await loadProcessingData()); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Processing records could not be loaded."); }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, []);

  function updateRequestLine(key: number, patch: Partial<RequestLineDraft>) {
    setRequestLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  }

  function selectRequestLot(key: number, lotId: string) {
    const el = eligibleLotsList.find((item) => item.lot_id === lotId);
    const lot = lotById.get(lotId);
    const availableKgVal = el ? el.available_kg : Number(lot?.quantity_kg ?? 0);
    const availableBagsVal = el ? el.available_bags : Number(lot?.bag_count ?? 0);
    updateRequestLine(key, { lotId, requestedBags: availableBagsVal, requestedKg: availableKgVal });
  }

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestError("");
    const form = new FormData(event.currentTarget);
    if (!selectedClient) { setRequestError("Select a client."); return; }
    const selectedCertifications = form.getAll("certifications").map(String) as ProcessingCertification[];
    const lines: ProcessingRequestLine[] = requestLines.map((line) => {
      const lot = lotById.get(line.lotId);
      const receipt = receiptById.get(lot?.receipt_id ?? "");
      return { lotDatabaseId: line.lotId, lot: lot?.lot_number ?? "", coffeeType: lot?.coffee_type === "WASHED" ? "Washed" : "Unwashed / UG", preparationType: line.preparationType, grade: receipt?.grade ?? "-", requestedBags: line.requestedBags, requestedKg: line.requestedKg, certifications: selectedCertifications, specialInstruction: line.specialInstruction, remark: line.remark };
    });
    const request: ProcessingRequest = { id: "", clientDatabaseId: selectedClient.id, lotDatabaseId: lines[0]?.lotDatabaseId, noteNumber: String(form.get("noteNumber") ?? ""), requestDate: String(form.get("requestDate") ?? ""), client: selectedClient.legal_name, lot: lines.map((line) => line.lot).join(", "), coffeeType: lines[0]?.coffeeType ?? "Washed", preparationType: lines[0]?.preparationType ?? "", grade: lines[0]?.grade ?? "-", requestedBags: lines.reduce((sum, line) => sum + line.requestedBags, 0), requestedKg: lines.reduce((sum, line) => sum + line.requestedKg, 0), certifications: selectedCertifications, otherCertification: String(form.get("otherCertification") ?? ""), requester: String(form.get("requester") ?? ""), checker: String(form.get("checker") ?? ""), approver: String(form.get("approver") ?? ""), notes: String(form.get("notes") ?? ""), scannedDocumentAttached: form.get("scannedDocumentAttached") === "on", status: "DRAFT" };
    const validation = validateProcessingRequest(request);
    const lineValidation = validateProcessingRequestLines(lines);
    if (!validation.valid || !lineValidation.valid) { setRequestError(validation.errors[0] ?? lineValidation.errors[0]); return; }
    try {
      const requestNumber = await createProcessingRequest(request, lines);
      await reload();
      setRequestFormOpen(false);
      setSelectedClientId("");
      setRequestLines([newRequestLine()]);
      setMessage(`${requestNumber} saved for source lot ${lines[0]?.lot}.`);
    } catch (error) { setRequestError(error instanceof Error ? error.message : "Processing request could not be saved."); }
  }

  async function changeRequestStatus(id: string, status: ProcessingRequestStatus) {
    try { await processingRpc("transition_processing_request", id, status); await reload(); setMessage(`Request moved to ${status.toLowerCase()}.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Request status could not be changed."); }
  }

  async function addRequestToQueue(request: ProcessingRequest) {
    try { await processingRpc("queue_processing_request", request.id); await reload(); setTab("Queue"); setMessage(`${request.requestNumber} added to the processing queue.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Request could not be queued."); }
  }

  function openIntake(item: QueueItem) { setSelectedOrderId(item.databaseId); setTab("Intake"); }

  async function submitIntake(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const item = queue.find((entry) => entry.databaseId === selectedOrderId);
    if (!item) return;
    const form = new FormData(event.currentTarget);
    try {
      await startProcessingOrder(item.databaseId, { intakeAt: new Date(String(form.get("intakeAt"))).toISOString(), inputBags: item.inputBags, inputKg: item.inputKg, scaleReference: String(form.get("scaleReference")), warehouseIssueReference: String(form.get("warehouseIssueReference")), machineLine: String(form.get("machineLine")), shiftName: String(form.get("shiftName")), clientMonitorPresent: form.get("clientMonitorPresent") === "on", clientMonitorName: String(form.get("clientMonitorName") ?? ""), intakeCondition: String(form.get("intakeCondition")), evidencePath: String(form.get("evidencePath") ?? "") });
      await reload();
      setMessage(`${item.id} intake posted and source stock issued once.`);
      setTab("Active Orders");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Intake submission failed."); }
  }

  function openCompletion(item: Order) {
    setSelectedOrderId(item.databaseId);
    const washed = item.coffeeType === "Washed";
    setOutputLines([
      { ...newOutputLine("ACCEPTED_CLIENT_COFFEE", item.inputKg * (washed ? .775 : .975)), coffeeType: washed ? "WASHED" : "UNWASHED_UG", grade: item.grade, preparation: "Export preparation", warehouseSection: "Processed stock" },
      ...(washed ? [{ ...newOutputLine("HAYKED_BYPRODUCT", item.inputKg * .2), coffeeType: "WASHED" as const, grade: "Byproduct", preparation: "Parchment", warehouseSection: "Byproduct store" }] : []),
      { ...newOutputLine("PROCESS_LOSS", item.inputKg * .025), coffeeType: washed ? "WASHED" : "UNWASHED_UG", reason: "Processing difference" },
    ]);
    setExceptionApproved(false);
    setEvidencePath("");
    setTab("Completion");
  }

  function updateOutputLine(index: number, patch: Partial<ProcessingOutputLine>) { setOutputLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line)); }

  async function submitCompletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrder || !completion.valid) { setMessage(completion.errors[0] ?? "Select an active processing order."); return; }
    if ((completion.aboveAllowance || (selectedOrder.coffeeType === "Unwashed / UG" && completion.totals.HAYKED_BYPRODUCT > 0)) && !evidencePath.trim()) { setMessage("Approved exceptions require an evidence reference."); return; }
    try { await completeProcessingOrder(selectedOrder.databaseId, outputLines, exceptionApproved, evidencePath); await reload(); setMessage(`${selectedOrder.id} completed and locked with ${outputLines.length} traceable outputs.`); setTab("Output Lots"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Processing completion failed."); }
  }

  const requestLineCount = (requestId: string) => data?.requestLines.filter((line) => line.request_id === requestId).length ?? 0;
  const currentQueueItem = queue.find((item) => item.databaseId === selectedOrderId) ?? queue[0];
  const exceptionOutputs = (data?.outputs ?? []).filter((line) => line.category === "PROCESS_LOSS" || line.category === "HAYKED_BYPRODUCT");

  return <div className="module-page processing-page">
    <section className="module-heading"><div><span className="demo-label">CONTROLLED WORKFLOW</span><h1>Processing operations</h1><p>Request lines, intake evidence, production, and output-lot reconciliation.</p></div><div className="allowance-key"><span>Washed<strong>22.5%</strong></span><span>Unwashed / UG<strong>2.5%</strong></span></div></section>
    {message && <div className="operation-message" role="status"><Check size={17} />{message}<button type="button" onClick={() => setMessage("")}>Close</button></div>}
    <div className="module-tabs processing-tabs" role="tablist">{(["Requests", "Queue", "Active Orders", "Intake", "Completion", "Output Lots", "Exceptions"] as Tab[]).map((item) => <button role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} type="button" key={item} onClick={() => setTab(item)}>{item}</button>)}</div>

    {tab === "Requests" && <><section className="queue-rule request-rule"><FileCheck2 size={18} /><div><strong>Processing order requests</strong><p>Digitize client processing requests from physical arrival, reject, or accepted coffee lots.</p></div><button className="primary-button" type="button" onClick={() => { setRequestError(""); setSelectedClientId(""); setRequestLines([newRequestLine()]); setRequestFormOpen(true); }}><Plus size={16} />New request</button></section><section className="record-panel"><div className="record-table request-cols"><div className="table-head"><span>Request</span><span>Client / source</span><span>Preparation</span><span>Quantity</span><span>Certification</span><span>Status</span><span>Control</span></div>{requests.map((request) => <div key={request.id}><span className="reference">{request.requestNumber}<small>Paper note {request.noteNumber}</small></span><span><strong>{request.client}</strong><small>{requestLineCount(request.id)} source line(s)</small></span><span>{request.preparationType}<small>{request.coffeeType} - {request.grade}</small></span><span>{request.requestedBags.toLocaleString()} bags<small>{request.requestedKg.toLocaleString()} kg</small></span><span>{request.certifications.join(", ") || "None"}<small>{request.scannedDocumentAttached ? "Document recorded" : "No document"}</small></span><span><Status value={request.status} />{request.queuedAs && <small>{request.queuedAs}</small>}</span><span className="request-actions">{request.status === "DRAFT" && <button type="button" onClick={() => changeRequestStatus(request.id, "SUBMITTED")}><Send size={13} />Submit</button>}{request.status === "SUBMITTED" && <><button type="button" onClick={() => changeRequestStatus(request.id, "APPROVED")}><ThumbsUp size={13} />Approve</button><button className="reject" type="button" aria-label={`Reject ${request.requestNumber}`} onClick={() => changeRequestStatus(request.id, "REJECTED")}><ThumbsDown size={13} /></button></>}{request.status === "APPROVED" && !request.queuedAs && <button type="button" onClick={() => addRequestToQueue(request)}>Queue <ArrowRight size={13} /></button>}{(request.status === "REJECTED" || request.queuedAs) && <span className="muted-action">{request.status === "REJECTED" ? "Closed" : "Queued"}</span>}</span></div>)}</div></section></>}

    {requestFormOpen && <div className="modal-backdrop"><form className="receipt-modal processing-request-modal" role="dialog" aria-modal="true" aria-labelledby="processing-request-title" onSubmit={createRequest}><header><div><span className="demo-label">PAPER FORM DIGITIZATION</span><h2 id="processing-request-title">New processing request</h2><p>Export Coffee Processing Order Requesting Notes</p></div><button type="button" aria-label="Close request form" onClick={() => setRequestFormOpen(false)}><X size={20} /></button></header><section className="form-section"><h3>Request header</h3><div className="form-grid compact request-form-grid"><label>Paper note number<input name="noteNumber" placeholder="00240" required /></label><label>Request date<input name="requestDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label><label>Client / customer<select required value={selectedClientId} onChange={(event) => { setSelectedClientId(event.target.value); setRequestLines([newRequestLine()]); }}><option value="" disabled>Select client</option>{clients.filter((client) => client.active).map((client) => <option key={client.id} value={client.id}>{client.code} - {client.legal_name}</option>)}</select></label></div></section><section className="form-section"><div className="section-title-row"><h3>Source coffee lot</h3><span className="info-badge muted">Multiple source lots are not yet enabled for this processing request.</span></div><p className="form-note muted">Lot-level legal and quality hold control is not yet implemented.</p><div className="line-editor">{requestLines.map((line, index) => { const el = eligibleLotsList.find((item) => item.lot_id === line.lotId); const lot = lotById.get(line.lotId); const receipt = receiptById.get(lot?.receipt_id ?? ""); const categoryBadge = el?.lot_category ?? (lot?.receipt_id ? "ARRIVAL" : lot?.lot_number.includes("-RJ") ? "CLIENT_REJECT" : lot?.lot_number.includes("-AC") ? "ACCEPTED_PROCESSED" : "ARRIVAL"); return <article key={line.key}><div className="line-number">{index + 1}</div><label>Source lot<select required value={line.lotId} onChange={(event) => selectRequestLot(line.key, event.target.value)} disabled={!selectedClientId || loadingLots}><option value="" disabled>{loadingLots ? "Loading eligible lots..." : !selectedClientId ? "Select client first" : eligibleLotsList.length === 0 ? "No eligible lots available" : "Select eligible coffee lot"}</option>{eligibleLotsList.map((option) => <option key={option.lot_id} value={option.lot_id}>[{option.lot_category}] {option.lot_number} | {option.coffee_type} | {option.available_bags} bags ({option.available_kg.toLocaleString()} kg available)</option>)}</select></label><label>Preparation / Purpose<input required value={line.preparationType} onChange={(event) => updateRequestLine(line.key, { preparationType: event.target.value })} placeholder={categoryBadge === "CLIENT_REJECT" ? "REPROCESSING" : categoryBadge === "ACCEPTED_PROCESSED" ? "REPEAT_PROCESSING" : "Export preparation"} /></label><label>Grade<input readOnly value={el?.grade ?? receipt?.grade ?? "Select lot"} /></label><label>Requested bags<input type="number" min="1" max={el ? el.available_bags : lot?.bag_count} required value={line.requestedBags || ""} onChange={(event) => updateRequestLine(line.key, { requestedBags: Number(event.target.value) })} /></label><label>Requested kg<input type="number" min="0.01" step="0.01" max={el ? el.available_kg : lot?.quantity_kg} required value={line.requestedKg || ""} onChange={(event) => updateRequestLine(line.key, { requestedKg: Number(event.target.value) })} /></label><label>Special instruction / Reprocessing reason<input value={line.specialInstruction} required={categoryBadge === "CLIENT_REJECT" || categoryBadge === "ACCEPTED_PROCESSED"} onChange={(event) => updateRequestLine(line.key, { specialInstruction: event.target.value })} placeholder={categoryBadge === "CLIENT_REJECT" ? "Reason for reprocessing reject lot" : categoryBadge === "ACCEPTED_PROCESSED" ? "Reason for repeat processing/polishing" : "Special instructions"} /></label></article>; })}</div>{selectedClientId && eligibleLotsList.length === 0 && !loadingLots && <div className="request-form-warning" role="alert"><AlertTriangle size={15} />No eligible physical coffee lots are available for this client. Eligible sources are arrival lots, client-reject lots, and accepted processed-coffee lots with positive available stock.</div>}</section><section className="form-section"><h3>Certification</h3><div className="certification-grid">{certifications.map((certification) => <label key={certification}><input type="checkbox" name="certifications" value={certification} />{certification}</label>)}</div><label className="other-certification">Other certification<input name="otherCertification" /></label></section><section className="form-section"><h3>Request control</h3><div className="form-grid compact request-form-grid"><label>Representative / requester<select name="requester" required defaultValue=""><option value="" disabled>Select representative</option>{(data?.representatives ?? []).filter((item) => item.client_id === selectedClientId && item.active).map((item) => <option key={item.id}>{item.full_name}</option>)}</select></label><label>Checker<select name="checker" required defaultValue=""><option value="" disabled>Select checker</option>{staff.map((profile) => <option key={profile.id}>{profile.full_name}</option>)}</select></label><label>Approver<select name="approver" required defaultValue=""><option value="" disabled>Select approver</option>{staff.map((profile) => <option key={profile.id}>{profile.full_name}</option>)}</select></label><label className="wide">Notes<textarea name="notes" rows={3} /></label><label className="check-label wide"><input name="scannedDocumentAttached" type="checkbox" /><Paperclip size={15} />Paper scan or photo is attached to the record</label></div></section>{requestError && <div className="request-form-error" role="alert"><AlertTriangle size={15} />{requestError}</div>}<footer><button className="secondary-button" type="button" onClick={() => setRequestFormOpen(false)}>Cancel</button><button className="primary-button" type="submit" disabled={!selectedClientId || eligibleLotsList.length === 0}><FileCheck2 size={16} />Save draft</button></footer></form></div>}

    {tab === "Queue" && <><section className="queue-rule"><Clock3 size={18} /><div><strong>First-come-first-served sequence</strong><p>An approved request receives a permanent processing order number before intake.</p></div></section><section className="record-panel"><div className="record-table queue-cols"><div className="table-head"><span>Queue / order</span><span>Client / lot</span><span>Coffee</span><span>Received</span><span>Readiness</span><span>Control</span></div>{queue.map((item) => <div key={item.id}><span><span className="queue-position">{item.position}</span><small>{item.id}</small></span><span><strong>{item.client}</strong><small>{item.lot}</small></span><span>{item.coffeeType}<small>{item.inputBags} bags - {item.inputKg.toLocaleString()} kg</small></span><span>{item.received}</span><span><Status value={item.readiness} /><small>{item.note}</small></span><span><button className="table-action" type="button" disabled={item.readiness === "BLOCKED"} onClick={() => openIntake(item)}>Record intake <ArrowRight size={13} /></button></span></div>)}</div></section></>}

    {tab === "Intake" && (currentQueueItem ? <form className="operation-form" onSubmit={submitIntake}><header><div><span className="demo-label">{currentQueueItem.id}</span><h2>Processing intake</h2><p>{currentQueueItem.client} - {currentQueueItem.inputBags} bags / {currentQueueItem.inputKg.toLocaleString()} kg</p></div><select value={currentQueueItem.databaseId} onChange={(event) => setSelectedOrderId(event.target.value)}>{queue.map((item) => <option key={item.id} value={item.databaseId}>{item.id}</option>)}</select></header><div className="form-grid compact"><label>Intake date and time<input name="intakeAt" type="datetime-local" defaultValue={new Date().toISOString().slice(0, 16)} required /></label><label>Scale reference<input name="scaleReference" placeholder="SCALE-2026-0041" required /></label><label>Warehouse issue reference<input name="warehouseIssueReference" placeholder="WI-2026-0041" required /></label><label>Machine / line<input name="machineLine" placeholder="Line 1" required /></label><label>Shift<select name="shiftName" defaultValue="Day"><option>Day</option><option>Night</option></select></label><label>Intake condition<select name="intakeCondition" defaultValue="Good"><option>Good</option><option>Wet</option><option>Damaged bags</option><option>Needs review</option></select></label><label>Evidence reference<input name="evidencePath" placeholder="Scale ticket or document reference" /></label><label>Client monitor name<input name="clientMonitorName" /></label><label className="check-label wide"><input name="clientMonitorPresent" type="checkbox" />Client representative was present</label></div><footer><button className="primary-button" type="submit"><Scale size={16} />Post intake and issue stock</button></footer></form> : <Empty title="No queued order needs intake" text="Approve and queue a processing request first." />)}

    {tab === "Active Orders" && <><section className="processing-summary"><article><Factory size={19} /><span>Active orders<strong>{activeOrders.length}</strong></span></article><article><Scale size={19} /><span>Input in process<strong>{activeOrders.reduce((sum, item) => sum + item.inputKg, 0).toLocaleString()} kg</strong></span></article><article><PackageCheck size={19} /><span>Completed orders<strong>{orders.filter((item) => item.status === "COMPLETED").length}</strong></span></article></section><section className="record-panel"><div className="record-table order-cols"><div className="table-head"><span>Order</span><span>Client / lot</span><span>Input</span><span>Machine</span><span>Started</span><span>Status</span><span>Action</span></div>{orders.map((item) => <div key={item.id}><span className="reference">{item.id}<small>{item.completionNumber ?? "No completion yet"}</small></span><span><strong>{item.client}</strong><small>{item.lot}</small></span><span>{item.inputKg.toLocaleString()} kg<small>{item.coffeeType}</small></span><span>{item.machine}</span><span>{item.startedAt ? new Date(item.startedAt).toLocaleString() : "-"}</span><span><Status value={item.status} /></span><span><button className="table-action" type="button" disabled={item.status === "COMPLETED"} onClick={() => openCompletion(item)}>{item.status === "COMPLETED" ? "Locked" : "Record outputs"}<ArrowRight size={13} /></button></span></div>)}</div></section></>}

    {tab === "Completion" && (selectedOrder && selectedOrder.status === "IN_PROCESS" ? <form className="completion-layout" onSubmit={submitCompletion}><section className="completion-form"><header><div><span className="demo-label">{selectedOrder.id}</span><h2>Output reconciliation</h2><p>{selectedOrder.client} - input {selectedOrder.inputKg.toLocaleString()} kg</p></div><select value={selectedOrder.databaseId} onChange={(event) => { const next = activeOrders.find((item) => item.databaseId === event.target.value); if (next) openCompletion(next); }}>{activeOrders.map((item) => <option key={item.id} value={item.databaseId}>{item.id}</option>)}</select></header><div className="section-title-row"><div className="input-total"><span>Processing input</span><strong>{selectedOrder.inputKg.toLocaleString()} kg</strong></div><button className="table-action" type="button" onClick={() => setOutputLines((current) => [...current, { ...newOutputLine("CLIENT_REJECT"), coffeeType: selectedOrder.coffeeType === "Washed" ? "WASHED" : "UNWASHED_UG" }])}><Plus size={13} />Add output</button></div><div className="output-line-editor">{outputLines.map((line, index) => <article key={index} className={`output-section ${line.category.toLowerCase()}`}><div className="section-title-row"><h3>{index + 1}. {outputCategories.find((item) => item.value === line.category)?.label}</h3><button className="icon-button" type="button" title="Remove output" aria-label={`Remove output line ${index + 1}`} disabled={outputLines.length === 1} onClick={() => setOutputLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><Minus size={14} /></button></div><div className="form-grid compact"><label>Category<select value={line.category} onChange={(event) => updateOutputLine(index, { category: event.target.value as ProcessingOutputCategory })}>{outputCategories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>Quantity kg<input type="number" min="0.01" step="0.01" value={line.quantityKg || ""} onChange={(event) => updateOutputLine(index, { quantityKg: Number(event.target.value) })} required /></label>{line.category !== "PROCESS_LOSS" && <><label>Grade / category<input value={line.grade} onChange={(event) => updateOutputLine(index, { grade: event.target.value })} required /></label><label>Preparation<input value={line.preparation} onChange={(event) => updateOutputLine(index, { preparation: event.target.value })} required /></label><label>Bags<input type="number" min="0" value={line.bagCount} onChange={(event) => updateOutputLine(index, { bagCount: Number(event.target.value) })} /></label><label>Bag weight kg<input type="number" min="0.01" step="0.01" value={line.bagWeightKg ?? ""} onChange={(event) => updateOutputLine(index, { bagWeightKg: event.target.value ? Number(event.target.value) : null })} /></label><label>Warehouse section<input value={line.warehouseSection} onChange={(event) => updateOutputLine(index, { warehouseSection: event.target.value })} required /></label><label>Weighing reference<input value={line.weighingReference} onChange={(event) => updateOutputLine(index, { weighingReference: event.target.value })} required /></label></>}{line.category === "PROCESS_LOSS" && <label className="wide">Loss reason<input value={line.reason} onChange={(event) => updateOutputLine(index, { reason: event.target.value })} required /></label>}</div></article>)}</div></section><aside className="reconciliation-panel"><h2>Live reconciliation</h2><dl><div><dt>Total input</dt><dd>{selectedOrder.inputKg.toLocaleString()} kg</dd></div>{outputCategories.map((category) => <div key={category.value}><dt>{category.label}</dt><dd>{completion.totals[category.value].toLocaleString()} kg</dd></div>)}<div className="total"><dt>Output total</dt><dd>{completion.outputKg.toLocaleString()} kg</dd></div></dl><div className={`balance-result ${Math.abs(completion.varianceKg) <= .01 ? "good" : "bad"}`}><span>Mass-balance variance</span><strong>{completion.varianceKg.toLocaleString()} kg</strong></div><div className={`allowance-result ${completion.aboveAllowance ? "bad" : "good"}`}><span>Applicable allowance</span><strong>{completion.actualPercent.toFixed(2)}% / {completion.allowedPercent}%</strong></div>{(completion.aboveAllowance || (selectedOrder.coffeeType === "Unwashed / UG" && completion.totals.HAYKED_BYPRODUCT > 0)) && <><label className="inline-check"><input type="checkbox" checked={exceptionApproved} onChange={(event) => setExceptionApproved(event.target.checked)} />Independent exception approved</label><label>Evidence reference<input value={evidencePath} onChange={(event) => setEvidencePath(event.target.value)} required /></label></>}{completion.errors.length > 0 && <div className="validation-list">{completion.errors.map((error) => <p key={error}><AlertTriangle size={13} />{error}</p>)}</div>}<button className="primary-button complete-button" type="submit" disabled={!completion.valid}><ShieldCheck size={17} />Post and lock completion</button></aside></form> : <Empty title="No active order is selected" text="Record intake for a queued order, then open its outputs from Active Orders." />)}

    {tab === "Output Lots" && <section className="record-panel"><div className="record-table output-cols"><div className="table-head"><span>Completion</span><span>Output lot</span><span>Category / owner</span><span>Grade / preparation</span><span>Quantity</span><span>Location</span></div>{(data?.outputs ?? []).filter((item) => item.child_lot_id).map((item) => { const linkedOrder = data?.orders.find((order) => order.id === item.order_id); const childLot = lotById.get(item.child_lot_id ?? ""); return <div key={item.id}><span className="reference">{linkedOrder?.completion_number ?? linkedOrder?.order_number}</span><span>{childLot?.lot_number ?? "Pending lot"}</span><span>{item.category.replaceAll("_", " ")}<small>{item.owner_type}</small></span><span>{item.grade ?? "-"}<small>{item.preparation ?? "-"}</small></span><span>{Number(item.quantity_kg).toLocaleString()} kg<small>{item.bag_count} bags</small></span><span>{item.warehouse_section ?? "-"}</span></div>; })}</div>{!(data?.outputs ?? []).some((item) => item.child_lot_id) && <Empty title="No processing output lots" text="Completed physical outputs will appear here with generated lot numbers." />}</section>}

    {tab === "Exceptions" && <section className="record-panel"><div className="record-table exception-cols"><div className="table-head"><span>Order</span><span>Type</span><span>Quantity</span><span>Evidence</span><span>Reason</span></div>{exceptionOutputs.map((item) => { const linkedOrder = data?.orders.find((order) => order.id === item.order_id); return <div key={item.id}><span className="reference">{linkedOrder?.completion_number ?? linkedOrder?.order_number}</span><span><Status value={item.category} /></span><span>{Number(item.quantity_kg).toLocaleString()} kg</span><span>{item.evidence_path ?? linkedOrder?.completion_number ?? "Recorded at completion"}</span><span>{item.reason ?? "Allowance output"}</span></div>; })}</div>{!exceptionOutputs.length && <Empty title="No processing exceptions" text="Process loss and byproduct records will appear here after completion." />}</section>}
  </div>;
}
