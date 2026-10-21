"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  decideEmptyBagCharge, loadEmptyBagChargeDays, loadEmptyBagChargeRuns,
  postEmptyBagCharge, prepareEmptyBagCharge, quoteEmptyBagCharge,
  type EmptyBagChargeQuote, type EmptyBagChargeRun, type EmptyBagChargeType,
} from "@/lib/empty-bags";
import type { FinanceData } from "@/lib/erp-data";
import { billingDate } from "./finance-rules";

const money = (value: number) => `ETB ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const chargeName = (type: EmptyBagChargeType) => type === "STORAGE" ? "Jute-bag storage" : "Article 16.4 exception";
const billingError = (caught: unknown, fallback: string) => {
  const message = caught instanceof Error ? caught.message : fallback;
  return message.includes("empty_bag_charge_runs") && message.includes("schema cache")
    ? "Empty-bag billing is awaiting database setup. Ask an administrator to apply the approved migration."
    : message;
};

export function SavedBagChargeCalculation({ runId }: { runId: string }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof loadEmptyBagChargeDays>> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true); setError("");
    try { setRows(await loadEmptyBagChargeDays(runId)); }
    catch (caught) { setError(billingError(caught, "Daily bag charges could not be loaded.")); }
    finally { setBusy(false); }
  }
  return <div className="saved-rent-calculation">
    <button type="button" className="secondary-button" disabled={busy} onClick={() => void load()}>
      {busy ? "Loading…" : "How was this bag charge calculated?"}
    </button>
    {error && <p role="alert">{error}</p>}
    {rows && <div className="billing-calculation-scroll"><table>
      <caption>Saved daily empty-bag charge. Posted values stay unchanged.</caption>
      <thead><tr><th>Date</th><th>Receipt cohort</th><th>Closing bags</th><th>Age</th><th>50-bag units / days</th><th>Rate</th><th>Amount</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={`${row.charge_date}-${row.cohort_event_id ?? index}`}>
        <td>{row.charge_date}</td><td>{row.cohort_event_id?.slice(0, 8) ?? "Article 16.4"}</td>
        <td>{row.closing_bags}</td><td>{row.age_day ?? "—"}</td>
        <td>{Number(row.billable_units).toLocaleString()}</td><td>{money(row.rate_etb)}</td><td>{money(row.amount_etb)}</td>
      </tr>)}</tbody>
    </table></div>}
  </div>;
}

export function EmptyBagBilling({ data, clientId, onPosted }: {
  data: FinanceData; clientId: string; onPosted: () => Promise<void>;
}) {
  const [client, setClient] = useState(clientId);
  const [agreement, setAgreement] = useState("");
  const [type, setType] = useState<EmptyBagChargeType>("STORAGE");
  const [from, setFrom] = useState(`${billingDate().slice(0, 7)}-01`);
  const [to, setTo] = useState(billingDate(-1));
  const [evidence, setEvidence] = useState("");
  const [reason, setReason] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [quote, setQuote] = useState<EmptyBagChargeQuote | null>(null);
  const [runs, setRuns] = useState<EmptyBagChargeRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const role = data.profiles.find((profile) => profile.id === data.currentUserId)?.role;
  const canPrepare = role === "system_admin" || role === "finance_officer";
  const canReview = role === "system_admin" || role === "warehouse_manager";
  const matchingAgreements = data.agreements.filter((item) => item.client_id === client
    && ["ACTIVE", "EXPIRED"].includes(item.status)
    && item.effective_from <= from && (!item.effective_to || item.effective_to >= to));

  useEffect(() => {
    if (!client) return;
    let live = true;
    void loadEmptyBagChargeRuns(client).then((items) => { if (live) setRuns(items); })
      .catch((caught) => { if (live) setError(billingError(caught, "Bag charges could not be loaded.")); });
    return () => { live = false; };
  }, [client]);

  async function refresh() {
    if (client) setRuns(await loadEmptyBagChargeRuns(client));
  }
  async function calculate(event: FormEvent) {
    event.preventDefault();
    if (!client || !agreement || busy) return;
    setBusy(true); setError(""); setMessage(""); setQuote(null);
    try { setQuote(await quoteEmptyBagCharge({ clientId: client, agreementId: agreement, from, to, type })); }
    catch (caught) { setError(billingError(caught, "The bag charge could not be calculated.")); }
    finally { setBusy(false); }
  }
  async function prepare() {
    if (!quote || !canPrepare || busy) return;
    setBusy(true); setError("");
    try {
      await prepareEmptyBagCharge({ clientId: client, agreementId: agreement, from, to, type,
        evidenceReference: evidence, reason });
      setQuote(null); setEvidence(""); setReason("");
      await refresh(); setMessage("Charge prepared. A different manager must review it before finance posts it.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The charge could not be prepared."); }
    finally { setBusy(false); }
  }
  async function decide(runId: string, approve: boolean) {
    setBusy(true); setError("");
    try {
      await decideEmptyBagCharge(runId, approve, reviewNote);
      setReviewNote(""); await refresh();
      setMessage(approve ? "Charge approved for finance posting." : "Charge rejected; its dates can be corrected and prepared again.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The review could not be saved."); }
    finally { setBusy(false); }
  }
  async function post(runId: string) {
    setBusy(true); setError("");
    try {
      const eventId = await postEmptyBagCharge(runId);
      await Promise.all([refresh(), onPosted()]);
      setMessage(eventId ? "Bag charge posted as unbilled work. Prepare it with this client’s invoice." : "Zero-charge period posted with no invoice line.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The bag charge could not be posted."); }
    finally { setBusy(false); }
  }

  return <section className="billing-card" aria-label="Empty client-owned bag charges">
    <header><div><h2>Empty jute-bag storage</h2><p>Article 16 uses actual custody, each receipt’s age, and proportional 50-bag units. Held and damaged bags still occupy storage.</p></div></header>
    <p className="billing-notice">Testing release on the live database: calculate and post charges only for real client custody records. An independently verified tariff and separate review are required before posting.</p>
    <form className="billing-form" onSubmit={calculate}>
      <div className="billing-form-grid">
        <label>Client<select required value={client} onChange={(event) => { setClient(event.target.value); setAgreement(""); setQuote(null); setRuns([]); setError(""); setMessage(""); }}>
          <option value="">Choose client</option>{data.clients.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.legal_name}</option>)}
        </select></label>
        <label>Client agreement<select required value={agreement} onChange={(event) => { setAgreement(event.target.value); setQuote(null); }}>
          <option value="">Choose agreement</option>
          {matchingAgreements.map((item) => <option key={item.id} value={item.id}>{item.agreement_number} · {item.tariff_version}</option>)}
        </select></label>
        <label>Charge<select value={type} onChange={(event) => { setType(event.target.value as EmptyBagChargeType); setQuote(null); }}>
          <option value="STORAGE">Storage · Article 16.1–16.3</option>
          <option value="ARTICLE_16_4">Exception · Article 16.4</option>
        </select></label>
        <label>From<input required type="date" max={billingDate(-1)} value={from} onChange={(event) => { setFrom(event.target.value); setAgreement(""); setQuote(null); }} /></label>
        <label>Through<input required type="date" min={from} max={billingDate(-1)} value={to} onChange={(event) => { setTo(event.target.value); setAgreement(""); setQuote(null); }} /></label>
      </div>
      <p className="billing-notice">Each receipt has 10 free days. Withdrawals use the oldest bags available at their location. Only completed days can be posted. The agreement price version must be independently verified.</p>
      {type === "ARTICLE_16_4" && <p className="billing-notice">Article 16.4 is never triggered automatically. Finance must identify the exceptional condition and source document; a different manager reviews the reason.</p>}
      <button type="submit" className="secondary-button" disabled={busy || !client || !agreement}>{busy ? "Calculating…" : "Calculate bag charges"}</button>
    </form>
    {quote && <div className="billing-form">
      <h3>{chargeName(quote.chargeType)} · {money(quote.amount)}</h3>
      <p>{Number(quote.billableUnits).toLocaleString()} {type === "STORAGE" ? "50-bag days" : "days"} · {quote.tariffVersion} · {quote.rows.length} daily cohort rows</p>
      <details><summary>Review every day and receipt cohort</summary><div className="billing-calculation-scroll"><table>
        <thead><tr><th>Date</th><th>Receipt cohort</th><th>Opening</th><th>Movement</th><th>Closing</th><th>Age</th><th>Units</th><th>Rate</th><th>Amount</th></tr></thead>
        <tbody>{quote.rows.map((row, index) => <tr key={`${row.date}-${row.cohortId ?? index}`}>
          <td>{row.date}</td><td>{row.cohortId?.slice(0, 8) ?? "Article 16.4"}</td><td>{row.openingBags}</td>
          <td>{row.movementBags}{row.references.length ? <small> · {row.references.join(", ")}</small> : null}</td>
          <td>{row.closingBags}</td><td>{row.ageDay ?? "—"}</td><td>{Number(row.units).toLocaleString()}</td>
          <td>{money(row.rate)}</td><td>{money(row.amount)}</td>
        </tr>)}</tbody>
      </table></div></details>
      {canPrepare && <>
        <label>Count or collection evidence reference<input required minLength={3} value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="Example: COUNT-2026-014" /></label>
        {type === "ARTICLE_16_4" && <label>Why Article 16.4 applies<textarea required minLength={20} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Describe the delayed collection and the supporting notice or document." /></label>}
        <button type="button" className="primary-button" disabled={busy || evidence.trim().length < 3 || (type === "ARTICLE_16_4" && reason.trim().length < 20)} onClick={() => void prepare()}>Prepare for independent review</button>
      </>}
    </div>}
    {error && <p role="alert" className="billing-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    <div className="control-list"><h3>Recent bag charges</h3>
      {!client && <p>Choose a client to review charges.</p>}
      {client && runs.length === 0 && !error && <p>No bag charges have been prepared for this client.</p>}
      {runs.map((run) => <article key={run.id}>
        <strong>{run.run_number} · {chargeName(run.charge_type)}</strong>
        <p>{run.period_start} to {run.period_end} · {money(run.total_amount)} · {run.status.replaceAll("_", " ")}</p>
        <small>Evidence: {run.evidence_reference ?? "—"}{run.charge_reason ? ` · ${run.charge_reason}` : ""}</small>
        {run.status === "PENDING_REVIEW" && canReview && run.prepared_by !== data.currentUserId && <div className="billing-form">
          <label>Review note<input value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Required for Article 16.4 approval or any rejection" /></label>
          <div className="billing-actions"><button type="button" className="primary-button" disabled={busy || (run.charge_type === "ARTICLE_16_4" && reviewNote.trim().length < 10)} onClick={() => void decide(run.id, true)}>Approve</button>
            <button type="button" className="secondary-button" disabled={busy || reviewNote.trim().length < 5} onClick={() => void decide(run.id, false)}>Reject</button></div>
        </div>}
        {run.status === "APPROVED" && canPrepare && run.reviewed_by !== data.currentUserId && <button type="button" className="primary-button" disabled={busy} onClick={() => void post(run.id)}>Post as unbilled work</button>}
        {run.status !== "REJECTED" && <SavedBagChargeCalculation runId={run.id} />}
      </article>)}
    </div>
  </section>;
}
