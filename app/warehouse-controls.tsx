"use client";

import {
  AlertTriangle,
  Archive,
  Banknote,
  Check,
  Droplets,
  Fuel,
  Plus,
  Printer,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  bagPrintingQuote,
  calculateLabourCharge,
  evaluateStorageLoss,
  generatorActualCost,
} from "./warehouse-control-rules";
import {
  loadWarehouseControlData,
  postBagPrintingOrder,
  postGeneratorRequest,
  postLabourEntry,
  postManualService,
  postStorageLoss,
  type WarehouseControlData,
} from "@/lib/erp-data";
import { EvidenceUploader } from "./workflow-ui";

export const warehouseControlViews = [
  "Storage Loss",
  "Bag Control",
  "Labour",
  "Generator Requests",
];

function Status({ value }: { value: string }) {
  return (
    <span className={`status-pill ${value.toLowerCase().replaceAll("_", "-")}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}
function Header({
  label,
  title,
  copy,
  onReports,
}: {
  label: string;
  title: string;
  copy: string;
  onReports?: () => void;
}) {
  return (
    <section className="module-heading">
      <div>
        <span className="demo-label">{label}</span>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
      {onReports && (
        <button className="secondary-button" type="button" onClick={onReports}>
          View in Reports
        </button>
      )}
    </section>
  );
}

export function WarehouseControls({
  activeView,
  onNavigate,
}: {
  activeView: string;
  onNavigate?: (intent: { view: string }) => void;
}) {
  const [message, setMessage] = useState("");
  const [databaseError, setDatabaseError] = useState("");
  const [data, setData] = useState<WarehouseControlData | null>(null);
  const [lastEvidence, setLastEvidence] = useState<{
    type: string;
    id: string;
    label: string;
    documentType: string;
    title: string;
  } | null>(null);
  const [lossClientId, setLossClientId] = useState("");
  const [lossLotId, setLossLotId] = useState("");
  const [measuredQuantity, setMeasuredQuantity] = useState(0);
  const [lossCause, setLossCause] = useState("Evaporation");
  const [lossManagerId, setLossManagerId] = useState("");
  const [lossExceptionApproverId, setLossExceptionApproverId] = useState("");
  const [wetCoffee, setWetCoffee] = useState(false);
  const [lossChecks, setLossChecks] = useState({
    evidence: false,
    jointApprovalAttached: false,
  });

  const [printQuantity, setPrintQuantity] = useState(50);
  const printQuote = bagPrintingQuote(printQuantity);
  const [printClientId, setPrintClientId] = useState("");
  const [printLotId, setPrintLotId] = useState("");
  const [printApproverId, setPrintApproverId] = useState("");

  const [labourDate, setLabourDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [labourClientId, setLabourClientId] = useState("");
  const [labourOrderId, setLabourOrderId] = useState("");
  const [labourLotId, setLabourLotId] = useState("");
  const [labourActivity, setLabourActivity] = useState("Bag handling");
  const [labourQuantity, setLabourQuantity] = useState(100);
  const [labourUnit, setLabourUnit] = useState("bags");
  const [labourInternal, setLabourInternal] = useState(750);
  const [labourNote, setLabourNote] = useState("");
  const [labourReference, setLabourReference] = useState("");

  const [manualClientId, setManualClientId] = useState("");
  const [manualOrderId, setManualOrderId] = useState("");
  const [manualServiceCode, setManualServiceCode] = useState("PROCESSING");
  const [manualServiceDate, setManualServiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [manualDescription, setManualDescription] = useState("");
  const [manualQuantity, setManualQuantity] = useState(1);
  const [manualUnit, setManualUnit] = useState("kg");
  const [manualUnitPrice, setManualUnitPrice] = useState(0);
  const [manualApproverId, setManualApproverId] = useState("");
  const [manualEvidenceReference, setManualEvidenceReference] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualBusy, setManualBusy] = useState(false);

  const [dieselLitres, setDieselLitres] = useState(45);
  const [dieselUnitCost, setDieselUnitCost] = useState(128.5);
  const [generatorClientId, setGeneratorClientId] = useState("");
  const [generatorOrderId, setGeneratorOrderId] = useState("");
  const [generatorApproverId, setGeneratorApproverId] = useState("");
  const [generatorChecks, setGeneratorChecks] = useState({
    receipt: false,
    supervisor: false,
    finance: false,
  });
  const actualCost = generatorActualCost(dieselLitres, dieselUnitCost);

  async function reload() {
    try {
      setData(await loadWarehouseControlData());
      setDatabaseError("");
    } catch (error) {
      setData(null);
      setDatabaseError(
        error instanceof Error
          ? error.message
          : "Warehouse controls could not be loaded.",
      );
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, []);

  const clients = data?.clients.filter((item) => item.active) ?? [];
  const clientById = new Map(
    (data?.clients ?? []).map((item) => [item.id, item.legal_name]),
  );
  const orderById = new Map(
    (data?.processingOrders ?? []).map((item) => [item.id, item.order_number]),
  );
  const approvers =
    data?.profiles.filter(
      (item) =>
        item.active &&
        item.id !== data?.currentUserId &&
        ["system_admin", "warehouse_manager", "finance_officer"].includes(
          item.role,
        ),
    ) ?? [];
  const manualOrders = data?.processingOrders.filter((item) => item.client_id === manualClientId && item.status === "POSTED") ?? [];
  const manualNeedsProcessingOrder = ["PROCESSING", "HULLING", "CLEANING"].includes(manualServiceCode);
  const lossLots =
    data?.lots.filter(
      (item) =>
        item.client_id === lossClientId &&
        Number(item.quantity_kg) > 0 &&
        !["CLOSED", "DISPATCHED", "REVERSED"].includes(item.status),
    ) ?? [];
  const selectedLossLot = lossLots.find((item) => item.id === lossLotId);
  const systemQuantity = Number(selectedLossLot?.quantity_kg ?? 0);
  const lossKg = Math.max(0, systemQuantity - measuredQuantity);
  const lossResult = useMemo(
    () =>
      evaluateStorageLoss({
        balanceKg: systemQuantity,
        lossKg,
        wetCoffee,
        evidence: lossChecks.evidence,
        managerApproved: Boolean(lossManagerId),
        exceptionApproved: Boolean(lossExceptionApproverId),
        jointApprovalAttached: lossChecks.jointApprovalAttached,
      }),
    [
      lossChecks,
      lossExceptionApproverId,
      lossKg,
      lossManagerId,
      systemQuantity,
      wetCoffee,
    ],
  );
  const printLots =
    data?.lots.filter(
      (item) =>
        item.client_id === printClientId && Number(item.quantity_kg) > 0,
    ) ?? [];
  const generatorOrders =
    data?.processingOrders.filter(
      (item) =>
        item.client_id === generatorClientId &&
        ["IN_PROCESS", "POSTED"].includes(item.status),
    ) ?? [];
  const labourAddition = Number(
    data?.labourSettings.find((item) => item.active)?.fixed_addition_etb ?? 10,
  );
  const labourCharge = calculateLabourCharge(labourInternal, labourAddition);
  const labourOrders =
    data?.processingOrders.filter(
      (item) => item.client_id === labourClientId,
    ) ?? [];
  const labourLots =
    data?.lots.filter(
      (item) =>
        item.client_id === labourClientId && Number(item.quantity_kg) > 0,
    ) ?? [];

  async function recordLoss(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lossClientId || !lossLotId || !lossManagerId) {
      setMessage(
        "Select the client, coffee lot, physical measurement, and independent manager approver.",
      );
      return;
    }
    if (!lossResult.valid) {
      setMessage(lossResult.errors[0]);
      return;
    }
    try {
      const id = await postStorageLoss({
        lotId: lossLotId,
        lossKg,
        evidenceAttached: lossChecks.evidence,
        managerApprovedBy: lossManagerId,
        exceptionApprovedBy: lossExceptionApproverId || null,
        wetCoffeeJointApproved: lossChecks.jointApprovalAttached,
      });
      await reload();
      setLastEvidence({
        type: "STORAGE_LOSS",
        id,
        label: id.slice(0, 8).toUpperCase(),
        documentType: "STORAGE_LOSS_EVIDENCE",
        title: "Measurement evidence",
      });
      setMessage(
        `Storage loss ${id.slice(0, 8).toUpperCase()} posted for ${selectedLossLot?.lot_number}. The attached measurement evidence must record the ${lossCause.toLowerCase()} cause.`,
      );
      setLossLotId("");
      setMeasuredQuantity(0);
      setLossManagerId("");
      setLossExceptionApproverId("");
      setLossChecks({ evidence: false, jointApprovalAttached: false });
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Storage loss could not be posted.",
      );
    }
  }

  async function createPrintOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!printQuote.valid) {
      setMessage("Bag printing requires at least 50 bags.");
      return;
    }
    if (!printClientId || !printApproverId) {
      setMessage("Select the client and independent approver.");
      return;
    }
    try {
      const id = await postBagPrintingOrder({
        clientId: printClientId,
        lotId: printLotId || null,
        quantity: printQuantity,
        approvedBy: printApproverId,
      });
      setLastEvidence({
        type: "BAG_PRINTING_ORDER",
        id,
        label: id.slice(0, 8).toUpperCase(),
        documentType: "BAG_ORDER_EVIDENCE",
        title: "Bag order evidence",
      });
      await reload();
      setMessage(
        "Bag printing order posted and added to unbilled service events.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Bag printing order could not be posted.",
      );
    }
  }

  async function addLabour(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!labourClientId || !labourCharge.valid) {
      setMessage("Select a client and enter a valid internal labour cost.");
      return;
    }
    try {
      const posted = await postLabourEntry({
        clientId: labourClientId,
        workDate: labourDate,
        activity: labourActivity,
        quantity: labourQuantity,
        unitLabel: labourUnit,
        internalCostEtb: labourInternal,
        lotId: labourLotId || null,
        processingOrderId: labourOrderId || null,
        note: labourNote,
        externalReference: labourReference,
      });
      await reload();
      setLastEvidence({
        type: "LABOUR_RECORD",
        id: posted.id,
        label: posted.labour_number,
        documentType: "LABOUR_EVIDENCE",
        title: "Labour voucher or evidence",
      });
      setMessage(
        `${posted.labour_number} recorded. Internal cost ETB ${Number(posted.internal_cost_etb).toLocaleString()} and client service charge ETB ${Number(posted.client_charge_etb).toLocaleString()} remain separate.`,
      );
      setLabourNote("");
      setLabourReference("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Labour entry could not be recorded.",
      );
    }
  }

  async function addManualService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manualClientId || !manualApproverId || (manualNeedsProcessingOrder && !manualOrderId)) {
      setMessage("Select the client, completed processing order, and independent approver.");
      return;
    }
    setManualBusy(true);
    try {
      const posted = await postManualService({
        clientId: manualClientId,
        serviceCode: manualServiceCode,
        serviceDate: manualServiceDate,
        description: manualDescription,
        quantity: manualQuantity,
        unitLabel: manualUnit,
        unitPrice: manualUnitPrice,
        approvedBy: manualApproverId,
        processingOrderId: manualOrderId || null,
        evidenceReference: manualEvidenceReference,
        note: manualNote,
      });
      await reload();
      setLastEvidence({
        type: "MANUAL_SERVICE",
        id: posted.id,
        label: posted.service_number,
        documentType: "SERVICE_EVIDENCE",
        title: "Service evidence",
      });
      setMessage(`${posted.service_number} recorded manually as an unbilled ${manualServiceCode.toLowerCase()} service. No processing status created this charge automatically.`);
      setManualDescription("");
      setManualEvidenceReference("");
      setManualNote("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The service could not be recorded.");
    } finally {
      setManualBusy(false);
    }
  }

  async function createGeneratorRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !generatorChecks.receipt ||
      !generatorChecks.supervisor ||
      !generatorChecks.finance
    ) {
      setMessage(
        "Supplier receipt, supervisor approval, and finance review are required.",
      );
      return;
    }
    if (!generatorClientId || !generatorOrderId || !generatorApproverId) {
      setMessage(
        "Select the client, processing order, and independent approver.",
      );
      return;
    }
    try {
      const id = await postGeneratorRequest({
        clientId: generatorClientId,
        processingOrderId: generatorOrderId,
        dieselLitres,
        unitCost: dieselUnitCost,
        approvedBy: generatorApproverId,
      });
      setLastEvidence({
        type: "GENERATOR_REQUEST",
        id,
        label: id.slice(0, 8).toUpperCase(),
        documentType: "GENERATOR_RECEIPT",
        title: "Supplier receipt",
      });
      await reload();
      setMessage(
        "Generator recovery posted against the selected processing order.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Generator request could not be posted.",
      );
    }
  }

  const evidence = lastEvidence && (
    <section className="post-save-evidence">
      <EvidenceUploader
        reference={{
          type: lastEvidence.type,
          id: lastEvidence.id,
          label: lastEvidence.label,
        }}
        documentType={lastEvidence.documentType}
        label={lastEvidence.title}
        help="Add the supporting PDF, JPG, or PNG while this record is still in front of you."
      />
    </section>
  );
  const reportAction = () => onNavigate?.({ view: "Reports" });
  const notice = (
    <>
      {message && (
        <div className="operation-message" role="status">
          <Check size={17} />
          {message}
          <button type="button" onClick={() => setMessage("")}>
            Close
          </button>
        </div>
      )}
      <div className="warehouse-quick-actions">
        <button
          className="secondary-button"
          type="button"
          onClick={reportAction}
        >
          View this in Reports
        </button>
      </div>
      {evidence}
    </>
  );

  if (databaseError && !data)
    return (
      <div className="module-page">
        <Header
          label="WAREHOUSE CONTROL"
          title={activeView}
          copy="Operational data must come from the warehouse database."
        />
        <section className="database-unavailable" role="alert">
          <AlertTriangle size={26} />
          <h2>Database unavailable</h2>
          <p>Unable to load warehouse data. No demo values are being shown.</p>
          <small>{databaseError}</small>
          <button
            className="primary-button"
            type="button"
            onClick={() => void reload()}
          >
            Retry database connection
          </button>
        </section>
      </div>
    );

  if (activeView === "Storage Loss")
    return (
      <div className="module-page">
        <Header
          label="ADJUSTMENT / EXCEPTION"
          title="Storage Loss"
          copy="Compare the system balance with a physical measurement. The posted difference remains separate from processing allowance."
        />
        {notice}
        <div className="control-layout">
          <form
            className="control-form storage-loss-form"
            onSubmit={recordLoss}
          >
            <header>
              <Droplets size={19} />
              <div>
                <h2>Record measured storage loss</h2>
                <p>
                  {selectedLossLot
                    ? `${selectedLossLot.lot_number} - ${clientById.get(selectedLossLot.client_id)}`
                    : "Select a client and coffee lot"}
                </p>
              </div>
            </header>
            <div className="control-fields">
              <label>
                1. Client
                <select
                  required
                  value={lossClientId}
                  onChange={(event) => {
                    setLossClientId(event.target.value);
                    setLossLotId("");
                    setMeasuredQuantity(0);
                  }}
                >
                  <option value="" disabled>
                    Select client
                  </option>
                  {clients.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} - {item.legal_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                2. Coffee lot
                <select
                  required
                  value={lossLotId}
                  onChange={(event) => {
                    const lot = lossLots.find(
                      (item) => item.id === event.target.value,
                    );
                    setLossLotId(event.target.value);
                    setMeasuredQuantity(Number(lot?.quantity_kg ?? 0));
                  }}
                  disabled={!lossClientId}
                >
                  <option value="" disabled>
                    Select active lot
                  </option>
                  {lossLots.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.lot_number} -{" "}
                      {Number(item.quantity_kg).toLocaleString()} kg -{" "}
                      {item.section}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                3. System quantity (kg)
                <input
                  value={systemQuantity ? systemQuantity.toLocaleString() : ""}
                  readOnly
                  aria-label="Current system quantity in kilograms"
                />
              </label>
              <label>
                4. Physical measurement (kg)
                <input
                  type="number"
                  min="0"
                  max={systemQuantity || undefined}
                  step="0.01"
                  value={measuredQuantity || ""}
                  onChange={(event) =>
                    setMeasuredQuantity(Number(event.target.value))
                  }
                  disabled={!selectedLossLot}
                  required
                />
              </label>
              <label>
                5. Cause
                <select
                  value={lossCause}
                  onChange={(event) => setLossCause(event.target.value)}
                >
                  <option>Evaporation</option>
                  <option>Spillage</option>
                  <option>Other measured loss</option>
                </select>
              </label>
              <label>
                6. Independent manager approver
                <select
                  required
                  value={lossManagerId}
                  onChange={(event) => setLossManagerId(event.target.value)}
                >
                  <option value="" disabled>
                    Select manager
                  </option>
                  {approvers
                    .filter((item) =>
                      ["system_admin", "warehouse_manager"].includes(item.role),
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.full_name} - {item.role.replaceAll("_", " ")}
                      </option>
                    ))}
                </select>
              </label>
              {lossResult.aboveLimit && (
                <label>
                  7. Exception approver
                  <select
                    required
                    value={lossExceptionApproverId}
                    onChange={(event) =>
                      setLossExceptionApproverId(event.target.value)
                    }
                  >
                    <option value="" disabled>
                      Select a different approver
                    </option>
                    {approvers
                      .filter(
                        (item) =>
                          ["system_admin", "warehouse_manager"].includes(
                            item.role,
                          ) && item.id !== lossManagerId,
                      )
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.full_name} - {item.role.replaceAll("_", " ")}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label className="inline-control">
                <input
                  type="checkbox"
                  checked={wetCoffee}
                  onChange={(event) => setWetCoffee(event.target.checked)}
                />
                Wet-coffee exception applies
              </label>
            </div>
            <div className="storage-loss-comparison">
              <div>
                <span>System stock</span>
                <strong>{systemQuantity.toLocaleString()} kg</strong>
              </div>
              <span>-</span>
              <div>
                <span>Physical measurement</span>
                <strong>{measuredQuantity.toLocaleString()} kg</strong>
              </div>
              <span>=</span>
              <div>
                <span>Storage loss</span>
                <strong>{lossKg.toLocaleString()} kg</strong>
                <small>{lossResult.percent.toFixed(2)}%</small>
              </div>
            </div>
            <div
              className={`rule-result ${lossResult.aboveLimit ? "bad" : "good"}`}
            >
              <span>Agreement limit</span>
              <strong>1.50%</strong>
              <small>
                {lossResult.aboveLimit
                  ? "Independent exception approval required"
                  : "Within ordinary storage-loss limit"}
              </small>
            </div>
            <div className="control-checks">
              <label>
                <input
                  type="checkbox"
                  checked={lossChecks.evidence}
                  onChange={(event) =>
                    setLossChecks((value) => ({
                      ...value,
                      evidence: event.target.checked,
                    }))
                  }
                />
                Measurement evidence includes the selected cause
              </label>
              {lossResult.aboveLimit && wetCoffee && (
                <label>
                  <input
                    type="checkbox"
                    checked={lossChecks.jointApprovalAttached}
                    onChange={(event) =>
                      setLossChecks((value) => ({
                        ...value,
                        jointApprovalAttached: event.target.checked,
                      }))
                    }
                  />
                  Written joint approval attached
                </label>
              )}
            </div>
            {lossResult.errors.length > 0 && selectedLossLot && lossKg > 0 && (
              <div className="control-errors">
                {lossResult.errors.map((error) => (
                  <p key={error}>
                    <AlertTriangle size={13} />
                    {error}
                  </p>
                ))}
              </div>
            )}
            <button
              className="primary-button"
              type="submit"
              disabled={!selectedLossLot || !lossManagerId || !lossResult.valid}
            >
              <ShieldCheck size={16} />
              Post storage loss
            </button>
          </form>
          <section className="control-list">
            <h2>Recent storage losses</h2>
            {(data?.storageLosses ?? []).map((record) => (
              <div key={record.id}>
                <span>
                  <strong>{record.id.slice(0, 8).toUpperCase()}</strong>
                  <small>
                    {data?.lots.find((lot) => lot.id === record.lot_id)
                      ?.lot_number ?? "Unknown lot"}
                  </small>
                </span>
                <span>
                  {Number(record.loss_kg).toLocaleString()} kg
                  <small>
                    {Number(record.loss_percent).toFixed(2)}% - system{" "}
                    {Number(record.measured_balance_kg).toLocaleString()} kg
                  </small>
                </span>
                <Status value={record.status} />
              </div>
            ))}
            {!data?.storageLosses.length && (
              <div className="empty-operation">
                <Droplets size={20} />
                <strong>No storage losses posted</strong>
                <small>Measured exceptions will appear here.</small>
              </div>
            )}
          </section>
        </div>
      </div>
    );

  if (activeView === "Bag Control")
    return (
      <div className="module-page">
        <Header
          label="SEPARATE LEDGER"
          title="Client-owned bags"
          copy="Bag ownership and movements remain separate from coffee stock."
        />
        {notice}
        <section className="bag-summary">
          <article>
            <Archive size={19} />
            <span>
              Printing orders<strong>{data?.bagOrders.length ?? 0}</strong>
            </span>
          </article>
          <article>
            <UsersRound size={19} />
            <span>
              Active clients<strong>{clients.length}</strong>
            </span>
          </article>
          <article>
            <AlertTriangle size={19} />
            <span>
              Minimum order<strong>50</strong>
            </span>
          </article>
        </section>
        <div className="control-layout">
          <form className="control-form" onSubmit={createPrintOrder}>
            <header>
              <Printer size={19} />
              <div>
                <h2>Bag printing order</h2>
                <p>Minimum order: 50 bags</p>
              </div>
            </header>
            <div className="control-fields">
              <label>
                Client
                <select
                  required
                  value={printClientId}
                  onChange={(event) => {
                    setPrintClientId(event.target.value);
                    setPrintLotId("");
                  }}
                >
                  <option value="" disabled>
                    Select client
                  </option>
                  {clients.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} - {item.legal_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Related lot (optional)
                <select
                  value={printLotId}
                  onChange={(event) => setPrintLotId(event.target.value)}
                  disabled={!printClientId}
                >
                  <option value="">General client order</option>
                  {printLots.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.lot_number} -{" "}
                      {Number(item.quantity_kg).toLocaleString()} kg
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Independent approver
                <select
                  required
                  value={printApproverId}
                  onChange={(event) => setPrintApproverId(event.target.value)}
                >
                  <option value="" disabled>
                    Select approver
                  </option>
                  {approvers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.full_name} - {item.role.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Quantity
                <input
                  type="number"
                  min="50"
                  step="1"
                  value={printQuantity}
                  onChange={(event) =>
                    setPrintQuantity(Number(event.target.value))
                  }
                />
              </label>
            </div>
            <div className={`rule-result ${printQuote.valid ? "good" : "bad"}`}>
              <span>Automatic tariff tier</span>
              <strong>
                {printQuote.valid
                  ? `ETB ${printQuote.rate.toFixed(2)} / bag`
                  : "Below minimum"}
              </strong>
              <small>
                {printQuote.valid
                  ? `Total ETB ${printQuote.total.toLocaleString()}`
                  : "Enter 50 bags or more"}
              </small>
            </div>
            <button
              className="primary-button"
              type="submit"
              disabled={!printQuote.valid || !printClientId || !printApproverId}
            >
              <Plus size={16} />
              Create printing order
            </button>
          </form>
          <section className="control-list">
            <h2>Printing orders</h2>
            {(data?.bagOrders ?? []).map((order) => (
              <div key={order.id}>
                <span>
                  <strong>{order.order_number}</strong>
                  <small>
                    {clientById.get(order.client_id) ?? "Unknown client"}
                  </small>
                </span>
                <span>
                  {order.quantity} bags
                  <small>
                    ETB {Number(order.total_amount).toLocaleString()}
                  </small>
                </span>
                <Status value={order.status} />
              </div>
            ))}
          </section>
        </div>
      </div>
    );

  if (activeView === "Labour")
    return (
      <div className="module-page">
        <Header
          label="COST CONTROL"
          title="Labour entries"
          copy="Record the work once. The ERP keeps Hayked's cost separate from the amount that will later appear in client billing."
        />
        {notice}
        <section className="service-workspace-overview">
          <article><UsersRound size={18} /><div><strong>Labour</strong><p>Records Hayked&apos;s internal cost and a separate client charge for finance review.</p></div></article>
          <article><Archive size={18} /><div><strong>Processing & other services</strong><p>Created only when staff deliberately record completed work below. Never automatic.</p></div></article>
          <button type="button" onClick={() => onNavigate?.({ view: "Finance" })}><Banknote size={18} /><span><strong>Warehouse rent</strong><small>Calculated by client, lot, dates, movements, and verified storage rates in Billing → Storage Review.</small></span></button>
        </section>
        <section className="service-recording-section">
          <div className="section-title-row"><div><h2>Record processing or another service</h2><p className="form-note">Use this only after the work happened. Completing a processing order never charges the client by itself.</p></div><Status value="MANUAL ONLY" /></div>
          <div className="control-layout">
            <form className="control-form" onSubmit={addManualService}>
              <header><Archive size={19} /><div><h2>New manual service</h2><p>An independent approver confirms the quantity and rate before it becomes unbilled work.</p></div></header>
              <div className="control-fields">
                <label>Service date<input type="date" required max={new Date().toISOString().slice(0, 10)} value={manualServiceDate} onChange={(event) => setManualServiceDate(event.target.value)} /></label>
                <label>Client<select required value={manualClientId} onChange={(event) => { setManualClientId(event.target.value); setManualOrderId(""); }}><option value="" disabled>Select client</option>{clients.map((item) => <option key={item.id} value={item.id}>{item.code} - {item.legal_name}</option>)}</select></label>
                <label>Service type<select value={manualServiceCode} onChange={(event) => { setManualServiceCode(event.target.value); if (!["PROCESSING", "HULLING", "CLEANING"].includes(event.target.value)) setManualOrderId(""); }}><option value="PROCESSING">Processing</option><option value="HULLING">Hulling</option><option value="CLEANING">Cleaning</option><option value="TRANSPORT">Transport / handling</option><option value="OTHER">Other service</option></select></label>
                <label>Completed processing order<select required={manualNeedsProcessingOrder} value={manualOrderId} disabled={!manualClientId || !manualNeedsProcessingOrder} onChange={(event) => setManualOrderId(event.target.value)}><option value="">{manualNeedsProcessingOrder ? "Select completed order" : "Not required"}</option>{manualOrders.map((item) => <option key={item.id} value={item.id}>{item.order_number}</option>)}</select></label>
                <label className="wide">What work was completed?<input required minLength={3} maxLength={240} value={manualDescription} onChange={(event) => setManualDescription(event.target.value)} placeholder="Example: Hulling completed for client processing order" /></label>
                <label>Quantity<input type="number" required min="0.001" step="0.001" value={manualQuantity} onChange={(event) => setManualQuantity(Number(event.target.value))} /></label>
                <label>Unit<input required maxLength={30} value={manualUnit} onChange={(event) => setManualUnit(event.target.value)} placeholder="kg, bags, batch" /></label>
                <label>Approved rate per unit (ETB)<input type="number" required min="0" step="0.01" value={manualUnitPrice} onChange={(event) => setManualUnitPrice(Number(event.target.value))} /></label>
                <label>Independent approver<select required value={manualApproverId} onChange={(event) => setManualApproverId(event.target.value)}><option value="" disabled>Select approver</option>{approvers.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label>
                <label>Evidence reference<input value={manualEvidenceReference} onChange={(event) => setManualEvidenceReference(event.target.value)} placeholder="Job card, voucher, or worksheet" /></label>
                <label className="wide">Note<textarea rows={2} value={manualNote} onChange={(event) => setManualNote(event.target.value)} /></label>
              </div>
              <div className="labour-charge-preview"><div><span>Quantity</span><strong>{manualQuantity.toLocaleString()} {manualUnit}</strong></div><span>×</span><div><span>Approved rate</span><strong>ETB {manualUnitPrice.toLocaleString()}</strong></div><span>=</span><div><span>Unbilled amount</span><strong>ETB {(manualQuantity * manualUnitPrice).toLocaleString()}</strong></div></div>
              <button className="primary-button" type="submit" disabled={manualBusy || !manualClientId || !manualApproverId || (manualNeedsProcessingOrder && !manualOrderId)}><Plus size={16} />{manualBusy ? "Recording..." : "Record manual service"}</button>
            </form>
            <section className="control-list"><h2>Recent processing & other services</h2>{(data?.manualServices ?? []).map((service) => <div key={service.id}><span><strong>{service.service_number}</strong><small>{service.description} - {clientById.get(service.client_id) ?? "Unknown client"}</small></span><span>{Number(service.quantity).toLocaleString()} {service.unit_label}<small>ETB {Number(service.total_amount).toLocaleString()}</small></span><Status value="UNBILLED" /></div>)}{!data?.manualServices.length && <div className="empty-operation"><Archive size={20} /><strong>No manual services</strong><small>Nothing is charged until staff record completed work.</small></div>}</section>
          </div>
        </section>
        <div className="tariff-warning">
          <AlertTriangle size={18} />
          <div>
            <strong>
              Configurable demo addition: ETB {labourAddition.toLocaleString()}
            </strong>
            <p>
              This is the current demo default, not a confirmed production
              markup. New records copy it so historical charges remain stable.
            </p>
          </div>
        </div>
        <section className="grn-summary labour-flow-summary">
          <article><UsersRound size={18} /><span>1. Hayked cost<strong>Internal record</strong><small>This is a cost record, not proof that a worker was paid.</small></span></article>
          <article><Banknote size={18} /><span>2. Client charge<strong>Unbilled service</strong><small>Finance reviews it before adding it to an invoice.</small></span></article>
        </section>
        <div className="control-layout">
          <form className="control-form" onSubmit={addLabour}>
            <header>
              <UsersRound size={19} />
              <div>
                <h2>Record labour activity</h2>
                <p>
                  Creates an internal cost record and one unbilled client
                  service event.
                </p>
              </div>
            </header>
            <div className="control-fields">
              <label>
                Work date
                <input
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  value={labourDate}
                  onChange={(event) => setLabourDate(event.target.value)}
                />
              </label>
              <label>
                Client
                <select
                  required
                  value={labourClientId}
                  onChange={(event) => {
                    setLabourClientId(event.target.value);
                    setLabourOrderId("");
                    setLabourLotId("");
                  }}
                >
                  <option value="" disabled>
                    Select client
                  </option>
                  {clients.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} - {item.legal_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Activity
                <select
                  value={labourActivity}
                  onChange={(event) => setLabourActivity(event.target.value)}
                >
                  <option>Bag handling</option>
                  <option>Container loading</option>
                  <option>Warehouse transfer</option>
                  <option>Processing support</option>
                  <option>Dispatch handling</option>
                </select>
              </label>
              <label>
                Related processing order
                <select
                  value={labourOrderId}
                  onChange={(event) => setLabourOrderId(event.target.value)}
                  disabled={!labourClientId}
                >
                  <option value="">General warehouse activity</option>
                  {labourOrders.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.order_number} - {item.status.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Related lot
                <select
                  value={labourLotId}
                  onChange={(event) => setLabourLotId(event.target.value)}
                  disabled={!labourClientId}
                >
                  <option value="">No specific lot</option>
                  {labourLots.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.lot_number}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Quantity
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={labourQuantity}
                  onChange={(event) =>
                    setLabourQuantity(Number(event.target.value))
                  }
                />
              </label>
              <label>
                Unit
                <input
                  value={labourUnit}
                  onChange={(event) => setLabourUnit(event.target.value)}
                  placeholder="bags, hours, job"
                />
              </label>
              <label>
                Hayked internal labour cost (ETB)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={labourInternal}
                  onChange={(event) =>
                    setLabourInternal(Number(event.target.value))
                  }
                />
              </label>
              <label>
                Evidence/reference
                <input
                  value={labourReference}
                  onChange={(event) => setLabourReference(event.target.value)}
                  placeholder="Voucher or job reference"
                />
              </label>
              <label className="wide">
                Note
                <textarea
                  rows={2}
                  value={labourNote}
                  onChange={(event) => setLabourNote(event.target.value)}
                />
              </label>
            </div>
            <div className="labour-charge-preview">
              <div>
                <span>Hayked cost record</span>
                <strong>ETB {labourInternal.toLocaleString()}</strong>
              </div>
              <span>+</span>
              <div>
                <span>Configured addition</span>
                <strong>ETB {labourAddition.toLocaleString()}</strong>
              </div>
              <span>=</span>
              <div>
                <span>Client charge to review</span>
                <strong>
                  ETB {labourCharge.clientChargeEtb.toLocaleString()}
                </strong>
              </div>
            </div>
            <button
              className="primary-button"
              type="submit"
              disabled={!labourClientId || !labourCharge.valid}
            >
              <Plus size={16} />
              Record labour and service event
            </button>
          </form>
          <section className="control-list labour-record-list">
            <h2>Recent labour entries</h2>
            {(data?.labourRecords ?? []).map((entry) => (
              <div key={entry.id}>
                <span>
                  <strong>{entry.labour_number}</strong>
                  <small>
                    {entry.activity} -{" "}
                    {clientById.get(entry.client_id) ?? "Unknown client"}
                  </small>
                </span>
                <span>
                  Internal ETB{" "}
                  {Number(entry.internal_cost_etb).toLocaleString()}
                  <small>
                    Client charge ETB{" "}
                    {Number(entry.client_charge_etb).toLocaleString()} ·
                    difference ETB{" "}
                    {Number(entry.charge_addition_etb).toLocaleString()}
                  </small>
                </span>
                <Status
                  value={entry.service_event_id ? "UNBILLED" : "INCOMPLETE"}
                />
              </div>
            ))}
            {!data?.labourRecords.length && (
              <div className="empty-operation">
                <UsersRound size={20} />
                <strong>No labour entries</strong>
                <small>Record the first warehouse labour activity.</small>
              </div>
            )}
          </section>
        </div>
      </div>
    );

  return (
    <div className="module-page">
      <Header
        label="ACTUAL COST RECOVERY"
        title="Generator requests"
        copy="Only supported actual diesel cost is recoverable unless a signed rate applies."
      />
      {notice}
      <div className="control-layout">
        <form className="control-form" onSubmit={createGeneratorRequest}>
          <header>
            <Fuel size={19} />
            <div>
              <h2>Generator cost review</h2>
              <p>
                {orderById.get(generatorOrderId)
                  ? `Linked to ${orderById.get(generatorOrderId)}`
                  : "Select an active or completed processing order"}
              </p>
            </div>
          </header>
          <div className="control-fields">
            <label>
              Client
              <select
                required
                value={generatorClientId}
                onChange={(event) => {
                  setGeneratorClientId(event.target.value);
                  setGeneratorOrderId("");
                }}
              >
                <option value="" disabled>
                  Select client
                </option>
                {clients.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} - {item.legal_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Processing order
              <select
                required
                value={generatorOrderId}
                onChange={(event) => setGeneratorOrderId(event.target.value)}
                disabled={!generatorClientId}
              >
                <option value="" disabled>
                  Select processing order
                </option>
                {generatorOrders.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.order_number} - {item.status.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Independent approver
              <select
                required
                value={generatorApproverId}
                onChange={(event) => setGeneratorApproverId(event.target.value)}
              >
                <option value="" disabled>
                  Select approver
                </option>
                {approvers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.full_name} - {item.role.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Diesel quantity (litres)
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={dieselLitres}
                onChange={(event) =>
                  setDieselLitres(Number(event.target.value))
                }
              />
            </label>
            <label>
              Unit cost (ETB)
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={dieselUnitCost}
                onChange={(event) =>
                  setDieselUnitCost(Number(event.target.value))
                }
              />
            </label>
          </div>
          <div className="rule-result good">
            <span>Supported actual cost</span>
            <strong>ETB {actualCost.toLocaleString()}</strong>
            <small>No markup applied</small>
          </div>
          <div className="control-checks">
            <label>
              <input
                type="checkbox"
                checked={generatorChecks.receipt}
                onChange={(event) =>
                  setGeneratorChecks((value) => ({
                    ...value,
                    receipt: event.target.checked,
                  }))
                }
              />
              Supplier receipt attached
            </label>
            <label>
              <input
                type="checkbox"
                checked={generatorChecks.supervisor}
                onChange={(event) =>
                  setGeneratorChecks((value) => ({
                    ...value,
                    supervisor: event.target.checked,
                  }))
                }
              />
              Supervisor approved
            </label>
            <label>
              <input
                type="checkbox"
                checked={generatorChecks.finance}
                onChange={(event) =>
                  setGeneratorChecks((value) => ({
                    ...value,
                    finance: event.target.checked,
                  }))
                }
              />
              Finance reviewed
            </label>
          </div>
          <button
            className="primary-button"
            type="submit"
            disabled={
              !generatorClientId || !generatorOrderId || !generatorApproverId
            }
          >
            <Banknote size={16} />
            Post actual cost
          </button>
        </form>
        <section className="control-list">
          <h2>Generator requests</h2>
          {(data?.generatorRequests ?? []).map((request) => (
            <div key={request.id}>
              <span>
                <strong>{request.request_number}</strong>
                <small>
                  {clientById.get(request.client_id) ?? "Unknown client"} -{" "}
                  {orderById.get(request.processing_order_id ?? "") ??
                    "Legacy request"}
                </small>
              </span>
              <span>
                {Number(request.diesel_litres).toLocaleString()} L
                <small>ETB {Number(request.total_cost).toLocaleString()}</small>
              </span>
              <Status value={request.status} />
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
