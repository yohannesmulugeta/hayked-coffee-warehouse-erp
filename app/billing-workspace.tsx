"use client";

import { useState, type FormEvent } from "react";
import {
  createBillingPriceVersion, postManualService, recordStorageRent, verifyTariffVersion,
  loadRentCalculation, type FinanceData, type PriceServiceDraft, type RentOverviewRow,
} from "@/lib/erp-data";
import { billingDate, serviceAgreementVersion } from "./finance-rules";

const money = (n: number | null) => n === null ? "Needs review" : `ETB ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
export const rentLabels: Record<string, string> = {
  NO_PROCESSING: "Stored without processing", WAITING_PROCESSING: "Waiting for processing",
  PROCESSED_EXPORT: "Processed export coffee", REJECT: "Reject coffee",
  EMPTY_BAGS: "Empty bags", GRADE_IMPROVEMENT: "Grade-improvement coffee",
};
const serviceNames = ["PROCESSING", "HULLING", "CLEANING", "LABOUR", "LOADING", "UNLOADING", "WEIGHING", "BAG_PRINTING", "PACKING", "VACUUM_PACKING", "CONTAINER_HANDLING", "GENERATOR", "TRANSPORT", "CERTIFICATION", "OTHER"];
const label = (s: string) => s.toLowerCase().replaceAll("_", " ");

export function RentOverview({ data, clientId, onReview, onReload }: {
  data: FinanceData; clientId: string; onReview: (rentId: string) => void; onReload: () => Promise<void>;
}) {
  const [setup, setSetup] = useState<RentOverviewRow | null>(null);
  const [category, setCategory] = useState("");
  const [start, setStart] = useState(billingDate());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = data.rentOverview.filter(r => !clientId || r.clientId === clientId);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!setup || !category || category === "EMPTY_BAGS" || busy) return;
    setBusy(true); setError("");
    try {
      await recordStorageRent({ clientId: setup.clientId, lotId: setup.lotId, storageCategory: category, chargeStartOn: start });
      setSetup(null); await onReload();
    } catch (e) { setError(e instanceof Error ? e.message : "Rent could not be set up."); }
    finally { setBusy(false); }
  }
  return <section className="billing-card">
    <header><div><h2>Rent by lot</h2><p>Completed days are ready to bill. Today is an estimate and changes with stock movements.</p></div></header>
    {!rows.length && <p className="empty-result">No client stock or rent records to review.</p>}
    <div className="rent-lot-grid">{rows.map(r => <article className="rent-lot-card" key={r.lotId}>
      <div><strong>{r.lotNumber}</strong><small>{data.clients.find(c => c.id === r.clientId)?.legal_name}</small></div>
      <p>{r.category ? rentLabels[r.category] : "Storage category needed"}{r.inherited ? " · From processing" : ""}</p>
      <dl>
        <div><dt>Remaining stock</dt><dd>{Number(r.quantityKg).toLocaleString()} kg · {r.bags} bags</dd></div>
        <div><dt>Billable quantity</dt><dd>{r.category === "EMPTY_BAGS" ? "Needs reconciliation" : r.today ? `${Number(r.today.units).toLocaleString()} equivalent bags` : "—"}</dd></div>
        <div><dt>Accrued through yesterday</dt><dd>{r.category === "EMPTY_BAGS" ? "Needs reconciliation" : r.rentId ? money(r.accrued) : "Not calculated"}</dd></div>
        <div><dt>Today’s estimate</dt><dd>{r.category === "EMPTY_BAGS" ? "—" : r.today ? money(r.today.amount) : "—"}</dd></div>
        <div><dt>Billed through</dt><dd>{r.billedThrough ?? "Not billed yet"}</dd></div>
      </dl>
      {r.freeUntil && r.freeUntil >= billingDate() && <p className="billing-notice">Free through {r.freeUntil}{r.freeUntil === billingDate(1) ? " · Ends tomorrow" : ""}</p>}
      {r.error && <p className="billing-error">{r.error}</p>}
      {r.category === "EMPTY_BAGS" && <p className="billing-notice">Legacy empty-bag rent needs warehouse and finance reconciliation. New empty client-owned bags are recorded in Bag Control.</p>}
      <details><summary>How is rent calculated?</summary><p>Daily closing coffee kg ÷ agreement bag weight × that day’s rate.</p>
        <p>Stage started: {r.categoryStart ?? "Not set"} · Agreement bag weight: {r.bagWeightKg ?? "—"} kg · Prices: {r.tariffVersion ?? "Not set"}</p>
        <p>Processing reduces the arrival lot from the intake day. Accepted output and rejects are tracked separately. Earlier posted amounts stay unchanged.</p>
      </details>
      {r.category === "EMPTY_BAGS" ? null : r.rentId ? <button className="secondary-button" onClick={() => onReview(r.rentId!)}>Review rent</button>
        : <button className="secondary-button" onClick={() => { setSetup(r); setCategory(""); setError(""); }}>Set up rent</button>}
    </article>)}</div>
    {setup && <form className="billing-form" onSubmit={save}>
      <h3>Set up rent · {setup.lotNumber}</h3>
      <label>Storage category<select required value={category} onChange={e => setCategory(e.target.value)}>
        <option value="">Choose the agreed storage category</option>
        {Object.entries(rentLabels).filter(([id]) => id !== "EMPTY_BAGS").map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <label>Track unbilled rent from<input required type="date" max={billingDate()} value={start} onChange={e => setStart(e.target.value)} /></label>
      <p>Free days follow the storage stage’s start date, not the date you fill in this form.</p>
      {error && <p role="alert" className="billing-error">{error}</p>}
      <div className="billing-actions"><button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Start rent tracking"}</button>
        <button type="button" className="secondary-button" onClick={() => setSetup(null)}>Cancel</button></div>
    </form>}
  </section>;
}

export function BillingServiceForm({ data, clientId, onClient, onSaved }: {
  data: FinanceData; clientId: string; onClient: (id: string) => void; onSaved: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [rateId, setRateId] = useState("");
  const [date, setDate] = useState(billingDate());
  const [quantity, setQuantity] = useState("");
  const [orderId, setOrderId] = useState("");
  const [approver, setApprover] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const version = serviceAgreementVersion(data, clientId, date, orderId);
  const tariff = data.tariffs.find(t => t.version_code === version);
  const rates = data.serviceRates.filter(r => r.active && r.tariff_version_id === tariff?.id && r.effective_from <= date
    && (!r.effective_to || r.effective_to >= date));
  const rate = rates.find(r => r.id === rateId);
  const orders = data.processingOrders.filter(o => o.client_id === clientId);
  const canRecord = ["system_admin", "warehouse_manager", "finance_officer", "processing_supervisor"].includes(data.profiles.find(p => p.id === data.currentUserId)?.role ?? "");
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!rate || busy) return;
    setBusy(true); setMessage("");
    try {
      await postManualService({ clientId, serviceCode: rate.service_code, serviceDate: date,
        description: rate.description, quantity: Number(quantity), unitLabel: rate.unit_label,
        unitPrice: Number(rate.unit_price), approvedBy: approver, processingOrderId: orderId || null,
        evidenceReference: reference, note });
      setMessage("Service recorded. Review it in Unbilled Services to prepare an invoice.");
      setQuantity(""); setReference(""); setNote(""); await onSaved();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Service could not be recorded."); }
    finally { setBusy(false); }
  }
  return <form className="billing-card billing-form" onSubmit={save}>
    <h2>Add a completed service</h2><p>Select the work performed. The client agreement supplies the price; a payment is recorded after invoicing.</p>
    <div className="billing-form-grid">
      <label>Client<select required value={clientId} onChange={e => { onClient(e.target.value); setOrderId(""); setRateId(""); }}>
        <option value="">Choose client</option>{data.clients.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.legal_name}</option>)}
      </select></label>
      <label>Service date<input required type="date" max={billingDate()} value={date} onChange={e => { setDate(e.target.value); setRateId(""); }} /></label>
      <label>Completed processing order<select value={orderId} onChange={e => { setOrderId(e.target.value); setRateId(""); }}>
        <option value="">Not linked to processing</option>{orders.map(o => <option key={o.id} value={o.id}>{o.order_number}</option>)}
      </select></label>
      <label>Find service<input type="search" value={query} placeholder="Search loading, processing, packing…" onChange={e => setQuery(e.target.value)} /></label>
      <label>Service<select required value={rateId} onChange={e => setRateId(e.target.value)}>
        <option value="">Choose service</option>{rates.filter(r => `${r.description} ${r.service_code}`.toLowerCase().includes(query.toLowerCase()))
          .map(r => <option key={r.id} value={r.id}>{r.description} · {r.unit_label}</option>)}
      </select></label>
      <label>Quantity {rate ? `(${rate.unit_label})` : ""}<input required type="number" min="0.001" step="0.001" value={quantity} onChange={e => setQuantity(e.target.value)} /></label>
      <label>Independent approver<select required value={approver} onChange={e => setApprover(e.target.value)}>
        <option value="">Choose approver</option>{data.profiles.filter(p => p.id !== data.currentUserId && ["system_admin","warehouse_manager","finance_officer"].includes(p.role))
          .map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
      </select></label>
      <label>Job card / work reference<input required value={reference} onChange={e => setReference(e.target.value)} /></label>
    </div>
    <label>Notes<textarea value={note} onChange={e => setNote(e.target.value)} /></label>
    {!clientId ? <p>Choose a client to see agreement prices.</p> : !rates.length ? <p className="billing-notice">No verified service prices for this agreement and date. Finance can configure them in Rates.</p> : null}
    {rate && <p className="billing-total">{quantity || "0"} {rate.unit_label} × {money(rate.unit_price)} = {money(Math.round(Number(quantity || 0) * Number(rate.unit_price) * 100) / 100)} <small>Price version: {version}</small></p>}
    {message && <p role="status">{message}</p>}
    <button className="primary-button" disabled={busy || !rate || !canRecord}>{busy ? "Recording…" : "Record service as unbilled work"}</button>
  </form>;
}

export function BillingPriceVersions({ data, onReload }: { data: FinanceData; onReload: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [source, setSource] = useState(data.tariffs.find(t => t.active)?.id ?? "");
  const [code, setCode] = useState("");
  const [date, setDate] = useState(billingDate());
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [services, setServices] = useState<PriceServiceDraft[]>([]);
  const [tax, setTax] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const role = data.profiles.find(p => p.id === data.currentUserId)?.role;
  const canEdit = role === "finance_officer" || role === "system_admin";
  const canReview = canEdit || role === "warehouse_manager";
  function copy(id: string) {
    setSource(id); setPrices({});
    setServices(data.serviceRates.filter(r => r.tariff_version_id === id).map(r => ({ service_code:r.service_code, description:r.description, unit_label:r.unit_label, unit_price:Number(r.unit_price) })));
    const t = data.tariffs.find(t => t.id === id);
    setTax(t?.invoice_tax_rate == null ? "" : String(Number(t.invoice_tax_rate) * 100));
  }
  async function save(e: FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setMessage("");
    try {
      await createBillingPriceVersion({ sourceId:source, code, effectiveFrom:date, storagePrices:prices, services, taxRate:tax === "" ? null : Number(tax)/100 });
      setEditing(false); setMessage("Price draft saved. Two employees review it before new agreements use it."); await onReload();
    } catch(e) { setMessage(e instanceof Error ? e.message : "Prices could not be saved."); }
    finally { setBusy(false); }
  }
  async function verify(id: string) {
    setBusy(true); setMessage("");
    try { const result = await verifyTariffVersion(id); setMessage(String(result).replaceAll("_"," ")); await onReload(); }
    catch(e) { setMessage(e instanceof Error ? e.message : "Verification failed."); }
    finally { setBusy(false); }
  }
  return <section className="billing-card">
    <h2>Agreement prices</h2><p>New agreements use the latest active version for their start date. Existing agreements keep their prices. Recorded charges never reprice.</p>
    {canEdit && <button className="secondary-button" onClick={() => { copy(source); setEditing(true); }}>Create a new price version</button>}
    {message && <p role="status">{message}</p>}
    {data.tariffs.map(t => <details className="price-version" key={t.id}>
      <summary>{t.version_code} · {t.active ? t.effective_from > billingDate() ? "Scheduled" : "Active" : "Awaiting review"} · New agreements from {t.effective_from}</summary>
      <p>{data.agreements.filter(a => a.tariff_version === t.version_code).length} agreements use this version. Tax: {t.invoice_tax_rate == null ? "Not configured; invoice issuance blocked" : `${Number(t.invoice_tax_rate)*100}%`}</p>
      <p>Each database rate record retains its agreement source. Agreement 001/2018 bands use the configured 30-day month interpretation; confirm the signed terms before changing a band.</p>
      {data.tariffLineItems.filter(l => l.tariff_version_id === t.id).map(l => <p key={l.id}>{rentLabels[l.category]} · Day {l.age_start_days}–{l.age_end_days ?? "onward"} · {money(l.daily_rate_per_unit)} · {l.certified ? "Certified" : "Standard"}<small>{l.source_clause} {l.source_pdf_page ? `· Page ${l.source_pdf_page}` : ""}</small></p>)}
      {(t.service_rate_draft.length ? t.service_rate_draft : data.serviceRates.filter(r => r.tariff_version_id === t.id)).map((r,i) => <p key={i}>{r.description} · {money(r.unit_price)} / {r.unit_label}</p>)}
      {!t.active && canReview && <button disabled={busy || t.verified_by_1 === data.currentUserId} className="secondary-button" onClick={() => void verify(t.id)}>
        {t.verified_by_1 === data.currentUserId ? "Awaiting a second employee" : "Verify these prices"}</button>}
    </details>)}
    {editing && <form className="billing-form" onSubmit={save}>
      <h3>New agreement price version</h3>
      <div className="billing-form-grid">
        <label>Copy from<select value={source} onChange={e => copy(e.target.value)}>{data.tariffs.filter(t => t.active).map(t => <option key={t.id} value={t.id}>{t.version_code}</option>)}</select></label>
        <label>Version name<input required value={code} onChange={e => setCode(e.target.value)} placeholder="For example: SEPTEMBER-2026" /></label>
        <label>New agreements from<input required type="date" min={billingDate()} value={date} onChange={e => setDate(e.target.value)} /></label>
        <label>Invoice tax (%)<input type="number" min="0" max="100" step="0.01" value={tax} onChange={e => setTax(e.target.value)} placeholder="Leave blank until confirmed" /></label>
      </div>
      <h3>Storage prices</h3><p>Free periods remain as agreed. Enter the new rates for chargeable bands.</p>
      <div className="billing-form-grid">{data.tariffLineItems.filter(l => l.tariff_version_id === source && Number(l.daily_rate_per_unit)>0).map(l =>
        <label key={l.id}>{rentLabels[l.category]} · Day {l.age_start_days}–{l.age_end_days ?? "onward"} · {l.certified ? "Certified" : "Standard"}
          <input required type="number" min="0" step="0.01" value={prices[l.id] ?? l.daily_rate_per_unit} onChange={e => setPrices({ ...prices, [l.id]:Number(e.target.value) })} />
        </label>)}</div>
      <h3>Service prices</h3>
      {services.map((s,i) => <div className="billing-form-grid service-price-row" key={i}>
        <label>Service type<select value={s.service_code} onChange={e => setServices(services.map((v,j) => i===j ? {...v,service_code:e.target.value} : v))}>{serviceNames.map(n => <option key={n} value={n}>{label(n)}</option>)}</select></label>
        <label>Description<input required value={s.description} onChange={e => setServices(services.map((v,j) => i===j ? {...v,description:e.target.value} : v))} /></label>
        <label>Charging unit<input required value={s.unit_label} placeholder="kg, bag, trip, hour…" onChange={e => setServices(services.map((v,j) => i===j ? {...v,unit_label:e.target.value} : v))} /></label>
        <label>ETB per unit<input required type="number" min="0" step="0.01" value={s.unit_price} onChange={e => setServices(services.map((v,j) => i===j ? {...v,unit_price:Number(e.target.value)} : v))} /></label>
        <button type="button" className="secondary-button" onClick={() => setServices(services.filter((_,j) => j!==i))}>Remove draft line</button>
      </div>)}
      <button type="button" className="secondary-button" onClick={() => setServices([...services,{service_code:"OTHER",description:"",unit_label:"",unit_price:0}])}>Add service price</button>
      <div className="billing-actions"><button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save price draft"}</button>
        <button type="button" className="secondary-button" onClick={() => setEditing(false)}>Cancel</button></div>
    </form>}
  </section>;
}

export function SavedRentCalculation({ runId }: { runId: string }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof loadRentCalculation>> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    try { setRows(await loadRentCalculation(runId)); } catch(e) { setError(e instanceof Error ? e.message : "Could not load calculation."); }
    finally { setBusy(false); }
  }
  return <div className="saved-rent-calculation"><button type="button" className="secondary-button" disabled={busy} onClick={() => void load()}>{busy ? "Loading…" : "How was this rent calculated?"}</button>
    {error && <p role="alert">{error}</p>}
    {rows && <div className="billing-calculation-scroll"><table><caption>Saved daily rent. Posted values stay unchanged.</caption><thead><tr><th>Date</th><th>Closing kg</th><th>Bag weight</th><th>Units</th><th>Rate</th><th>Amount</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.charge_date}><td>{r.charge_date}</td><td>{r.closing_kg}</td><td>{r.bag_weight_kg}</td><td>{Number(r.billable_units).toLocaleString()}</td><td>{money(r.rate_etb)}</td><td>{money(r.amount_etb)}</td></tr>)}</tbody></table></div>}
  </div>;
}
