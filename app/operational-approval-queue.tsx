"use client";

import { useEffect, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase/client";
import {
  decideQuantityCheck, decideTransformJob, loadPendingOperationalReviews,
} from "@/lib/quantity-checks";

type Reviews = Awaited<ReturnType<typeof loadPendingOperationalReviews>>;

export function OperationalApprovalQueue({ focusId, onNavigate, onChanged }: { focusId?: string; onNavigate?: (intent: { view: string; focusId?: string }) => void; onChanged?: () => void }) {
  const [reviews, setReviews] = useState<Reviews>({ checks: [], jobs: [], sources: [], lots: [], clients: [], receipts: [], orders: [], dispatches: [] });
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");

  async function reload() {
    setReviews(await loadPendingOperationalReviews());
    setLoadError("");
  }

  useEffect(() => {
    let active = true;
    void Promise.all([loadPendingOperationalReviews(), createSupabaseClient().auth.getUser()])
      .then(async ([next, auth]) => {
        if (!active) return;
        setReviews(next);
        const id = auth.data.user?.id ?? "";
        setUserId(id);
        if (id) {
          const profile = await createSupabaseClient().from("profiles").select("role").eq("id", id).maybeSingle();
          if (active && !profile.error) setRole(profile.data?.role ?? "");
        }
      })
      .catch((error) => { if (active) setLoadError(error instanceof Error ? error.message : "Operational approvals unavailable."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function decide(id: string, kind: "check" | "job", decision: "APPROVED" | "REJECTED") {
    const note = notes[id]?.trim() ?? "";
    if (note.length < 5) return;
    setBusyId(id);
    setMessage("");
    try {
      if (kind === "check") await decideQuantityCheck(id, decision, note);
      else await decideTransformJob(id, decision, note);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Decision failed.");
      setBusyId("");
      return;
    }
    setMessage(`${decision === "APPROVED" ? "Approved" : "Rejected"} after independent review.`);
    try { await reload(); onChanged?.(); }
    catch (error) { setMessage(`Decision saved, but the queue could not refresh: ${error instanceof Error ? error.message : "unknown error"}`); }
    setBusyId("");
  }

  const canReview = (stage: string, recorder: string) => recorder !== userId &&
    (["system_admin", "warehouse_manager"].includes(role) ||
      (stage.startsWith("PROCESSING_") && role === "processing_supervisor"));
  const count = reviews.checks.length + reviews.jobs.length;
  const lotNames = new Map(reviews.lots.map((lot) => [lot.id, lot.lot_number]));
  const clientNames = new Map(reviews.clients.map((client) => [client.id, client.legal_name]));
  const referenceFor = (stage: string, id: string) => {
    if (stage === "ARRIVAL") return { view: "Warehouse Receipts", label: reviews.receipts.find((item) => item.id === id)?.receipt_number ?? id };
    if (stage === "DISPATCH_EXIT") return { view: "Dispatch", label: reviews.dispatches.find((item) => item.id === id)?.dispatch_number ?? id };
    return { view: "Processing", label: reviews.orders.find((item) => item.id === id)?.order_number ?? id };
  };
  useEffect(() => {
    if (focusId && !loading) document.getElementById(`operational-review-${focusId}`)?.scrollIntoView({ block: "center" });
  }, [focusId, loading]);
  return <section className="record-panel operational-approval-queue" aria-label="Physical and transformation approvals">
    <h2>Physical checks and special jobs <small>{count} pending</small></h2>
    {loading ? <p>Loading pending reviews…</p> : loadError ? <p role="alert">Pending reviews could not be loaded: {loadError}</p> : count === 0 ? <p>No physical checks or special jobs await review.</p> : <>
      {reviews.checks.map((check) => <article key={check.id} id={`operational-review-${check.id}`} className={check.id === focusId ? "focused-charge" : undefined}>
        <h3>{check.stage.replaceAll("_", " ")} · {referenceFor(check.stage, check.reference_id).label}</h3>
        <p><strong>Client:</strong> {clientNames.get(check.client_id) ?? "Client record unavailable"} · <strong>Recorded:</strong> {new Date(check.recorded_at).toLocaleString()}</p>
        <p>Expected {Number(check.expected_kg).toLocaleString()} kg / {check.expected_bags} bags · Measured {Number(check.measured_kg).toLocaleString()} kg / {check.measured_bags} bags</p>
        <p><strong>Difference:</strong> {(Number(check.measured_kg) - Number(check.expected_kg)).toLocaleString()} kg · {check.measured_bags - check.expected_bags} bags</p>
        <p>Evidence: {check.evidence_reference}{check.difference_reason ? ` · Difference: ${check.difference_reason}` : ""}</p>
        {onNavigate && <button className="secondary-button" type="button" onClick={() => onNavigate({ view: referenceFor(check.stage, check.reference_id).view, focusId: check.reference_id })}>Open source record</button>}
        {check.stage === "PROCESSING_INTAKE" && <p>Scale: {String(check.payload?.scaleReference ?? "—")} · Warehouse issue: {String(check.payload?.warehouseIssueReference ?? "—")}</p>}
        {check.stage === "PROCESSING_OUTPUT" && Array.isArray(check.payload?.lines) && <ul>{(check.payload.lines as { category: string; quantityKg: number; bagCount: number; warehouseSection?: string; weighingReference?: string }[]).map((line, index) => <li key={index}>{line.category.replaceAll("_", " ")}: {Number(line.quantityKg).toLocaleString()} kg / {line.bagCount} bags · Section {line.warehouseSection || "—"} · Scale {line.weighingReference || "—"}</li>)}</ul>}
        {canReview(check.stage, check.recorded_by) ? <div className="quantity-decision"><label>Decision note<textarea value={notes[check.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [check.id]: event.target.value }))} /></label><button className="primary-button" type="button" disabled={busyId !== "" || (notes[check.id]?.trim().length ?? 0) < 5} onClick={() => void decide(check.id, "check", "APPROVED")}>Approve</button><button className="secondary-button" type="button" disabled={busyId !== "" || (notes[check.id]?.trim().length ?? 0) < 5} onClick={() => void decide(check.id, "check", "REJECTED")}>Reject</button></div> : <small>Independent authorized reviewer required{check.recorded_by === userId ? "; you recorded this check" : ""}.</small>}
      </article>)}
      {reviews.jobs.map((job) => <article key={job.id} id={`operational-review-${job.id}`} className={job.id === focusId ? "focused-charge" : undefined}>
        <h3>{job.job_type === "BLEND" ? "Blending (ሳቢያ)" : "Rebagging"} · {job.evidence_reference}</h3>
        <p><strong>Client:</strong> {clientNames.get(job.client_id) ?? "Client record unavailable"} · <strong>Recorded:</strong> {new Date(job.created_at).toLocaleString()}</p>
        <p>{job.input_bags} bags / {Number(job.input_kg).toLocaleString()} kg → {job.output_bags} bags / {Number(job.output_kg).toLocaleString()} kg</p>
        <p>Sources: {reviews.sources.filter((source) => source.job_id === job.id).map((source) => `${lotNames.get(source.lot_id) ?? source.lot_id}: ${Number(source.input_kg).toLocaleString()} kg / ${source.input_bags} bags`).join("; ")}. Output section: {job.output_section}</p>
        <p>Evidence: {job.evidence_reference} · {job.instruction}</p>
        {onNavigate && <button className="secondary-button" type="button" onClick={() => onNavigate({ view: "Processing" })}>Open Processing</button>}
        {canReview("TRANSFORM", job.recorded_by) ? <div className="quantity-decision"><label>Decision note<textarea value={notes[job.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [job.id]: event.target.value }))} /></label><button className="primary-button" type="button" disabled={busyId !== "" || (notes[job.id]?.trim().length ?? 0) < 5} onClick={() => void decide(job.id, "job", "APPROVED")}>Approve and post</button><button className="secondary-button" type="button" disabled={busyId !== "" || (notes[job.id]?.trim().length ?? 0) < 5} onClick={() => void decide(job.id, "job", "REJECTED")}>Reject</button></div> : <small>Independent manager approval required{job.recorded_by === userId ? "; you recorded this job" : ""}.</small>}
      </article>)}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
