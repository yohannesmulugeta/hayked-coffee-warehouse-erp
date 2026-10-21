"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  decideEmptyBagChange,
  loadEmptyBagClient,
  loadEmptyBagSetup,
  loadEmptyBagStatement,
  submitEmptyBagMovement,
  type EmptyBagBalance,
  type EmptyBagChangeRequest,
  type EmptyBagCondition,
  type EmptyBagEvent,
  type EmptyBagEventType,
  type EmptyBagStatementDay,
} from "@/lib/empty-bags";

const movementLabels: Record<EmptyBagEventType, string> = {
  RECEIPT: "Receive empty bags",
  ISSUE: "Issue for use or collection",
  RETURN: "Return unused bags to storage",
  TRANSFER: "Move to another location",
  RECLASSIFY: "Change condition",
  ADJUST_IN: "Approved count increase",
  ADJUST_OUT: "Approved count decrease",
};
const movementTypes = Object.keys(movementLabels) as EmptyBagEventType[];
const sourceTypes: EmptyBagEventType[] = ["ISSUE", "TRANSFER", "RECLASSIFY", "ADJUST_OUT"];
const destinationTypes: EmptyBagEventType[] = ["RECEIPT", "RETURN", "TRANSFER", "RECLASSIFY", "ADJUST_IN"];
const approvalTypes: EmptyBagEventType[] = ["RECLASSIFY", "ADJUST_IN", "ADJUST_OUT"];

type Setup = Awaited<ReturnType<typeof loadEmptyBagSetup>>;

function businessToday() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Addis_Ababa", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = (name: string) => parts.find((part) => part.type === name)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function statementStart() {
  const date = new Date(`${businessToday()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 29);
  return date.toISOString().slice(0, 10);
}

export function EmptyBagControl() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [clientId, setClientId] = useState("");
  const [balances, setBalances] = useState<EmptyBagBalance[]>([]);
  const [events, setEvents] = useState<EmptyBagEvent[]>([]);
  const [requests, setRequests] = useState<EmptyBagChangeRequest[]>([]);
  const [statement, setStatement] = useState<EmptyBagStatementDay[] | null>(null);
  const [statementFrom, setStatementFrom] = useState(statementStart);
  const [statementTo, setStatementTo] = useState(businessToday);
  const [statementBusy, setStatementBusy] = useState(false);
  const [eventType, setEventType] = useState<EmptyBagEventType>("RECEIPT");
  const [sourceIndex, setSourceIndex] = useState("");
  const [bagType, setBagType] = useState("JUTE");
  const [quantity, setQuantity] = useState("");
  const [businessDate, setBusinessDate] = useState(businessToday);
  const [reference, setReference] = useState("");
  const [destinationWarehouseId, setDestinationWarehouseId] = useState("");
  const [destinationLocation, setDestinationLocation] = useState("");
  const [destinationCondition, setDestinationCondition] = useState<EmptyBagCondition>("USABLE");
  const [reason, setReason] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [reviewingId, setReviewingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void loadEmptyBagSetup().then((value) => {
      if (active) setSetup(value);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Bag custody could not be loaded.");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    void loadEmptyBagClient(clientId).then((value) => {
      if (!active) return;
      setBalances(value.balances);
      setEvents(value.events);
      setRequests(value.requests);
      setError("");
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Client bags could not be loaded.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [clientId]);

  const needsSource = sourceTypes.includes(eventType);
  const needsDestination = destinationTypes.includes(eventType);
  const needsApproval = approvalTypes.includes(eventType);
  const source = sourceIndex === "" ? null : balances[Number(sourceIndex)] ?? null;
  const warehouseName = (id: string | null) => setup?.warehouses.find((row) => row.id === id)?.name ?? "Warehouse";
  const total = balances.reduce((sum, row) => sum + Number(row.bag_count), 0);
  const usable = balances.filter((row) => row.condition === "USABLE")
    .reduce((sum, row) => sum + Number(row.bag_count), 0);
  const canPost = setup && ["system_admin", "warehouse_manager", "warehouse_officer"].includes(setup.role);
  const canReview = setup && ["system_admin", "warehouse_manager"].includes(setup.role);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const count = Number(quantity);
    if (!clientId || !Number.isSafeInteger(count) || count <= 0 || (needsSource && !source)) {
      setError("Select a client and source balance, then enter a positive whole number of bags.");
      return;
    }
    setBusy(true);
    try {
      const saved = await submitEmptyBagMovement({
        clientId,
        eventType,
        bagType: source?.bag_type ?? bagType,
        quantity: count,
        businessDate,
        documentReference: reference,
        sourceWarehouseId: source?.warehouse_id,
        sourceLocation: source?.location_code,
        sourceCondition: source?.condition,
        destinationWarehouseId: eventType === "RECLASSIFY" ? source?.warehouse_id : needsDestination ? destinationWarehouseId : undefined,
        destinationLocation: eventType === "RECLASSIFY" ? source?.location_code : needsDestination ? destinationLocation : undefined,
        destinationCondition: eventType === "TRANSFER" ? source?.condition : needsDestination ? destinationCondition : undefined,
        reason,
      });
      const updated = await loadEmptyBagClient(clientId);
      setBalances(updated.balances);
      setEvents(updated.events);
      setRequests(updated.requests);
      setStatement(null);
      setSourceIndex("");
      setQuantity("");
      setReference("");
      setReason("");
      setMessage(saved.pending
        ? "Change requested. The bag balance will update after a different manager approves it."
        : `${movementLabels[eventType]} recorded.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Bag movement could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(requestId: string, approve: boolean) {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await decideEmptyBagChange(requestId, approve, decisionNote);
      const updated = await loadEmptyBagClient(clientId);
      setBalances(updated.balances);
      setEvents(updated.events);
      setRequests(updated.requests);
      setStatement(null);
      setReviewingId("");
      setDecisionNote("");
      setMessage(approve ? "Manager approved the change and the balance was updated." : "Change request rejected; no balance changed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request could not be decided.");
    } finally {
      setBusy(false);
    }
  }

  async function showStatement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientId) return;
    setStatementBusy(true);
    setError("");
    try {
      setStatement(await loadEmptyBagStatement(clientId, statementFrom, statementTo));
    } catch (cause) {
      setStatement(null);
      setError(cause instanceof Error ? cause.message : "The custody statement could not be loaded.");
    } finally {
      setStatementBusy(false);
    }
  }

  return (
    <section className="empty-bag-workspace" aria-label="Empty client-owned bag custody">
      <header className="empty-bag-workspace-heading">
        <div>
          <h2>Empty-bag storage</h2>
          <p>Record client-owned bags by warehouse, location and condition. Use a delivery note or job reference for every movement.</p>
        </div>
        <span className="status-pill">Custody ledger</span>
      </header>
      <p className="billing-notice">Record client-owned empty bags when they enter, move within, or leave the warehouse. Include the movement date, location, condition, and supporting reference. Bag printing orders are managed separately.</p>
      {error && <p className="request-form-error" role="alert">{error}</p>}
      {message && <p className="form-message" role="status">{message}</p>}
      <label className="empty-bag-client-picker">
        Client
        <select value={clientId} onChange={(event) => {
          setClientId(event.target.value);
          setSourceIndex("");
          setBalances([]);
          setEvents([]);
          setRequests([]);
          setStatement(null);
          setMessage("");
        }}>
          <option value="">Select client to view bags</option>
          {(setup?.clients ?? []).map((client) => <option key={client.id} value={client.id}>{client.code} - {client.legal_name}</option>)}
        </select>
      </label>
      {clientId && <>
        <div className="bag-summary" aria-label="Empty bag balances">
          <article><span>Total stored<strong>{total.toLocaleString()} bags</strong></span></article>
          <article><span>Usable<strong>{usable.toLocaleString()} bags</strong></span></article>
          <article><span>Held or damaged<strong>{(total - usable).toLocaleString()} bags</strong></span></article>
        </div>
        <div className="control-layout">
          {canPost && <form className="control-form" onSubmit={submit}>
            <header><div><h2>Record bag movement</h2><p>Count actual empty bags. Coffee-lot bags are recorded elsewhere.</p></div></header>
            <div className="control-fields">
              <label>Activity
                <select value={eventType} onChange={(event) => {
                  setEventType(event.target.value as EmptyBagEventType);
                  setSourceIndex("");
                }}>
                  {movementTypes.map((type) => <option key={type} value={type}>{movementLabels[type]}</option>)}
                </select>
              </label>
              {needsSource ? <label>Available bags at source
                <select required value={sourceIndex} onChange={(event) => {
                  setSourceIndex(event.target.value);
                  const selected = event.target.value === "" ? null : balances[Number(event.target.value)];
                  if (selected && eventType === "RECLASSIFY") {
                    setDestinationCondition(selected.condition === "USABLE" ? "DAMAGED" : "USABLE");
                  }
                }}>
                  <option value="">Select a recorded balance</option>
                  {balances.map((row, index) => <option key={`${row.warehouse_id}-${row.location_code}-${row.bag_type}-${row.condition}`} value={index}>
                    {warehouseName(row.warehouse_id)} / {row.location_code} - {row.bag_type}, {row.condition.toLowerCase()} ({row.bag_count} bags)
                  </option>)}
                </select>
              </label> : <label>Bag type
                <input required maxLength={80} value={bagType} onChange={(event) => setBagType(event.target.value)} placeholder="Example: JUTE" />
              </label>}
              {needsDestination && eventType !== "RECLASSIFY" && <>
                <label>Destination warehouse
                  <select required value={destinationWarehouseId} onChange={(event) => setDestinationWarehouseId(event.target.value)}>
                    <option value="">Select warehouse</option>
                    {(setup?.warehouses ?? []).map((row) => <option key={row.id} value={row.id}>{row.code} - {row.name}</option>)}
                  </select>
                </label>
                <label>Storage location
                  <input required maxLength={80} value={destinationLocation} onChange={(event) => setDestinationLocation(event.target.value)} placeholder="Example: W4-A03" />
                </label>
              </>}
              {needsDestination && eventType !== "TRANSFER" && <label>Condition
                <select value={destinationCondition} onChange={(event) => setDestinationCondition(event.target.value as EmptyBagCondition)}>
                  <option value="USABLE">Usable</option>
                  <option value="HELD">Held for review</option>
                  <option value="DAMAGED">Damaged</option>
                </select>
              </label>}
              <label>Number of bags
                <input required type="number" min="1" step="1" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="Example: 250" />
              </label>
              <label>Movement date
                <input required type="date" max={businessToday()} value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} />
              </label>
              <label>Document or job reference
                <input required maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Example: DELIVERY-2026-014" />
              </label>
              {needsApproval && <>
                <label>Reason for correction
                  <input required minLength={5} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Example: Physical count confirmed 10 additional bags" />
                </label>
              </>}
            </div>
            <button className="primary-button" type="submit" disabled={busy || loading || !clientId}>
              {busy ? "Saving..." : needsApproval ? "Request manager review" : "Record movement"}
            </button>
          </form>}
          <section className="control-list" aria-label="Current empty bag balances">
            <h2>Current storage balance</h2>
            {loading && <p>Loading client bags...</p>}
            {!loading && balances.length === 0 && <p>No empty bags recorded for this client. Start with an actual receipt or an approved opening count.</p>}
            {!loading && balances.map((row) => <div key={`${row.warehouse_id}-${row.location_code}-${row.bag_type}-${row.condition}`}>
              <span><strong>{warehouseName(row.warehouse_id)} / {row.location_code}</strong><small>{row.bag_type} - {row.condition.toLowerCase()}</small></span>
              <strong>{Number(row.bag_count).toLocaleString()} bags</strong>
            </div>)}
          </section>
        </div>
        <section className="control-list empty-bag-history" aria-label="Pending empty bag corrections">
          <h2>Pending count and condition changes</h2>
          {requests.length === 0 && !loading && <p>No changes are waiting for manager review.</p>}
          {requests.map((row) => <div key={row.id}>
            <span><strong>{movementLabels[row.event_type]}</strong><small>{row.business_date} · {row.document_reference}</small><small>{row.reason}</small></span>
            <span>{row.quantity.toLocaleString()} {row.bag_type} bags
              {canReview && row.requested_by !== setup.userId && <span className="empty-bag-review-actions">
                {reviewingId === row.id && <label>Reason if rejecting<input value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="Explain the rejection" /></label>}
                <button type="button" className="secondary-button" disabled={busy} onClick={() => { setReviewingId(row.id); void decide(row.id, true); }}>Approve</button>
                {reviewingId === row.id
                  ? <button type="button" className="secondary-button" disabled={busy || decisionNote.trim().length < 5} onClick={() => void decide(row.id, false)}>Reject</button>
                  : <button type="button" className="secondary-button" onClick={() => { setReviewingId(row.id); setDecisionNote(""); }}>Review</button>}
              </span>}
              {row.requested_by === setup?.userId && <small>Waiting for another manager</small>}
            </span>
          </div>)}
        </section>
        <section className="control-list empty-bag-history" aria-label="Recent empty bag movements">
          <h2>Recent movements</h2>
          {events.length === 0 && !loading && <p>No movements recorded for this client.</p>}
          {events.map((row) => <div key={row.id}>
            <span><strong>{movementLabels[row.event_type]}</strong><small>{row.business_date} · {row.document_reference}</small></span>
            <span>{row.quantity.toLocaleString()} {row.bag_type} bags<small>{row.source_location ? `${warehouseName(row.source_warehouse_id)} / ${row.source_location}` : ""}{row.destination_location ? ` → ${warehouseName(row.destination_warehouse_id)} / ${row.destination_location}` : ""}</small></span>
          </div>)}
        </section>
        <section className="empty-bag-statement" aria-label="Daily empty bag custody statement">
          <header><h2>Daily custody statement</h2><p>Opening, change and closing bag counts across all locations and conditions. Charges are calculated separately after rate approval.</p></header>
          <form onSubmit={showStatement}>
            <label>From<input required type="date" max={statementTo} value={statementFrom} onChange={(event) => { setStatementFrom(event.target.value); setStatement(null); }} /></label>
            <label>To<input required type="date" min={statementFrom} max={businessToday()} value={statementTo} onChange={(event) => { setStatementTo(event.target.value); setStatement(null); }} /></label>
            <button className="secondary-button" type="submit" disabled={statementBusy || loading}>{statementBusy ? "Loading..." : "Show statement"}</button>
          </form>
          {statement && <div className="billing-calculation-scroll"><table>
            <thead><tr><th>Date</th><th>Opening</th><th>Change</th><th>Closing</th><th>Document references</th></tr></thead>
            <tbody>{statement.map((day) => <tr key={day.business_date}>
              <td>{day.business_date}</td>
              <td>{day.opening_bags.toLocaleString()}</td>
              <td>{day.movement_bags > 0 ? "+" : ""}{day.movement_bags.toLocaleString()}</td>
              <td>{day.closing_bags.toLocaleString()}</td>
              <td>{day.document_references.join(", ") || "—"}</td>
            </tr>)}</tbody>
          </table></div>}
        </section>
      </>}
    </section>
  );
}
