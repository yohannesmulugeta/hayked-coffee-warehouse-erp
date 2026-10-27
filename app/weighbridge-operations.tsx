"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase/client";

type DispatchForWeighbridge = {
  id: string;
  dispatch_number: string;
  status: string;
  weighbridge_reference: string | null;
};

export function WeighbridgeOperations() {
  const [dispatches, setDispatches] = useState<DispatchForWeighbridge[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [message, setMessage] = useState("");

  const reload = useCallback(async () => {
    const { data, error } = await createSupabaseClient()
      .from("dispatch_orders")
      .select("id,dispatch_number,status,weighbridge_reference")
      .in("status", ["DRAFT", "AWAITING_APPROVAL"])
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setDispatches((data ?? []) as DispatchForWeighbridge[]);
  }, []);

  // The state update follows the database request, outside the effect's synchronous phase.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);

  async function save(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const reference = String(new FormData(form).get("reference") ?? "").trim();
    if (reference.length < 3) {
      setMessage("Enter a weighbridge reference of at least three characters.");
      return;
    }
    setSavingId(id);
    setMessage("");
    const { error } = await createSupabaseClient().rpc("record_dispatch_weighbridge", {
      p_dispatch_id: id,
      p_reference: reference,
    });
    setSavingId("");
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage("Weighbridge reference saved.");
    await reload();
  }

  return <div className="module-content">
    <section className="module-heading"><div><span className="demo-label">DISPATCH</span><h1>Weighbridge tickets</h1><p>Record the outgoing scale reference. Dispatch approval remains with the warehouse manager.</p></div></section>
    {message && <p role="status">{message}</p>}
    {loading ? <p role="status">Loading dispatches...</p> : dispatches.length === 0 ?
      <p className="empty-result">No unapproved dispatch needs a weighbridge ticket.</p> :
      <section className="record-panel">
        {dispatches.map((dispatch) => <form key={dispatch.id} className="readiness-fix-form" onSubmit={(event) => void save(event, dispatch.id)}>
          <h2>{dispatch.dispatch_number}</h2>
          <p>{dispatch.status.replaceAll("_", " ")}</p>
          <label>Weighbridge reference<input name="reference" required minLength={3} defaultValue={dispatch.weighbridge_reference ?? ""} /></label>
          <button className="secondary-button" type="submit" disabled={savingId === dispatch.id}>{savingId === dispatch.id ? "Saving..." : "Save reference"}</button>
        </form>)}
      </section>}
  </div>;
}
