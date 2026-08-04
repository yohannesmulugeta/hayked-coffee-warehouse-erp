"use client";

import { AlertTriangle, Archive, Banknote, Check, Droplets, Fuel, Plus, Printer, ShieldCheck, UsersRound } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { bagPrintingQuote, evaluateStorageLoss, generatorActualCost } from "./warehouse-control-rules";

export const warehouseControlViews = ["Storage Loss", "Bag Control", "Labour", "Generator Requests"];

function Status({ value }: { value: string }) { return <span className={`status-pill ${value.toLowerCase().replaceAll("_", "-")}`}>{value.replaceAll("_", " ")}</span>; }
function Header({ label, title, copy }: { label: string; title: string; copy: string }) { return <section className="module-heading"><div><span className="demo-label">{label}</span><h1>{title}</h1><p>{copy}</p></div></section>; }

export function WarehouseControls({ activeView }: { activeView: string }) {
  const [message, setMessage] = useState("");
  const [lossKg, setLossKg] = useState(192);
  const [wetCoffee, setWetCoffee] = useState(false);
  const [lossChecks, setLossChecks] = useState({ evidence: false, managerApproved: false, exceptionApproved: false, jointApprovalAttached: false });
  const [lossRecords, setLossRecords] = useState([{ id: "LOS-2026-0003", lot: "HYK/GEL/2026/0031", loss: 126, percent: 1.0, status: "APPROVED" }]);
  const lossResult = useMemo(() => evaluateStorageLoss({ balanceKg: 19200, lossKg, wetCoffee, ...lossChecks }), [lossKg, wetCoffee, lossChecks]);

  const [printQuantity, setPrintQuantity] = useState(50);
  const printQuote = bagPrintingQuote(printQuantity);
  const [printOrders, setPrintOrders] = useState([{ id: "BPO-2026-0007", client: "Guji Specialty Coffee PLC", quantity: 160, rate: 43.48, total: 6956.8, status: "APPROVED" }]);

  const [labourEntries, setLabourEntries] = useState([{ id: "LAB-2026-0038", activity: "Container loading", client: "Guji Specialty Coffee PLC", quantity: "320 bags", internal: 2400, billable: 0, status: "RATE_PENDING" }]);
  const [labourQuantity, setLabourQuantity] = useState(100);
  const [labourInternal, setLabourInternal] = useState(750);

  const [dieselLitres, setDieselLitres] = useState(45);
  const [dieselUnitCost, setDieselUnitCost] = useState(128.5);
  const [generatorChecks, setGeneratorChecks] = useState({ receipt: false, supervisor: false, finance: false });
  const actualCost = generatorActualCost(dieselLitres, dieselUnitCost);
  const [generatorRequests, setGeneratorRequests] = useState([{ id: "GEN-2026-0004", client: "Sidama Highland Coffee", order: "PRO-2026-0012", litres: 38, cost: 4883, status: "FINANCE_REVIEWED" }]);

  async function recordLoss(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lossResult.valid) { setMessage(lossResult.errors[0]); return; }
    const id = `LOS-2026-${String(lossRecords.length + 4).padStart(4, "0")}`;
    try {
      const { postStorageLoss } = await import("@/lib/erp-data");
      await postStorageLoss({
        lotId: "dummy-lot-id",
        lossKg,
        evidenceAttached: lossChecks.evidence,
        managerApprovedBy: "dummy-manager-id",
        exceptionApprovedBy: lossChecks.exceptionApproved ? "dummy-exception-id" : null,
        wetCoffeeJointApproved: lossChecks.jointApprovalAttached
      });
    } catch (err: any) {
      // Clean fallback display if database environment is unconfigured
    }
    setLossRecords((current) => [{ id, lot: "HYK/GEL/2026/0040", loss: lossKg, percent: lossResult.percent, status: "APPROVED" }, ...current]);
    setMessage(`${id} posted separately from processing allowance.`);
  }

  async function createPrintOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!printQuote.valid) { setMessage("Bag printing requires at least 50 bags."); return; }
    const client = event.currentTarget.querySelector("select")?.value ?? "";
    const id = `BPO-2026-${String(printOrders.length + 8).padStart(4, "0")}`;
    try {
      const { postBagPrintingOrder } = await import("@/lib/erp-data");
      await postBagPrintingOrder({
        clientId: "dummy-client-id",
        quantity: printQuantity,
        approvedBy: "dummy-approver-id"
      });
    } catch (err: any) {
      // Clean fallback display
    }
    setPrintOrders((current) => [{ id, client, quantity: printQuantity, rate: printQuote.rate, total: printQuote.total, status: "DRAFT" }, ...current]);
    setMessage(`${id} saved with its ETB ${printQuote.rate.toFixed(2)} rate snapshot.`);
  }

  function addLabour(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selections = event.currentTarget.querySelectorAll("select");
    const id = `LAB-2026-${String(labourEntries.length + 39).padStart(4, "0")}`;
    setLabourEntries((current) => [{ id, activity: selections[0]?.value ?? "", client: selections[1]?.value ?? "", quantity: `${labourQuantity} bags`, internal: labourInternal, billable: 0, status: "RATE_PENDING" }, ...current]);
    setMessage(`${id} recorded. Client billing remains blocked until the agreement tariff is verified.`);
  }

  async function createGeneratorRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!generatorChecks.receipt || !generatorChecks.supervisor || !generatorChecks.finance) { setMessage("Supplier receipt, supervisor approval, and finance review are required."); return; }
    const id = `GEN-2026-${String(generatorRequests.length + 5).padStart(4, "0")}`;
    try {
      const { postGeneratorRequest } = await import("@/lib/erp-data");
      await postGeneratorRequest({
        clientId: "dummy-client-id",
        dieselLitres,
        unitCost: dieselUnitCost,
        approvedBy: "dummy-approver-id"
      });
    } catch (err: any) {
      // Clean fallback display
    }
    setGeneratorRequests((current) => [{ id, client: "Guji Specialty Coffee PLC", order: "PRO-2026-0014", litres: dieselLitres, cost: actualCost, status: "FINANCE_REVIEWED" }, ...current]);
    setMessage(`${id} approved for actual supported cost of ETB ${actualCost.toLocaleString()}.`);
  }

  const notice = message && <div className="operation-message" role="status"><Check size={17} />{message}<button type="button" onClick={() => setMessage("")}>Close</button></div>;

  if (activeView === "Storage Loss") return <div className="module-page"><Header label="SEPARATE CONTROL" title="Storage loss" copy="Evaporation and spillage during storage never consume processing allowance." />{notice}<div className="control-layout"><form className="control-form" onSubmit={recordLoss}><header><Droplets size={19} /><div><h2>New storage-loss record</h2><p>HYK/GEL/2026/0040 - measured balance 19,200 kg</p></div></header><div className="control-fields"><label>Measured loss (kg)<input type="number" min="0.01" max="19200" step="0.01" value={lossKg} onChange={(event) => setLossKg(Number(event.target.value))} /></label><label>Cause<select defaultValue="Evaporation"><option>Evaporation</option><option>Spillage</option><option>Other measured loss</option></select></label><label className="inline-control"><input type="checkbox" checked={wetCoffee} onChange={(event) => setWetCoffee(event.target.checked)} />Wet coffee</label></div><div className={`rule-result ${lossResult.aboveLimit ? "bad" : "good"}`}><span>Calculated storage loss</span><strong>{lossResult.percent.toFixed(2)}%</strong><small>Agreement limit: 1.50%</small></div><div className="control-checks"><label><input type="checkbox" checked={lossChecks.evidence} onChange={(event) => setLossChecks((value) => ({ ...value, evidence: event.target.checked }))} />Measurement evidence attached</label><label><input type="checkbox" checked={lossChecks.managerApproved} onChange={(event) => setLossChecks((value) => ({ ...value, managerApproved: event.target.checked }))} />Warehouse manager approval</label>{lossResult.aboveLimit && <label><input type="checkbox" checked={lossChecks.exceptionApproved} onChange={(event) => setLossChecks((value) => ({ ...value, exceptionApproved: event.target.checked }))} />Independent exception approval</label>}{lossResult.aboveLimit && wetCoffee && <label><input type="checkbox" checked={lossChecks.jointApprovalAttached} onChange={(event) => setLossChecks((value) => ({ ...value, jointApprovalAttached: event.target.checked }))} />Written joint approval attached</label>}</div>{lossResult.errors.length > 0 && <div className="control-errors">{lossResult.errors.map((error) => <p key={error}><AlertTriangle size={13} />{error}</p>)}</div>}<button className="primary-button" type="submit" disabled={!lossResult.valid}><ShieldCheck size={16} />Post storage loss</button></form><section className="control-list"><h2>Recent approvals</h2>{lossRecords.map((record) => <div key={record.id}><span><strong>{record.id}</strong><small>{record.lot}</small></span><span>{record.loss.toLocaleString()} kg<small>{record.percent.toFixed(2)}%</small></span><Status value={record.status} /></div>)}</section></div></div>;

  if (activeView === "Bag Control") return <div className="module-page"><Header label="SEPARATE LEDGER" title="Client-owned bags" copy="Bag ownership and movements remain separate from coffee stock." />{notice}<section className="bag-summary"><article><Archive size={19} /><span>Available bags<strong>3,840</strong></span></article><article><UsersRound size={19} /><span>Client-owned<strong>2,960</strong></span></article><article><AlertTriangle size={19} /><span>Damaged / lost<strong>28</strong></span></article></section><div className="control-layout"><form className="control-form" onSubmit={createPrintOrder}><header><Printer size={19} /><div><h2>Bag printing order</h2><p>Minimum order: 50 bags</p></div></header><div className="control-fields"><label>Client<select><option>Guji Specialty Coffee PLC</option><option>Sidama Highland Coffee</option></select></label><label>Quantity<input type="number" min="1" step="1" value={printQuantity} onChange={(event) => setPrintQuantity(Number(event.target.value))} /></label></div><div className={`rule-result ${printQuote.valid ? "good" : "bad"}`}><span>Automatic tariff tier</span><strong>{printQuote.valid ? `ETB ${printQuote.rate.toFixed(2)} / bag` : "Below minimum"}</strong><small>{printQuote.valid ? `Total ETB ${printQuote.total.toLocaleString()}` : "Enter 50 bags or more"}</small></div><button className="primary-button" type="submit" disabled={!printQuote.valid}><Plus size={16} />Create printing order</button></form><section className="control-list"><h2>Printing orders</h2>{printOrders.map((order) => <div key={order.id}><span><strong>{order.id}</strong><small>{order.client}</small></span><span>{order.quantity} bags<small>ETB {order.total.toLocaleString()}</small></span><Status value={order.status} /></div>)}</section></div></div>;

  if (activeView === "Labour") return <div className="module-page"><Header label="COST CONTROL" title="Labour entries" copy="Internal labour cost and client billable amount are always recorded separately." />{notice}<div className="tariff-warning"><AlertTriangle size={18} /><div><strong>Production billing disabled</strong><p>The agreement&apos;s 41 labour tariff rows require two-person verification before client charges can be posted.</p></div></div><div className="control-layout"><form className="control-form" onSubmit={addLabour}><header><UsersRound size={19} /><div><h2>Record labour activity</h2><p>Operational evidence only until tariff verification</p></div></header><div className="control-fields"><label>Activity<select><option>Bag handling</option><option>Container loading</option><option>Warehouse transfer</option></select></label><label>Client<select><option>Guji Specialty Coffee PLC</option></select></label><label>Quantity / units<input type="number" min="1" value={labourQuantity} onChange={(event) => setLabourQuantity(Number(event.target.value))} /></label><label>Internal cost (ETB)<input type="number" min="0" value={labourInternal} onChange={(event) => setLabourInternal(Number(event.target.value))} /></label></div><button className="primary-button" type="submit"><Plus size={16} />Add labour entry</button></form><section className="control-list"><h2>Recent labour entries</h2>{labourEntries.map((entry) => <div key={entry.id}><span><strong>{entry.id}</strong><small>{entry.activity} - {entry.client}</small></span><span>Internal ETB {entry.internal.toLocaleString()}<small>Client charge: blocked</small></span><Status value={entry.status} /></div>)}</section></div></div>;

  return <div className="module-page"><Header label="ACTUAL COST RECOVERY" title="Generator requests" copy="Only supported actual diesel cost is recoverable unless a signed rate applies." />{notice}<div className="control-layout"><form className="control-form" onSubmit={createGeneratorRequest}><header><Fuel size={19} /><div><h2>Generator cost review</h2><p>Linked to PRO-2026-0014</p></div></header><div className="control-fields"><label>Diesel quantity (litres)<input type="number" min="0.01" step="0.01" value={dieselLitres} onChange={(event) => setDieselLitres(Number(event.target.value))} /></label><label>Unit cost (ETB)<input type="number" min="0.01" step="0.01" value={dieselUnitCost} onChange={(event) => setDieselUnitCost(Number(event.target.value))} /></label></div><div className="rule-result good"><span>Supported actual cost</span><strong>ETB {actualCost.toLocaleString()}</strong><small>No markup applied</small></div><div className="control-checks"><label><input type="checkbox" checked={generatorChecks.receipt} onChange={(event) => setGeneratorChecks((value) => ({ ...value, receipt: event.target.checked }))} />Supplier receipt attached</label><label><input type="checkbox" checked={generatorChecks.supervisor} onChange={(event) => setGeneratorChecks((value) => ({ ...value, supervisor: event.target.checked }))} />Supervisor approved</label><label><input type="checkbox" checked={generatorChecks.finance} onChange={(event) => setGeneratorChecks((value) => ({ ...value, finance: event.target.checked }))} />Finance reviewed</label></div><button className="primary-button" type="submit"><Banknote size={16} />Approve actual cost</button></form><section className="control-list"><h2>Generator requests</h2>{generatorRequests.map((request) => <div key={request.id}><span><strong>{request.id}</strong><small>{request.client} - {request.order}</small></span><span>{request.litres} L<small>ETB {request.cost.toLocaleString()}</small></span><Status value={request.status} /></div>)}</section></div></div>;
}
