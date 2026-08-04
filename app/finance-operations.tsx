"use client";

import { AlertTriangle, Banknote, CalendarDays, Check, FileCheck2, LockKeyhole, ReceiptText, ShieldCheck, WalletCards } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { allocatePayment, calculateStorage, invoiceSnapshot, type StorageCategory } from "./finance-rules";
import { loadFinanceData, recordPayment as postPayment, type InvoiceRow, type PaymentRow } from "@/lib/erp-data";

export const financeViews = ["Finance"];
const confirmedRates = [
  ["Special preparation", "ETB 6,000 / metric ton"], ["Repeat processing", "75% of processing rate"], ["Double-bag / GreenPro", "ETB 500 / ton"], ["Machine blending", "ETB 1,000 / ton"], ["Manual blending", "ETB 1,500 / ton"], ["Off-line blending", "ETB 2,000 / ton"], ["Certified surcharge", "ETB 1,000 / ton"], ["Gravity-line processing", "ETB 2,000 / ton"], ["Carton packing", "ETB 2,500 / ton"], ["Vacuum packing", "ETB 1,000 / ton"], ["Bulk loading - 20 ft", "ETB 10,000"], ["Bulk loading - 40 ft", "ETB 16,000"], ["Sudan preparation", "ETB 250 / quintal"],
];

function Status({ value }: { value: string }) { return <span className={`status-pill ${value.toLowerCase().replaceAll("_", "-")}`}>{value.replaceAll("_", " ")}</span>; }

export function FinanceOperations() {
  const [tab, setTab] = useState<"Tariffs" | "Storage billing" | "Invoices" | "Payments" | "Client statement">("Tariffs");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<StorageCategory>("WAITING_PROCESSING");
  const [certified, setCertified] = useState(false);
  const storage = useMemo(() => calculateStorage({ client: "Guji Specialty Coffee PLC", lot: "HYK/GEL/2026/0040", category, receivedDate: "2026-07-01", periodStart: "2026-07-01", periodEnd: "2026-07-31", certified, tariffVersion: "TV-001", movements: [{ date: "2026-07-01", bagsDelta: 320, reference: "GRN-2026-0040" }, { date: "2026-07-25", bagsDelta: -100, reference: "DSP-2026-0006" }] }), [category, certified]);
  const [storagePosted, setStoragePosted] = useState(false);

  const demoInvoice = invoiceSnapshot([{ description: "Receiving - demo snapshot", quantity: 320, unitPrice: 22 }, { description: "Storage - demo snapshot", quantity: 19200, unitPrice: .85 }, { description: "Processing - demo snapshot", quantity: 19200, unitPrice: 5.5 }, { description: "Rebagging - demo snapshot", quantity: 310, unitPrice: 40 }, { description: "Loading - demo snapshot", quantity: 310, unitPrice: 18 }, { description: "Dispatch handling - demo snapshot", quantity: 310, unitPrice: 20 }, { description: "Documentation - demo snapshot", quantity: 1, unitPrice: 1500 }], 0);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const invoiceRow = invoices[0];
  const invoice = invoiceRow ? { items: invoiceRow.line_snapshot.map((item) => ({ description: item.description, quantity: Number(item.quantity), unitPrice: Number(item.rate_etb), lineTotal: Number(item.quantity) * Number(item.rate_etb) })), subtotal: Number(invoiceRow.subtotal_etb), tax: Number(invoiceRow.tax_etb), total: Number(invoiceRow.total_etb) } : demoInvoice;
  const amountPaid = payments.filter((item) => !invoiceRow || item.invoice_id === invoiceRow.id).reduce((sum, item) => sum + (item.direction === "REVERSAL" ? -Number(item.amount_etb) : Number(item.amount_etb)), 0);
  const outstanding = invoice.total - amountPaid;
  const [paymentAmount, setPaymentAmount] = useState(50000);
  const [bankReference, setBankReference] = useState("CBE-TRX-20260801-1842");
  const [invoiceIssued, setInvoiceIssued] = useState(true);

  async function reloadFinance() {
    try {
      const data = await loadFinanceData();
      setInvoices(data.invoices);
      setPayments(data.payments);
      setInvoiceIssued(data.invoices[0]?.status !== "DRAFT");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Finance records could not be loaded.");
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reloadFinance(); }, []);

  function postStorage() { if (storagePosted) { setMessage("This client, lot, period, and tariff version has already been billed."); return; } setStoragePosted(true); setMessage(`Storage run posted for ETB ${storage.amount.toLocaleString()} with an immutable calculation key.`); }
  function issueInvoice() { setInvoiceIssued(true); setMessage("INV-2026-0018 issued with immutable line and rate snapshots."); }
  async function recordPayment(event: FormEvent<HTMLFormElement>) { event.preventDefault(); try { const next = allocatePayment(outstanding, paymentAmount); if (!invoiceRow) throw new Error("No issued invoice is available."); await postPayment(invoiceRow.id, paymentAmount, bankReference); await reloadFinance(); setMessage(`Payment allocated with bank reference ${bankReference}. Invoice outstanding is ETB ${next.toLocaleString()}.`); } catch (error) { setMessage(error instanceof Error ? error.message : "Payment allocation failed."); } }
  const notice = message && <div className="operation-message" role="status"><Check size={17} />{message}<button type="button" onClick={() => setMessage("")}>Close</button></div>;
  const statementPayments = [...payments].reverse().reduce<(PaymentRow & { balance: number })[]>((rows, payment) => {
    const previousBalance = rows.at(-1)?.balance ?? invoice.total;
    const amount = payment.direction === "REVERSAL" ? -Number(payment.amount_etb) : Number(payment.amount_etb);
    return [...rows, { ...payment, balance: previousBalance - amount }];
  }, []);

  return <div className="module-page finance-page"><section className="module-heading"><div><span className="demo-label">FINANCE AND CONTROL</span><h1>Warehouse finance</h1><p>Effective tariffs, transparent storage, immutable invoices, payments, and statements.</p></div><div className="finance-balance"><span>Client outstanding</span><strong>ETB {outstanding.toLocaleString()}</strong></div></section>{notice}<div className="module-tabs finance-tabs">{(["Tariffs", "Storage billing", "Invoices", "Payments", "Client statement"] as const).map((item) => <button className={tab === item ? "active" : ""} type="button" key={item} onClick={() => setTab(item)}>{item}</button>)}</div>
    {tab === "Tariffs" && <><section className="tariff-version"><div><ShieldCheck size={22} /><span><strong>Agreement 001/2018 - Initial ERP Import</strong><small>TV-001 - Effective-dated - Prices exclude VAT/TOT</small></span></div><Status value="AWAITING_VERIFICATION" /><button type="button" disabled><LockKeyhole size={15} />Production activation locked</button></section><div className="tariff-grid">{confirmedRates.map(([service, rate]) => <article key={service}><span>{service}</span><strong>{rate}</strong><small>Source: Agreement 001/2018 - verification required</small></article>)}</div><div className="tariff-warning"><AlertTriangle size={18} /><div><strong>OCR values remain inactive</strong><p>The processing matrix, 41 labour rates, and tax mappings require two-person source verification.</p></div></div></>}
    {tab === "Storage billing" && <div className="storage-layout"><section className="storage-controls"><header><CalendarDays size={19} /><div><h2>July 2026 storage review</h2><p>HYK/GEL/2026/0040 - 320 bags received, 100 partially dispatched</p></div></header><div className="control-fields"><label>Stock category<select value={category} onChange={(event) => setCategory(event.target.value as StorageCategory)}><option value="NO_PROCESSING">Stored without processing</option><option value="WAITING_PROCESSING">Waiting for processing</option><option value="PROCESSED_EXPORT">Processed export coffee</option><option value="GRADE_IMPROVEMENT">Grade-improvement coffee</option><option value="REJECT">Reject coffee</option><option value="EMPTY_BAGS">Empty bags</option></select></label><label className="inline-control"><input type="checkbox" checked={certified} onChange={(event) => setCertified(event.target.checked)} />Certified coffee</label></div><div className="storage-summary"><div><span>Billable bag-days</span><strong>{storage.billableBagDays.toLocaleString()}</strong></div><div><span>Calculated amount</span><strong>ETB {storage.amount.toLocaleString()}</strong></div></div><button className="primary-button" type="button" onClick={postStorage} disabled={storagePosted}><FileCheck2 size={16} />{storagePosted ? "Billing run posted" : "Post storage run"}</button><small className="duplicate-key">Duplicate key: {storage.duplicateKey}</small></section><section className="storage-explanation"><h2>Calculation explanation</h2><div className="storage-table"><div><span>Date</span><span>Opening</span><span>Movement</span><span>Closing</span><span>Age</span><span>Rate</span><span>Amount</span></div>{storage.rows.filter((row) => row.movementBags !== 0 || row.rate > 0).slice(0, 12).map((row) => <div key={row.date}><span>{row.date.slice(5)}</span><span>{row.openingBags}</span><span>{row.movementBags || "-"}</span><span>{row.closingBags}</span><span>Day {row.ageDay}</span><span>ETB {row.rate}</span><span>{row.amount.toLocaleString()}</span></div>)}</div></section></div>}
    {tab === "Invoices" && <div className="invoice-layout"><section className="invoice-document"><header><div><span className="demo-label">PERSISTENT SNAPSHOT</span><h2>{invoiceRow?.invoice_number ?? "No invoice"}</h2><p>Guji Specialty Coffee PLC - issued {invoiceRow?.issued_on ?? "-"}</p></div><Status value={invoiceRow?.status ?? (invoiceIssued ? "ISSUED" : "DRAFT")} /></header><div className="invoice-lines">{invoice.items.map((item) => <div key={item.description}><span>{item.description}</span><span>{item.quantity.toLocaleString()}</span><span>ETB {item.unitPrice.toLocaleString()}</span><strong>ETB {item.lineTotal.toLocaleString()}</strong></div>)}</div><dl><div><dt>Subtotal</dt><dd>ETB {invoice.subtotal.toLocaleString()}</dd></div><div><dt>Tax</dt><dd>ETB {invoice.tax.toLocaleString()}</dd></div><div className="invoice-total"><dt>Total</dt><dd>ETB {invoice.total.toLocaleString()}</dd></div></dl></section><aside className="invoice-actions"><ReceiptText size={24} /><h2>Immutable after issue</h2><p>Amounts, rates, tax, and source service events are frozen. Corrections require cancellation or reversal.</p><button className="primary-button" type="button" onClick={issueInvoice} disabled={invoiceIssued}><FileCheck2 size={16} />{invoiceIssued ? "Invoice issued" : "Issue invoice"}</button></aside></div>}
    {tab === "Payments" && <div className="payment-layout"><form className="payment-form" onSubmit={recordPayment}><header><WalletCards size={20} /><div><h2>Allocate payment</h2><p>{invoiceRow?.invoice_number ?? "No invoice"} - outstanding ETB {outstanding.toLocaleString()}</p></div></header><label>Payment amount (ETB)<input type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(Number(event.target.value))} /></label><label>Bank reference<input required value={bankReference} onChange={(event) => setBankReference(event.target.value)} /></label><button className="primary-button" type="submit" disabled={outstanding === 0}><Banknote size={16} />Post and allocate payment</button></form><section className="payment-summary"><h2>Invoice allocation</h2><div><span>Invoice total</span><strong>ETB {invoice.total.toLocaleString()}</strong></div><div><span>Allocated payments</span><strong>ETB {amountPaid.toLocaleString()}</strong></div><div className="outstanding"><span>Outstanding</span><strong>ETB {outstanding.toLocaleString()}</strong></div></section></div>}
    {tab === "Client statement" && <section className="statement"><header><div><h2>Guji Specialty Coffee PLC</h2><p>Client statement - ETB - through 01 Aug 2026</p></div><strong>Balance ETB {outstanding.toLocaleString()}</strong></header><div className="statement-table"><div><span>Date</span><span>Reference</span><span>Description</span><span>Debit</span><span>Credit</span><span>Balance</span></div><div><span>{invoiceRow?.issued_on ?? "-"}</span><span>{invoiceRow?.invoice_number ?? "-"}</span><span>Warehouse services - immutable snapshot</span><span>{invoice.total.toLocaleString()}</span><span>-</span><span>{invoice.total.toLocaleString()}</span></div>{statementPayments.map((payment) => <div key={payment.id}><span>{payment.paid_at.slice(0, 10)}</span><span>{payment.payment_number}</span><span>Bank transfer - {payment.bank_reference}</span><span>-</span><span>{Number(payment.amount_etb).toLocaleString()}</span><span>{payment.balance.toLocaleString()}</span></div>)}</div><footer><span>Statement rule</span><strong>Debit - Credit = ETB {outstanding.toLocaleString()}</strong></footer></section>}
  </div>;
}
