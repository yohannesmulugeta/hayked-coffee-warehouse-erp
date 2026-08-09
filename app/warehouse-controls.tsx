"use client";

import { AlertTriangle, Archive, Banknote, Check, Droplets, Fuel, Plus, Printer, ShieldCheck, UsersRound } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { bagPrintingQuote, calculateLabourCharge, evaluateStorageLoss, generatorActualCost } from "./warehouse-control-rules";
import { loadWarehouseControlData, postBagPrintingOrder, postGeneratorRequest, postLabourEntry, type WarehouseControlData } from "@/lib/erp-data";

export const warehouseControlViews = ["Storage Loss", "Bag Control", "Labour", "Generator Requests"];

function Status({ value }: { value: string }) { return <span className={`status-pill ${value.toLowerCase().replaceAll("_", "-")}`}>{value.replaceAll("_", " ")}</span>; }
function Header({ label, title, copy }: { label: string; title: string; copy: string }) { return <section className="module-heading"><div><span className="demo-label">{label}</span><h1>{title}</h1><p>{copy}</p></div></section>; }

export function WarehouseControls({ activeView }: { activeView: string }) {
  const [message, setMessage] = useState("");
  const [databaseError, setDatabaseError] = useState("");
  const [data, setData] = useState<WarehouseControlData | null>(null);
  const [lossKg, setLossKg] = useState(192);
  const [wetCoffee, setWetCoffee] = useState(false);
  const [lossChecks, setLossChecks] = useState({ evidence: false, managerApproved: false, exceptionApproved: false, jointApprovalAttached: false });
  const [lossRecords] = useState([{ id: "LOS-2026-0003", lot: "HYK/GEL/2026/0031", loss: 126, percent: 1.0, status: "APPROVED" }]);
  const lossResult = useMemo(() => evaluateStorageLoss({ balanceKg: 19200, lossKg, wetCoffee, ...lossChecks }), [lossKg, wetCoffee, lossChecks]);

  const [printQuantity, setPrintQuantity] = useState(50);
  const printQuote = bagPrintingQuote(printQuantity);
  const [printClientId, setPrintClientId] = useState("");
  const [printLotId, setPrintLotId] = useState("");
  const [printApproverId, setPrintApproverId] = useState("");

  const [labourDate, setLabourDate] = useState(new Date().toISOString().slice(0, 10));
  const [labourClientId, setLabourClientId] = useState("");
  const [labourOrderId, setLabourOrderId] = useState("");
  const [labourLotId, setLabourLotId] = useState("");
  const [labourActivity, setLabourActivity] = useState("Bag handling");
  const [labourQuantity, setLabourQuantity] = useState(100);
  const [labourUnit, setLabourUnit] = useState("bags");
  const [labourInternal, setLabourInternal] = useState(750);
  const [labourNote, setLabourNote] = useState("");
  const [labourReference, setLabourReference] = useState("");

  const [dieselLitres, setDieselLitres] = useState(45);
  const [dieselUnitCost, setDieselUnitCost] = useState(128.5);
  const [generatorClientId, setGeneratorClientId] = useState("");
  const [generatorOrderId, setGeneratorOrderId] = useState("");
  const [generatorApproverId, setGeneratorApproverId] = useState("");
  const [generatorChecks, setGeneratorChecks] = useState({ receipt: false, supervisor: false, finance: false });
  const actualCost = generatorActualCost(dieselLitres, dieselUnitCost);

  async function reload() {
    try { setData(await loadWarehouseControlData()); setDatabaseError(""); }
    catch (error) { setData(null); setDatabaseError(error instanceof Error ? error.message : "Warehouse controls could not be loaded."); }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, []);

  const clients = data?.clients.filter((item) => item.active) ?? [];
  const clientById = new Map((data?.clients ?? []).map((item) => [item.id, item.legal_name]));
  const orderById = new Map((data?.processingOrders ?? []).map((item) => [item.id, item.order_number]));
  const approvers = data?.profiles.filter((item) => item.active && ["system_admin", "warehouse_manager", "finance_officer"].includes(item.role)) ?? [];
  const printLots = data?.lots.filter((item) => item.client_id === printClientId && Number(item.quantity_kg) > 0) ?? [];
  const generatorOrders = data?.processingOrders.filter((item) => item.client_id === generatorClientId && ["IN_PROCESS", "POSTED"].includes(item.status)) ?? [];
  const labourAddition = Number(data?.labourSettings.find((item) => item.active)?.fixed_addition_etb ?? 10);
  const labourCharge = calculateLabourCharge(labourInternal, labourAddition);
  const labourOrders = data?.processingOrders.filter((item) => item.client_id === labourClientId) ?? [];
  const labourLots = data?.lots.filter((item) => item.client_id === labourClientId && Number(item.quantity_kg) > 0) ?? [];

  function recordLoss(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lossResult.valid) { setMessage(lossResult.errors[0]); return; }
    setMessage("Not posted: select a real database lot and an independent manager approver before this control is enabled.");
  }

  async function createPrintOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!printQuote.valid) { setMessage("Bag printing requires at least 50 bags."); return; }
    if (!printClientId || !printApproverId) { setMessage("Select the client and independent approver."); return; }
    try {
      await postBagPrintingOrder({ clientId: printClientId, lotId: printLotId || null, quantity: printQuantity, approvedBy: printApproverId });
      await reload(); setMessage("Bag printing order posted and added to unbilled service events.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Bag printing order could not be posted."); }
  }

  async function addLabour(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!labourClientId || !labourCharge.valid) { setMessage("Select a client and enter a valid internal labour cost."); return; }
    try {
      const posted = await postLabourEntry({ clientId: labourClientId, workDate: labourDate, activity: labourActivity, quantity: labourQuantity, unitLabel: labourUnit, internalCostEtb: labourInternal, lotId: labourLotId || null, processingOrderId: labourOrderId || null, note: labourNote, externalReference: labourReference });
      await reload();
      setMessage(`${posted.labour_number} recorded. Internal cost ETB ${Number(posted.internal_cost_etb).toLocaleString()} and client service charge ETB ${Number(posted.client_charge_etb).toLocaleString()} remain separate.`);
      setLabourNote(""); setLabourReference("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Labour entry could not be recorded."); }
  }

  async function createGeneratorRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!generatorChecks.receipt || !generatorChecks.supervisor || !generatorChecks.finance) { setMessage("Supplier receipt, supervisor approval, and finance review are required."); return; }
    if (!generatorClientId || !generatorOrderId || !generatorApproverId) { setMessage("Select the client, processing order, and independent approver."); return; }
    try {
      await postGeneratorRequest({ clientId: generatorClientId, processingOrderId: generatorOrderId, dieselLitres, unitCost: dieselUnitCost, approvedBy: generatorApproverId });
      await reload(); setMessage("Generator recovery posted against the selected processing order.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Generator request could not be posted."); }
  }

  const notice = message && <div className="operation-message" role="status"><Check size={17} />{message}<button type="button" onClick={() => setMessage("")}>Close</button></div>;

  if (databaseError && !data) return <div className="module-page"><Header label="WAREHOUSE CONTROL" title={activeView} copy="Operational data must come from the warehouse database." /><section className="database-unavailable" role="alert"><AlertTriangle size={26} /><h2>Database unavailable</h2><p>Unable to load warehouse data. No demo values are being shown.</p><small>{databaseError}</small><button className="primary-button" type="button" onClick={() => void reload()}>Retry database connection</button></section></div>;

  if (activeView === "Storage Loss") return <div className="module-page"><Header label="SEPARATE CONTROL" title="Storage loss" copy="Evaporation and spillage during storage never consume processing allowance." />{notice}<div className="control-layout"><form className="control-form" onSubmit={recordLoss}><header><Droplets size={19} /><div><h2>New storage-loss record</h2><p>HYK/GEL/2026/0040 - measured balance 19,200 kg</p></div></header><div className="control-fields"><label>Measured loss (kg)<input type="number" min="0.01" max="19200" step="0.01" value={lossKg} onChange={(event) => setLossKg(Number(event.target.value))} /></label><label>Cause<select defaultValue="Evaporation"><option>Evaporation</option><option>Spillage</option><option>Other measured loss</option></select></label><label className="inline-control"><input type="checkbox" checked={wetCoffee} onChange={(event) => setWetCoffee(event.target.checked)} />Wet coffee</label></div><div className={`rule-result ${lossResult.aboveLimit ? "bad" : "good"}`}><span>Calculated storage loss</span><strong>{lossResult.percent.toFixed(2)}%</strong><small>Agreement limit: 1.50%</small></div><div className="control-checks"><label><input type="checkbox" checked={lossChecks.evidence} onChange={(event) => setLossChecks((value) => ({ ...value, evidence: event.target.checked }))} />Measurement evidence attached</label><label><input type="checkbox" checked={lossChecks.managerApproved} onChange={(event) => setLossChecks((value) => ({ ...value, managerApproved: event.target.checked }))} />Warehouse manager approval</label>{lossResult.aboveLimit && <label><input type="checkbox" checked={lossChecks.exceptionApproved} onChange={(event) => setLossChecks((value) => ({ ...value, exceptionApproved: event.target.checked }))} />Independent exception approval</label>}{lossResult.aboveLimit && wetCoffee && <label><input type="checkbox" checked={lossChecks.jointApprovalAttached} onChange={(event) => setLossChecks((value) => ({ ...value, jointApprovalAttached: event.target.checked }))} />Written joint approval attached</label>}</div>{lossResult.errors.length > 0 && <div className="control-errors">{lossResult.errors.map((error) => <p key={error}><AlertTriangle size={13} />{error}</p>)}</div>}<button className="primary-button" type="submit" disabled={!lossResult.valid}><ShieldCheck size={16} />Post storage loss</button></form><section className="control-list"><h2>Recent approvals</h2>{lossRecords.map((record) => <div key={record.id}><span><strong>{record.id}</strong><small>{record.lot}</small></span><span>{record.loss.toLocaleString()} kg<small>{record.percent.toFixed(2)}%</small></span><Status value={record.status} /></div>)}</section></div></div>;

  if (activeView === "Bag Control") return <div className="module-page"><Header label="SEPARATE LEDGER" title="Client-owned bags" copy="Bag ownership and movements remain separate from coffee stock." />{notice}<section className="bag-summary"><article><Archive size={19} /><span>Printing orders<strong>{data?.bagOrders.length ?? 0}</strong></span></article><article><UsersRound size={19} /><span>Active clients<strong>{clients.length}</strong></span></article><article><AlertTriangle size={19} /><span>Minimum order<strong>50</strong></span></article></section><div className="control-layout"><form className="control-form" onSubmit={createPrintOrder}><header><Printer size={19} /><div><h2>Bag printing order</h2><p>Minimum order: 50 bags</p></div></header><div className="control-fields"><label>Client<select required value={printClientId} onChange={(event) => { setPrintClientId(event.target.value); setPrintLotId(""); }}><option value="" disabled>Select client</option>{clients.map((item) => <option key={item.id} value={item.id}>{item.code} - {item.legal_name}</option>)}</select></label><label>Related lot (optional)<select value={printLotId} onChange={(event) => setPrintLotId(event.target.value)} disabled={!printClientId}><option value="">General client order</option>{printLots.map((item) => <option key={item.id} value={item.id}>{item.lot_number} - {Number(item.quantity_kg).toLocaleString()} kg</option>)}</select></label><label>Independent approver<select required value={printApproverId} onChange={(event) => setPrintApproverId(event.target.value)}><option value="" disabled>Select approver</option>{approvers.map((item) => <option key={item.id} value={item.id}>{item.full_name} - {item.role.replaceAll("_", " ")}</option>)}</select></label><label>Quantity<input type="number" min="50" step="1" value={printQuantity} onChange={(event) => setPrintQuantity(Number(event.target.value))} /></label></div><div className={`rule-result ${printQuote.valid ? "good" : "bad"}`}><span>Automatic tariff tier</span><strong>{printQuote.valid ? `ETB ${printQuote.rate.toFixed(2)} / bag` : "Below minimum"}</strong><small>{printQuote.valid ? `Total ETB ${printQuote.total.toLocaleString()}` : "Enter 50 bags or more"}</small></div><button className="primary-button" type="submit" disabled={!printQuote.valid || !printClientId || !printApproverId}><Plus size={16} />Create printing order</button></form><section className="control-list"><h2>Printing orders</h2>{(data?.bagOrders ?? []).map((order) => <div key={order.id}><span><strong>{order.order_number}</strong><small>{clientById.get(order.client_id) ?? "Unknown client"}</small></span><span>{order.quantity} bags<small>ETB {Number(order.total_amount).toLocaleString()}</small></span><Status value={order.status} /></div>)}</section></div></div>;

  if (activeView === "Labour") return <div className="module-page"><Header label="COST CONTROL" title="Labour entries" copy="Internal worker cost and the client-facing labour service charge are stored separately and frozen when recorded." />{notice}<div className="tariff-warning"><AlertTriangle size={18} /><div><strong>Configurable demo addition: ETB {labourAddition.toLocaleString()}</strong><p>This is the current demo default, not a confirmed production markup. New records copy it so historical charges remain stable.</p></div></div><div className="control-layout"><form className="control-form" onSubmit={addLabour}><header><UsersRound size={19} /><div><h2>Record labour activity</h2><p>Creates an internal cost record and one unbilled client service event.</p></div></header><div className="control-fields"><label>Work date<input type="date" max={new Date().toISOString().slice(0, 10)} value={labourDate} onChange={(event) => setLabourDate(event.target.value)} /></label><label>Client<select required value={labourClientId} onChange={(event) => { setLabourClientId(event.target.value); setLabourOrderId(""); setLabourLotId(""); }}><option value="" disabled>Select client</option>{clients.map((item) => <option key={item.id} value={item.id}>{item.code} - {item.legal_name}</option>)}</select></label><label>Activity<select value={labourActivity} onChange={(event) => setLabourActivity(event.target.value)}><option>Bag handling</option><option>Container loading</option><option>Warehouse transfer</option><option>Processing support</option><option>Dispatch handling</option></select></label><label>Related processing order<select value={labourOrderId} onChange={(event) => setLabourOrderId(event.target.value)} disabled={!labourClientId}><option value="">General warehouse activity</option>{labourOrders.map((item) => <option key={item.id} value={item.id}>{item.order_number} - {item.status.replaceAll("_", " ")}</option>)}</select></label><label>Related lot<select value={labourLotId} onChange={(event) => setLabourLotId(event.target.value)} disabled={!labourClientId}><option value="">No specific lot</option>{labourLots.map((item) => <option key={item.id} value={item.id}>{item.lot_number}</option>)}</select></label><label>Quantity<input type="number" min="0.001" step="0.001" value={labourQuantity} onChange={(event) => setLabourQuantity(Number(event.target.value))} /></label><label>Unit<input value={labourUnit} onChange={(event) => setLabourUnit(event.target.value)} placeholder="bags, hours, job" /></label><label>Internal labour cost (ETB)<input type="number" min="0" step="0.01" value={labourInternal} onChange={(event) => setLabourInternal(Number(event.target.value))} /></label><label>Evidence/reference<input value={labourReference} onChange={(event) => setLabourReference(event.target.value)} placeholder="Voucher or job reference" /></label><label className="wide">Note<textarea rows={2} value={labourNote} onChange={(event) => setLabourNote(event.target.value)} /></label></div><div className="labour-charge-preview"><div><span>Internal cost</span><strong>ETB {labourInternal.toLocaleString()}</strong></div><span>+</span><div><span>Configured addition</span><strong>ETB {labourAddition.toLocaleString()}</strong></div><span>=</span><div><span>Client labour charge</span><strong>ETB {labourCharge.clientChargeEtb.toLocaleString()}</strong></div></div><button className="primary-button" type="submit" disabled={!labourClientId || !labourCharge.valid}><Plus size={16} />Record labour and service event</button></form><section className="control-list labour-record-list"><h2>Recent labour entries</h2>{(data?.labourRecords ?? []).map((entry) => <div key={entry.id}><span><strong>{entry.labour_number}</strong><small>{entry.activity} - {clientById.get(entry.client_id) ?? "Unknown client"}</small></span><span>Internal ETB {Number(entry.internal_cost_etb).toLocaleString()}<small>Client charge ETB {Number(entry.client_charge_etb).toLocaleString()} · difference ETB {Number(entry.charge_addition_etb).toLocaleString()}</small></span><Status value={entry.service_event_id ? "UNBILLED" : "INCOMPLETE"} /></div>)}{!(data?.labourRecords.length) && <div className="empty-operation"><UsersRound size={20} /><strong>No labour entries</strong><small>Record the first warehouse labour activity.</small></div>}</section></div></div>;

  return <div className="module-page"><Header label="ACTUAL COST RECOVERY" title="Generator requests" copy="Only supported actual diesel cost is recoverable unless a signed rate applies." />{notice}<div className="control-layout"><form className="control-form" onSubmit={createGeneratorRequest}><header><Fuel size={19} /><div><h2>Generator cost review</h2><p>{orderById.get(generatorOrderId) ? `Linked to ${orderById.get(generatorOrderId)}` : "Select an active or completed processing order"}</p></div></header><div className="control-fields"><label>Client<select required value={generatorClientId} onChange={(event) => { setGeneratorClientId(event.target.value); setGeneratorOrderId(""); }}><option value="" disabled>Select client</option>{clients.map((item) => <option key={item.id} value={item.id}>{item.code} - {item.legal_name}</option>)}</select></label><label>Processing order<select required value={generatorOrderId} onChange={(event) => setGeneratorOrderId(event.target.value)} disabled={!generatorClientId}><option value="" disabled>Select processing order</option>{generatorOrders.map((item) => <option key={item.id} value={item.id}>{item.order_number} - {item.status.replaceAll("_", " ")}</option>)}</select></label><label>Independent approver<select required value={generatorApproverId} onChange={(event) => setGeneratorApproverId(event.target.value)}><option value="" disabled>Select approver</option>{approvers.map((item) => <option key={item.id} value={item.id}>{item.full_name} - {item.role.replaceAll("_", " ")}</option>)}</select></label><label>Diesel quantity (litres)<input type="number" min="0.01" step="0.01" value={dieselLitres} onChange={(event) => setDieselLitres(Number(event.target.value))} /></label><label>Unit cost (ETB)<input type="number" min="0.01" step="0.01" value={dieselUnitCost} onChange={(event) => setDieselUnitCost(Number(event.target.value))} /></label></div><div className="rule-result good"><span>Supported actual cost</span><strong>ETB {actualCost.toLocaleString()}</strong><small>No markup applied</small></div><div className="control-checks"><label><input type="checkbox" checked={generatorChecks.receipt} onChange={(event) => setGeneratorChecks((value) => ({ ...value, receipt: event.target.checked }))} />Supplier receipt attached</label><label><input type="checkbox" checked={generatorChecks.supervisor} onChange={(event) => setGeneratorChecks((value) => ({ ...value, supervisor: event.target.checked }))} />Supervisor approved</label><label><input type="checkbox" checked={generatorChecks.finance} onChange={(event) => setGeneratorChecks((value) => ({ ...value, finance: event.target.checked }))} />Finance reviewed</label></div><button className="primary-button" type="submit" disabled={!generatorClientId || !generatorOrderId || !generatorApproverId}><Banknote size={16} />Post actual cost</button></form><section className="control-list"><h2>Generator requests</h2>{(data?.generatorRequests ?? []).map((request) => <div key={request.id}><span><strong>{request.request_number}</strong><small>{clientById.get(request.client_id) ?? "Unknown client"} - {orderById.get(request.processing_order_id ?? "") ?? "Legacy request"}</small></span><span>{Number(request.diesel_litres).toLocaleString()} L<small>ETB {Number(request.total_cost).toLocaleString()}</small></span><Status value={request.status} /></div>)}</section></div></div>;
}
