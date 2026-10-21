"use client";

import { useEffect, useState } from "react";
import { loadLotTrace } from "@/lib/quantity-checks";

type Trace = Awaited<ReturnType<typeof loadLotTrace>>;

export function LotTrace({ lotId }: { lotId: string }) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void loadLotTrace(lotId).then((result) => {
      if (active) setTrace(result);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Lot trace unavailable.");
    });
    return () => { active = false; };
  }, [lotId]);

  if (error) return <section role="alert"><h3>Lot trace unavailable</h3><p>{error}</p></section>;
  if (!trace) return <section><h3>Lot trace</h3><p>Loading source and destination records…</p></section>;

  const names = new Map(trace.lots.map((lot) => [lot.id, lot.lot_number]));
  const orderIds = [...new Set([...trace.inputs, ...trace.outputs].map((row) => row.order_id))];
  const sourceJobs = trace.transformSources.filter((row) => row.lot_id === lotId);
  const destinationJobs = trace.transforms.filter((job) => job.output_lot_id === lotId);
  return <section className="lot-trace-section" aria-label="Lot source and destination trace">
    <h3>Source and destination trace</h3>
    {orderIds.map((orderId) => <div key={orderId} className="record-panel">
      <strong>Processing order {orderId}</strong>
      <p>Inputs: {trace.inputs.filter((row) => row.order_id === orderId).map((row) => `${names.get(row.lot_id) ?? row.lot_id}: ${Number(row.input_kg).toLocaleString()} kg / ${row.input_bags} bags`).join("; ") || "None recorded"}</p>
      <p>Outputs: {trace.outputs.filter((row) => row.order_id === orderId).map((row) => `${row.category.replaceAll("_", " ")}: ${Number(row.quantity_kg).toLocaleString()} kg${row.child_lot_id ? ` → ${names.get(row.child_lot_id) ?? row.child_lot_id}` : ""}`).join("; ") || "None recorded"}</p>
      {trace.inputs.filter((row) => row.order_id === orderId).length > 1 && <p>Source links identify the batch; individual source contribution to each output was not measured.</p>}
    </div>)}
    {[...sourceJobs.map((row) => row.job_id), ...destinationJobs.map((job) => job.id)].filter((id, index, all) => all.indexOf(id) === index).map((jobId) => {
      const job = trace.transforms.find((row) => row.id === jobId);
      if (!job) return null;
      return <div key={jobId} className="record-panel">
        <strong>{job.job_type === "REBAG" ? "Rebagging" : "Blending"} · {job.status}</strong>
        <p>Sources: {trace.transformSources.filter((row) => row.job_id === jobId).map((row) => `${names.get(row.lot_id) ?? row.lot_id}: ${Number(row.input_kg).toLocaleString()} kg / ${row.input_bags} bags`).join("; ")}</p>
        <p>Output: {job.output_lot_id ? names.get(job.output_lot_id) ?? job.output_lot_id : "Pending"} · {Number(job.output_kg).toLocaleString()} kg / {job.output_bags} bags</p>
        <p>Evidence: {job.evidence_reference}</p>
      </div>;
    })}
    {trace.checks.map((check, index) => <p key={`${check.reference_id}-${check.stage}-${index}`}>
      <strong>{check.stage.replaceAll("_", " ")} · {check.status}</strong>: expected {Number(check.expected_kg).toLocaleString()} kg / {check.expected_bags} bags; measured {Number(check.measured_kg).toLocaleString()} kg / {check.measured_bags} bags. Evidence: {check.evidence_reference}{check.difference_reason ? `; difference: ${check.difference_reason}` : ""}
    </p>)}
    {orderIds.length === 0 && sourceJobs.length === 0 && destinationJobs.length === 0 && trace.checks.length === 0 && <p>No related processing, transformation, or quantity check records.</p>}
  </section>;
}
