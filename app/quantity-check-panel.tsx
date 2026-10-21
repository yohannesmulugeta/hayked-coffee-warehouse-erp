"use client";

import { FormEvent, useEffect, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase/client";
import {
  decideQuantityCheck, loadQuantityCheck, submitQuantityCheck,
  type QuantityCheck, type QuantityStage,
} from "@/lib/quantity-checks";

export function QuantityCheckPanel({ stage, referenceId, expectedKg, expectedBags,
  measuredKg, measuredBags, canRecord = false, refreshKey = 0, onChanged,
}: {
  stage: QuantityStage; referenceId: string; expectedKg: number; expectedBags: number;
  measuredKg?: number; measuredBags?: number; canRecord?: boolean;
  refreshKey?: number; onChanged?: () => void | Promise<void>;
}) {
  const [check, setCheck] = useState<QuantityCheck | null>(null);
  const [userId, setUserId] = useState("");
  const [declaredKg, setDeclaredKg] = useState(0);
  const [declaredBags, setDeclaredBags] = useState(0);
  const [actualKg, setActualKg] = useState("");
  const [actualBags, setActualBags] = useState("");
  const [evidence, setEvidence] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      loadQuantityCheck(stage, referenceId),
      createSupabaseClient().auth.getUser(),
    ]).then(([saved, auth]) => {
      if (!mounted) return;
      setCheck(saved);
      setUserId(auth.data.user?.id ?? "");
    }).catch((error) => {
      if (mounted) setMessage(error instanceof Error ? error.message : "Quantity check unavailable.");
    });
    return () => { mounted = false; };
  }, [stage, referenceId, refreshKey]);

  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    let saved = false;
    try {
      await submitQuantityCheck({
        stage, referenceId,
        expectedKg: stage === "ARRIVAL" ? declaredKg : null,
        expectedBags: stage === "ARRIVAL" ? declaredBags : null,
        measuredKg: stage === "ARRIVAL" ? measuredKg ?? Number(actualKg) : Number(actualKg),
        measuredBags: stage === "ARRIVAL" ? measuredBags ?? Number(actualBags) : Number(actualBags),
        evidenceReference: evidence, differenceReason: reason,
      });
      saved = true;
      setCheck(await loadQuantityCheck(stage, referenceId));
      setMessage("Measurements submitted for independent review.");
      await onChanged?.();
    } catch (error) {
      setMessage(saved ? `Measurements saved, but refresh failed: ${error instanceof Error ? error.message : "unknown error"}` : error instanceof Error ? error.message : "The check could not be submitted.");
    } finally { setBusy(false); }
  }

  async function decide(decision: "APPROVED" | "REJECTED") {
    if (!check) return;
    setBusy(true);
    setMessage("");
    let saved = false;
    try {
      const result = await decideQuantityCheck(check.id, decision, note);
      saved = true;
      setCheck(await loadQuantityCheck(stage, referenceId));
      setNote("");
      setMessage(result.operation.status
        ? `Check ${decision.toLowerCase()}; operation moved to ${result.operation.status.toLowerCase()}.`
        : `Difference ${decision.toLowerCase()} and held for correction. No stock was posted.`);
      await onChanged?.();
    } catch (error) {
      setMessage(saved ? `Decision saved, but refresh failed: ${error instanceof Error ? error.message : "unknown error"}` : error instanceof Error ? error.message : "The decision could not be saved.");
    } finally { setBusy(false); }
  }

  const isDifferent = check && (Math.abs(Number(check.expected_kg) - Number(check.measured_kg)) > 0.0005
    || (stage !== "PROCESSING_OUTPUT" && check.expected_bags !== check.measured_bags));
  const proposedLines = stage === "PROCESSING_OUTPUT" && Array.isArray(check?.payload?.lines)
    ? check.payload.lines as { category: string; quantityKg: number; bagCount: number; warehouseSection?: string; weighingReference?: string }[] : [];

  return <section className="quantity-check-panel" aria-label="Independent quantity check">
    <header><h3>Physical quantity check</h3><p>Record the scale/count evidence, then have another staff member verify it.</p></header>
    {stage !== "ARRIVAL" && <p>Planned or approved: {expectedBags} bags / {expectedKg.toLocaleString()} kg.</p>}
    {check && check.status !== "REJECTED" ? <>
      <p><strong>{check.status}</strong> · Expected {Number(check.expected_kg).toLocaleString()} kg / {check.expected_bags} bags · Measured {Number(check.measured_kg).toLocaleString()} kg / {check.measured_bags} bags</p>
      <p>Evidence: {check.evidence_reference}{check.difference_reason ? ` · Difference: ${check.difference_reason}` : ""}</p>
      {proposedLines.length > 0 && <ul>{proposedLines.map((line, index) => <li key={index}>{line.category.replaceAll("_", " ")}: {Number(line.quantityKg).toLocaleString()} kg / {line.bagCount} bags · Section {line.warehouseSection || "—"} · Scale {line.weighingReference || "—"}</li>)}</ul>}
      {isDifferent && <p role="status">{stage === "PROCESSING_OUTPUT" ? "The physical output difference must be classified and approved as process loss." : stage === "ARRIVAL" ? "The declared and received amounts differ. The reviewer must confirm the evidence." : "The operation stays on hold. Correct the source order before stock can move."}</p>}
      {check.status === "PENDING" && <div className="quantity-decision">
        <label>Reviewer decision note<textarea value={note} onChange={(event) => setNote(event.target.value)} minLength={5} placeholder="What was checked?" /></label>
        <button type="button" className="primary-button" disabled={busy || note.trim().length < 5 || check.recorded_by === userId} onClick={() => void decide("APPROVED")}>Approve measured quantity</button>
        <button type="button" className="secondary-button" disabled={busy || note.trim().length < 5 || check.recorded_by === userId} onClick={() => void decide("REJECTED")}>Reject</button>
        {check.recorded_by === userId && <small>Another staff member must make this decision.</small>}
      </div>}
    </> : canRecord ? <form className="form-grid compact" onSubmit={record}>
      {stage === "ARRIVAL" && <>
        <p className="wide">Enter the delivery document quantity independently of the GRN measurement.</p>
        <label>Declared bags<input type="number" min="1" required value={declaredBags || ""} onChange={(event) => setDeclaredBags(Number(event.target.value))} /></label>
        <label>Declared weight (kg)<input type="number" min="0.001" step="0.001" required value={declaredKg || ""} onChange={(event) => setDeclaredKg(Number(event.target.value))} /></label>
        <p className="wide">GRN measurement: {measuredBags} bags / {measuredKg?.toLocaleString()} kg. Correct the GRN if these measured values are wrong.</p>
      </>}
      {stage === "DISPATCH_EXIT" && <>
        <label>Actual exit bags<input type="number" min="0" required value={actualBags} onChange={(event) => setActualBags(event.target.value)} /></label>
        <label>Actual exit weight (kg)<input type="number" min="0" step="0.001" required value={actualKg} onChange={(event) => setActualKg(event.target.value)} /></label>
      </>}
      <label>Count / scale ticket reference<input required minLength={3} value={evidence} onChange={(event) => setEvidence(event.target.value)} /></label>
      <label className="wide">Difference explanation<textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required when declared/approved and measured amounts differ" /></label>
      <button className="primary-button" disabled={busy} type="submit">{busy ? "Saving..." : "Send quantities for verification"}</button>
    </form> : <p>{check?.status === "REJECTED" ? "The previous check was rejected. Record corrected measurements." : "Record measurements in the form above for independent review."}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
