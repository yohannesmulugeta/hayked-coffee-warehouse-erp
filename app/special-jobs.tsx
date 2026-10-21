"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase/client";
import type { ProcessingData } from "@/lib/erp-data";
import {
  decideTransformJob, loadTransformJobs, submitTransformJob,
  type TransformJob, type TransformSource,
} from "@/lib/quantity-checks";

type SourceDraft = { key: number; lotId: string; bags: number; kg: number };
let nextKey = 1;
const blankSource = (): SourceDraft => ({ key: nextKey++, lotId: "", bags: 0, kg: 0 });

export function SpecialJobs({ data, onChanged, canSubmit, canApprove }: { data: ProcessingData | null; onChanged: () => Promise<void>; canSubmit: boolean; canApprove: boolean }) {
  const [type, setType] = useState<"REBAG" | "BLEND">("REBAG");
  const [clientId, setClientId] = useState("");
  const [sources, setSources] = useState<SourceDraft[]>([blankSource()]);
  const [outputBags, setOutputBags] = useState(0);
  const [outputKg, setOutputKg] = useState(0);
  const [section, setSection] = useState("");
  const [evidence, setEvidence] = useState("");
  const [instruction, setInstruction] = useState("");
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [jobs, setJobs] = useState<TransformJob[]>([]);
  const [savedSources, setSavedSources] = useState<TransformSource[]>([]);
  const [userId, setUserId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const eligibleLots = useMemo(() => (data?.lots ?? []).filter((lot) =>
    lot.client_id === clientId && lot.ownership_type === "CLIENT" &&
    ["ARRIVAL", "ACCEPTED_PROCESSED", "CLIENT_REJECT"].includes(lot.lot_category ?? "") &&
    ["ARRIVAL_IN_STORAGE", "PROCESSED", "AWAITING_DISPATCH"].includes(lot.status) && Number(lot.quantity_kg) > 0,
  ), [data?.lots, clientId]);
  const sourceKg = sources.reduce((sum, source) => sum + source.kg, 0);
  const sourceBags = sources.reduce((sum, source) => sum + source.bags, 0);
  const lotById = new Map((data?.lots ?? []).map((lot) => [lot.id, lot]));

  async function reload() {
    const next = await loadTransformJobs();
    setJobs(next.jobs);
    setSavedSources(next.sources);
  }
  useEffect(() => {
    let mounted = true;
    void Promise.all([loadTransformJobs(), createSupabaseClient().auth.getUser()])
      .then(([next, auth]) => {
        if (!mounted) return;
        setJobs(next.jobs);
        setSavedSources(next.sources);
        setUserId(auth.data.user?.id ?? "");
      }).catch((error) => { if (mounted) setMessage(error instanceof Error ? error.message : "Special jobs unavailable."); });
    return () => { mounted = false; };
  }, []);

  function updateSource(key: number, patch: Partial<SourceDraft>) {
    setSources((current) => current.map((source) => source.key === key ? { ...source, ...patch } : source));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((type === "REBAG" && sources.length !== 1) || (type === "BLEND" && sources.length < 2)
      || sources.some((source) => !source.lotId || source.bags <= 0 || source.kg <= 0)
      || new Set(sources.map((source) => source.lotId)).size !== sources.length
      || Math.round(sourceKg * 1000) !== Math.round(outputKg * 1000)) {
      setMessage("Select distinct source lots and enter measured quantities. Input and output kilograms must match.");
      return;
    }
    setBusy(true);
    let saved = false;
    try {
      const id = await submitTransformJob({
        type, clientId, sources: sources.map(({ lotId, bags, kg }) => ({ lotId, bags, kg })),
        outputBags, outputKg, section, evidenceReference: evidence, instruction,
      });
      saved = true;
      await reload();
      setMessage(`Job ${id.slice(0, 8)} submitted. No stock moved; a different manager must review it.`);
      setSources([blankSource()]);
      setOutputBags(0); setOutputKg(0); setSection(""); setEvidence(""); setInstruction("");
    } catch (error) {
      setMessage(saved ? `Job saved, but refresh failed: ${error instanceof Error ? error.message : "unknown error"}` : error instanceof Error ? error.message : "The special job could not be submitted.");
    } finally { setBusy(false); }
  }

  async function decide(job: TransformJob, decision: "APPROVED" | "REJECTED") {
    const note = decisionNotes[job.id]?.trim() ?? "";
    if (note.length < 5) return;
    setBusy(true);
    let decisionSaved = false;
    try {
      const result = await decideTransformJob(job.id, decision, note);
      decisionSaved = true;
      await Promise.all([reload(), onChanged()]);
      setMessage(`${job.job_type.toLowerCase()} ${decision.toLowerCase()}${result.output_lot_id ? " and a traceable output lot was created" : ""}.`);
    } catch (error) {
      setMessage(decisionSaved ? `Decision saved, but refresh failed: ${error instanceof Error ? error.message : "unknown error"}` : error instanceof Error ? error.message : "The decision could not be saved.");
    } finally { setBusy(false); }
  }

  return <section className="special-jobs">
    <div className="module-heading"><div><span className="demo-label">CONTROLLED STOCK CHANGE</span><h1>Rebagging and blending (ሳቢያ)</h1><p>Record measured source and output quantities. A separate manager reviews the job before any stock moves.</p></div></div>
    {message && <p className="operation-message" role="status">{message}</p>}
    {canSubmit && <form className="operation-form" onSubmit={submit}>
      <div className="form-grid compact">
        <label>Job type<select value={type} onChange={(event) => { const next = event.target.value as "REBAG" | "BLEND"; setType(next); setSources(next === "REBAG" ? [blankSource()] : [blankSource(), blankSource()]); }}><option value="REBAG">Rebagging</option><option value="BLEND">Blending (ሳቢያ)</option></select></label>
        <label>Client<select required value={clientId} onChange={(event) => { setClientId(event.target.value); setSources(type === "REBAG" ? [blankSource()] : [blankSource(), blankSource()]); }}><option value="">Select client</option>{(data?.clients ?? []).map((client) => <option key={client.id} value={client.id}>{client.legal_name}</option>)}</select></label>
      </div>
      <h2>Measured source lots</h2>
      {sources.map((source, index) => <div className="form-grid compact" key={source.key}>
        <label>Source {index + 1}<select required value={source.lotId} onChange={(event) => updateSource(source.key, { lotId: event.target.value })}><option value="">Select lot</option>{eligibleLots.map((lot) => <option key={lot.id} value={lot.id} disabled={sources.some((other) => other.key !== source.key && other.lotId === lot.id)}>{lot.lot_number} · {Number(lot.quantity_kg).toLocaleString()} kg / {lot.bag_count} bags</option>)}</select></label>
        <label>Counted bags<input type="number" min="1" required value={source.bags || ""} onChange={(event) => updateSource(source.key, { bags: Number(event.target.value) })} /></label>
        <label>Weighed kg<input type="number" min="0.001" step="0.001" required value={source.kg || ""} onChange={(event) => updateSource(source.key, { kg: Number(event.target.value) })} /></label>
        {type === "BLEND" && sources.length > 2 && <button type="button" className="secondary-button" onClick={() => setSources((current) => current.filter((item) => item.key !== source.key))}>Remove</button>}
      </div>)}
      {type === "BLEND" && <button type="button" className="secondary-button" onClick={() => setSources((current) => [...current, blankSource()])}>Add source lot</button>}
      <h2>Measured output</h2>
      <div className="form-grid compact">
        <label>Output bags<input type="number" min="1" required value={outputBags || ""} onChange={(event) => setOutputBags(Number(event.target.value))} /></label>
        <label>Output kg<input type="number" min="0.001" step="0.001" required value={outputKg || ""} onChange={(event) => setOutputKg(Number(event.target.value))} /></label>
        <label>Warehouse section<input required minLength={2} value={section} onChange={(event) => setSection(event.target.value)} /></label>
        <label>Weighing evidence reference<input required minLength={3} value={evidence} onChange={(event) => setEvidence(event.target.value)} /></label>
        <label className="wide">Job instruction / reason<textarea required minLength={5} value={instruction} onChange={(event) => setInstruction(event.target.value)} /></label>
      </div>
      <p>Source: {sourceBags} bags / {sourceKg.toLocaleString()} kg · Output: {outputBags} bags / {outputKg.toLocaleString()} kg · Difference: {(sourceKg - outputKg).toLocaleString()} kg</p>
      <button type="submit" className="primary-button" disabled={busy || Math.round(sourceKg * 1000) !== Math.round(outputKg * 1000)}>Send job for approval</button>
      <p className="form-note">Blending (ሳቢያ) uses two or more measured source lots and creates one traceable output lot.</p>
    </form>}
    <section className="record-panel"><h2>Special job history</h2>
      {jobs.length === 0 && <p>No rebagging or blending jobs recorded.</p>}
      {jobs.map((job) => <article className="special-job-card" key={job.id}>
        <h3>{job.job_type} · {job.id.slice(0, 8)} · {job.status}</h3>
        <p>Sources: {savedSources.filter((source) => source.job_id === job.id).map((source) => `${lotById.get(source.lot_id)?.lot_number ?? source.lot_id.slice(0, 8)} ${Number(source.input_kg).toLocaleString()} kg`).join(" + ")}</p>
        <p>{job.input_bags} bags / {Number(job.input_kg).toLocaleString()} kg → {job.output_bags} bags / {Number(job.output_kg).toLocaleString()} kg at {job.output_section}</p>
        <p>Evidence: {job.evidence_reference} · {job.instruction}{job.output_lot_id ? ` · Output lot: ${lotById.get(job.output_lot_id)?.lot_number ?? job.output_lot_id}` : ""}</p>
        {job.status === "PENDING" && canApprove && <div className="quantity-decision"><label>Independent decision note<textarea value={decisionNotes[job.id] ?? ""} onChange={(event) => setDecisionNotes((current) => ({ ...current, [job.id]: event.target.value }))} /></label><button type="button" className="primary-button" disabled={busy || job.recorded_by === userId || (decisionNotes[job.id]?.trim().length ?? 0) < 5} onClick={() => void decide(job, "APPROVED")}>Approve and post</button><button type="button" className="secondary-button" disabled={busy || job.recorded_by === userId || (decisionNotes[job.id]?.trim().length ?? 0) < 5} onClick={() => void decide(job, "REJECTED")}>Reject</button>{job.recorded_by === userId && <small>Another manager must review this job.</small>}</div>}
      </article>)}
    </section>
  </section>;
}
