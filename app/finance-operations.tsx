"use client";

import { AlertTriangle, Banknote, CalendarDays, Check, FileCheck2, LockKeyhole, ReceiptText, ShieldCheck, WalletCards } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { allocatePayment, calculateStorage, type StorageCategory } from "./finance-rules";
import { loadFinanceData, recordPayment as postPayment, runStorageBilling, type FinanceData } from "@/lib/erp-data";
import { daysOverdue } from "./ux-rules";

export const financeViews = ["Finance"];
type Tab = "Unbilled Services" | "Invoices" | "Payments" | "Storage Review" | "Client Statement" | "Rate Reference";

const confirmedRates = [
  ["Special preparation", "ETB 6,000 / metric ton"], ["Repeat processing", "75% of processing rate"], ["Double-bag / GreenPro", "ETB 500 / ton"], ["Machine blending", "ETB 1,000 / ton"], ["Manual blending", "ETB 1,500 / ton"], ["Off-line blending", "ETB 2,000 / ton"], ["Certified surcharge", "ETB 1,000 / ton"], ["Gravity-line processing", "ETB 2,000 / ton"], ["Carton packing", "ETB 2,500 / ton"], ["Vacuum packing", "ETB 1,000 / ton"], ["Bulk loading - 20 ft", "ETB 10,000"], ["Bulk loading - 40 ft", "ETB 16,000"], ["Sudan preparation", "ETB 250 / quintal"],
];

function Status({ value }: { value: string }) { return <span className={`status-pill ${value.toLowerCase().replaceAll("_", "-")}`}>{value.replaceAll("_", " ")}</span>; }
const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 7)}-01`;

export function FinanceOperations() {
  const [tab, setTab] = useState<Tab>("Unbilled Services");
  const [message, setMessage] = useState("");
  const [data, setData] = useState<FinanceData | null>(null);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedLotId, setSelectedLotId] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [serviceClientId, setServiceClientId] = useState("");
  const [serviceType, setServiceType] = useState("All");
  const [serviceFrom, setServiceFrom] = useState(monthStart);
  const [serviceTo, setServiceTo] = useState(today);
  const [category, setCategory] = useState<StorageCategory>("WAITING_PROCESSING");
  const [certified, setCertified] = useState(false);
  const [periodStart, setPeriodStart] = useState(monthStart);
  const [periodEnd, setPeriodEnd] = useState(today);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [bankReference, setBankReference] = useState("");

  async function reloadFinance() {
    try {
      const next = await loadFinanceData();
      const defaultInvoice = next.invoices[0];
      const defaultClientId = defaultInvoice?.client_id ?? next.clients.find((item) => item.active)?.id ?? "";
      setData(next);
      setSelectedClientId((current) => next.clients.some((item) => item.id === current) ? current : defaultClientId);
      setSelectedInvoiceId((current) => next.invoices.some((item) => item.id === current) ? current : defaultInvoice?.id ?? "");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Billing records could not be loaded."); }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reloadFinance(); }, []);

  const clients = data?.clients.filter((item) => item.active) ?? [];
  const clientById = new Map(clients.map((item) => [item.id, item.legal_name]));
  const serviceTypes = [...new Set((data?.serviceEvents ?? []).map((item) => item.service_type))].sort();
  const visibleServices = (data?.serviceEvents ?? []).filter((item) => !item.invoice_id && item.status === "UNBILLED" && (!serviceClientId || item.client_id === serviceClientId) && (serviceType === "All" || item.service_type === serviceType) && (!serviceFrom || item.created_at.slice(0, 10) >= serviceFrom) && (!serviceTo || item.created_at.slice(0, 10) <= serviceTo));
  const invoiceRows = (data?.invoices ?? []).map((invoice) => {
    const paid = (data?.payments ?? []).filter((payment) => payment.invoice_id === invoice.id).reduce((sum, payment) => sum + (payment.direction === "REVERSAL" ? -Number(payment.amount_etb) : Number(payment.amount_etb)), 0);
    return { invoice, paid, outstanding: Math.max(0, Number(invoice.total_etb) - paid), overdue: daysOverdue(invoice.due_on) };
  });
  const selectedInvoiceRow = invoiceRows.find((item) => item.invoice.id === selectedInvoiceId) ?? invoiceRows[0];
  const selectedClient = clients.find((item) => item.id === selectedClientId);
  const clientLots = data?.lots.filter((item) => item.client_id === selectedClientId && Number(item.quantity_kg) > 0) ?? [];
  const selectedLot = clientLots.find((item) => item.id === selectedLotId);
  const tariff = data?.tariffs.find((item) => item.active && item.verified_by_1 && item.verified_by_2 && item.verified_by_1 !== item.verified_by_2);
  const visibleTariff = tariff ?? data?.tariffs[0];
  const storage = (() => {
    if (!selectedClient || !selectedLot || !visibleTariff || periodStart > periodEnd) return null;
    try {
      return calculateStorage({ client: selectedClient.id, lot: selectedLot.id, category, receivedDate: selectedLot.received_at.slice(0, 10), periodStart, periodEnd, certified, tariffVersion: visibleTariff.version_code, movements: (data?.movements ?? []).filter((item) => item.lot_id === selectedLot.id).map((item) => ({ date: item.occurred_at.slice(0, 10), bagsDelta: item.bag_delta, reference: item.reference_type })) });
    } catch { return null; }
  })();
  const storagePosted = Boolean(storage && data?.storageRuns.some((item) => item.duplicate_key === storage.duplicateKey));
  const selectedInvoicePayments = data?.payments.filter((payment) => payment.invoice_id === selectedInvoiceRow?.invoice.id) ?? [];

  function selectClient(clientId: string) { setSelectedClientId(clientId); setSelectedLotId(""); }

  async function postStorage() {
    if (!storage || !selectedLot || !selectedClient || !visibleTariff) return;
    if (!tariff) { setMessage("Storage billing is disabled until the tariff has two independent verifications."); return; }
    try {
      const runId = await runStorageBilling({ clientId: selectedClient.id, lotId: selectedLot.id, category, periodStart, periodEnd, tariffVersion: visibleTariff.version_code, billableBagDays: storage.billableBagDays, totalAmount: storage.amount });
      await reloadFinance(); setMessage(`Storage billing run ${runId.slice(0, 8).toUpperCase()} posted.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Storage billing run failed."); }
  }

  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedInvoiceRow) return;
    try {
      allocatePayment(selectedInvoiceRow.outstanding, paymentAmount);
      await postPayment(selectedInvoiceRow.invoice.id, paymentAmount, bankReference.trim());
      await reloadFinance(); setPaymentAmount(0); setBankReference("");
      setMessage("Payment posted and allocated to the selected invoice.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Payment could not be posted."); }
  }

  return <div className="module-page finance-page">
    <section className="module-heading"><div><span className="demo-label">CLIENT BILLING</span><h1>Billing</h1><p>Review unbilled services, invoices, outstanding balances, and payments without interpreting stock-control codes.</p></div><div className="finance-balance"><WalletCards size={19} /><span>Outstanding<strong>ETB {invoiceRows.reduce((sum, item) => sum + item.outstanding, 0).toLocaleString()}</strong></span></div></section>
    {message && <div className="operation-message" role="status"><Check size={17} />{message}<button type="button" onClick={() => setMessage("")}>Close</button></div>}
    <div className="module-tabs billing-primary-tabs" role="tablist">{(["Unbilled Services", "Invoices", "Payments"] as Tab[]).map((item) => <button role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} type="button" key={item} onClick={() => setTab(item)}>{item}</button>)}<details><summary>More billing tools</summary><div>{(["Storage Review", "Client Statement", "Rate Reference"] as Tab[]).map((item) => <button className={tab === item ? "active" : ""} type="button" key={item} onClick={() => setTab(item)}>{item}</button>)}</div></details></div>

    {tab === "Unbilled Services" && <><section className="filter-toolbar"><label>From date<input type="date" value={serviceFrom} onChange={(event) => setServiceFrom(event.target.value)} /></label><label>To date<input type="date" min={serviceFrom} value={serviceTo} onChange={(event) => setServiceTo(event.target.value)} /></label><label>Client<select value={serviceClientId} onChange={(event) => setServiceClientId(event.target.value)}><option value="">All clients</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.legal_name}</option>)}</select></label><label>Service type<select value={serviceType} onChange={(event) => setServiceType(event.target.value)}><option>All</option>{serviceTypes.map((value) => <option key={value}>{value}</option>)}</select></label><button className="secondary-button" type="button" onClick={() => { setServiceFrom(""); setServiceTo(""); setServiceClientId(""); setServiceType("All"); }}>Reset</button></section><section className="record-panel"><div className="record-table unbilled-service-cols"><div className="table-head"><span>Date</span><span>Client</span><span>Service</span><span>Reference</span><span>Amount</span><span>Status</span></div>{visibleServices.map((item) => <div key={item.id}><span>{item.created_at.slice(0, 10)}</span><span>{clientById.get(item.client_id) ?? "Unknown client"}</span><span><strong>{item.service_type.replaceAll("_", " ")}</strong><small>{item.description}</small></span><span className="reference">{item.reference_id.slice(0, 8).toUpperCase()}</span><span>ETB {Number(item.total_amount).toLocaleString()}<small>{Number(item.quantity).toLocaleString()} x {Number(item.unit_price).toLocaleString()}</small></span><Status value={item.status} /></div>)}</div>{visibleServices.length === 0 && <p className="empty-result">No unbilled services match the selected filters.</p>}</section><div className="locked-action"><LockKeyhole size={16} /><span><strong>Invoice creation remains controlled</strong><small>Selecting and issuing service events stays disabled until verified tax mappings and invoice rules are confirmed.</small></span><button type="button" disabled>Create invoice</button></div></>}

    {tab === "Invoices" && <section className="record-panel"><div className="record-table invoice-workspace-cols"><div className="table-head"><span>Invoice</span><span>Client</span><span>Issue / due</span><span>Total</span><span>Paid</span><span>Outstanding</span><span>Status</span><span>Action</span></div>{invoiceRows.map((item) => <div key={item.invoice.id}><span className="reference">{item.invoice.invoice_number}</span><span>{clientById.get(item.invoice.client_id) ?? "Unknown client"}</span><span>{item.invoice.issued_on ?? "Draft"}<small>Due {item.invoice.due_on ?? "-"}{item.overdue > 0 && item.outstanding > 0 ? ` - ${item.overdue} days overdue` : ""}</small></span><span>ETB {Number(item.invoice.total_etb).toLocaleString()}</span><span>ETB {item.paid.toLocaleString()}</span><span><strong>ETB {item.outstanding.toLocaleString()}</strong></span><Status value={item.outstanding === 0 ? "PAID" : item.overdue > 0 ? "OVERDUE" : item.invoice.status} /><span><button className="table-action" type="button" disabled={item.outstanding === 0} onClick={() => { setSelectedInvoiceId(item.invoice.id); setPaymentAmount(item.outstanding); setTab("Payments"); }}>Record payment</button></span></div>)}</div>{invoiceRows.length === 0 && <p className="empty-result">No invoices are available.</p>}</section>}

    {tab === "Payments" && <div className="payment-layout"><form className="payment-form" onSubmit={recordPayment}><header><Banknote size={19} /><div><h2>Record payment</h2><p>Allocate one verified payment to one existing invoice.</p></div></header><label>Invoice<select required value={selectedInvoiceRow?.invoice.id ?? ""} onChange={(event) => { const row = invoiceRows.find((item) => item.invoice.id === event.target.value); setSelectedInvoiceId(event.target.value); setPaymentAmount(row?.outstanding ?? 0); }}><option value="" disabled>Select invoice</option>{invoiceRows.filter((item) => item.outstanding > 0).map((item) => <option key={item.invoice.id} value={item.invoice.id}>{item.invoice.invoice_number} - {clientById.get(item.invoice.client_id)} - ETB {item.outstanding.toLocaleString()}</option>)}</select></label><label>Amount (ETB)<input type="number" min="0.01" max={selectedInvoiceRow?.outstanding ?? 0} step="0.01" required value={paymentAmount || ""} onChange={(event) => setPaymentAmount(Number(event.target.value))} /></label><label>Bank reference<input required value={bankReference} onChange={(event) => setBankReference(event.target.value)} /></label><button className="primary-button" type="submit" disabled={!selectedInvoiceRow || selectedInvoiceRow.outstanding === 0}><Banknote size={16} />Post and allocate payment</button></form><section className="payment-summary"><h2>Invoice allocation</h2><div><span>Invoice</span><strong>{selectedInvoiceRow?.invoice.invoice_number ?? "-"}</strong></div><div><span>Invoice total</span><strong>ETB {Number(selectedInvoiceRow?.invoice.total_etb ?? 0).toLocaleString()}</strong></div><div><span>Allocated payments</span><strong>ETB {Number(selectedInvoiceRow?.paid ?? 0).toLocaleString()}</strong></div><div className="outstanding"><span>Outstanding</span><strong>ETB {Number(selectedInvoiceRow?.outstanding ?? 0).toLocaleString()}</strong></div></section></div>}

    {tab === "Storage Review" && <div className="storage-layout"><section className="storage-controls"><header><CalendarDays size={19} /><div><h2>Storage charge review</h2><p>{selectedLot ? `${selectedLot.lot_number} - ${selectedLot.bag_count} current bags` : "Select a client and lot"}</p></div></header><div className="control-fields"><label>Client<select value={selectedClientId} onChange={(event) => selectClient(event.target.value)}><option value="" disabled>Select client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.legal_name}</option>)}</select></label><label>Lot<select value={selectedLotId} onChange={(event) => setSelectedLotId(event.target.value)}><option value="" disabled>Select lot</option>{clientLots.map((lot) => <option key={lot.id} value={lot.id}>{lot.lot_number}</option>)}</select></label><label>Period start<input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label><label>Period end<input type="date" min={periodStart} value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label><label>Storage category<select value={category} onChange={(event) => setCategory(event.target.value as StorageCategory)}><option value="NO_PROCESSING">Stored without processing</option><option value="WAITING_PROCESSING">Waiting for processing</option><option value="PROCESSED_EXPORT">Processed export coffee</option><option value="GRADE_IMPROVEMENT">Grade-improvement coffee</option><option value="REJECT">Reject coffee</option><option value="EMPTY_BAGS">Empty bags</option></select></label><label className="inline-control"><input type="checkbox" checked={certified} onChange={(event) => setCertified(event.target.checked)} />Certified coffee</label></div><div className="storage-summary"><div><span>Billable bag-days</span><strong>{storage?.billableBagDays.toLocaleString() ?? "-"}</strong></div><div><span>Calculated amount</span><strong>ETB {storage?.amount.toLocaleString() ?? "-"}</strong></div></div><button className="primary-button" type="button" onClick={postStorage} disabled={!storage || !tariff || storagePosted}><FileCheck2 size={16} />{storagePosted ? "Billing run already posted" : tariff ? "Post storage run" : "Tariff verification required"}</button></section><section className="storage-explanation"><h2>Calculation explanation</h2><div className="storage-table"><div><span>Date</span><span>Opening</span><span>Movement</span><span>Closing</span><span>Age</span><span>Rate</span><span>Amount</span></div>{storage?.rows.filter((row) => row.movementBags !== 0 || row.rate > 0).slice(0, 12).map((row) => <div key={row.date}><span>{row.date.slice(5)}</span><span>{row.openingBags}</span><span>{row.movementBags || "-"}</span><span>{row.closingBags}</span><span>Day {row.ageDay}</span><span>ETB {row.rate}</span><span>{row.amount.toLocaleString()}</span></div>)}</div></section></div>}

    {tab === "Client Statement" && <section className="statement"><header><div><h2>{selectedInvoiceRow ? clientById.get(selectedInvoiceRow.invoice.client_id) : "Select invoice"}</h2><p>{selectedInvoiceRow ? `Invoice statement - ${selectedInvoiceRow.invoice.invoice_number}` : "No invoice selected"}</p></div><strong>Balance ETB {Number(selectedInvoiceRow?.outstanding ?? 0).toLocaleString()}</strong></header><div className="statement-table"><div><span>Date</span><span>Reference</span><span>Description</span><span>Debit</span><span>Credit</span><span>Balance</span></div>{selectedInvoiceRow && <div><span>{selectedInvoiceRow.invoice.issued_on ?? "-"}</span><span>{selectedInvoiceRow.invoice.invoice_number}</span><span>Warehouse services - immutable snapshot</span><span>{Number(selectedInvoiceRow.invoice.total_etb).toLocaleString()}</span><span>-</span><span>{Number(selectedInvoiceRow.invoice.total_etb).toLocaleString()}</span></div>}{selectedInvoicePayments.map((payment, index) => <div key={payment.id}><span>{payment.paid_at.slice(0, 10)}</span><span>{payment.payment_number}</span><span>Bank transfer - {payment.bank_reference}</span><span>-</span><span>{Number(payment.amount_etb).toLocaleString()}</span><span>{Math.max(0, Number(selectedInvoiceRow?.invoice.total_etb ?? 0) - selectedInvoicePayments.slice(0, index + 1).reduce((sum, row) => sum + Number(row.amount_etb), 0)).toLocaleString()}</span></div>)}</div></section>}

    {tab === "Rate Reference" && <><div className="tariff-warning"><AlertTriangle size={18} /><div><strong>{tariff ? `${tariff.version_code} independently verified` : "Rate posting is locked"}</strong><p>{tariff ? tariff.description ?? "Active rate agreement" : "Scanned tariff figures require two independent verifications before billing can post."}</p></div><ShieldCheck size={18} /></div><section className="tariff-grid">{confirmedRates.map(([service, rate]) => <article key={service}><ReceiptText size={18} /><span><strong>{service}</strong><small>{rate}</small></span></article>)}</section><div className="locked-action"><LockKeyhole size={16} /><span><strong>Tax and invoice issuance remain disabled</strong><small>No final tax mapping or automatic invoice rule has been invented in this UX pass.</small></span></div></>}
  </div>;
}
