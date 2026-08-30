"use client";

import {
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  Check,
  ClipboardCheck,
  CreditCard,
  FileBarChart,
  Minus,
  PackageCheck,
  Plus,
  Save,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import {
  evaluateEcsReceipt,
  evaluateOwnershipTransfer,
} from "./release-workflow";
import {
  createDispatchDraft,
  decideCreditOverride,
  dispatchRpc,
  loadDispatchData,
  postEcxTransfer,
  postOwnershipTransfer,
  receiveEcxTransfer,
  updateDispatchReadiness,
  type DispatchData,
  type DispatchRow,
} from "@/lib/erp-data";

export const dispatchViews = ["Dispatch", "Ownership Transfers"];
type Tab =
  "New dispatch" | "Release readiness" | "Dispatches" | "ECX transfers";
type DispatchLineDraft = {
  key: number;
  lotId: string;
  bagCount: number;
  quantityKg: number;
};
let lineKey = 1;
const newLine = (): DispatchLineDraft => ({
  key: lineKey++,
  lotId: "",
  bagCount: 0,
  quantityKg: 0,
});

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
  action,
}: {
  label: string;
  title: string;
  copy: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="module-heading">
      <div>
        <span className="demo-label">{label}</span>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
      {action}
    </section>
  );
}
function Empty({ title, copy }: { title: string; copy: string }) {
  return (
    <section className="empty-operation">
      <Truck size={24} />
      <h2>{title}</h2>
      <p>{copy}</p>
    </section>
  );
}

export function DispatchOperations({
  activeView,
  onNavigate,
}: {
  activeView: string;
  onNavigate?: (intent: { view: string; reportType?: "Dispatch" }) => void;
}) {
  const [tab, setTab] = useState<Tab>("New dispatch");
  const [message, setMessage] = useState("");
  const [data, setData] = useState<DispatchData | null>(null);
  const [selectedDispatchId, setSelectedDispatchId] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [lines, setLines] = useState<DispatchLineDraft[]>([newLine()]);
  const [useCredit, setUseCredit] = useState(false);

  const [selectedEcxId, setSelectedEcxId] = useState("");
  const [ecxLotId, setEcxLotId] = useState("");
  const [ecxDestinationWarehouseId, setEcxDestinationWarehouseId] =
    useState("");
  const [ecxSentKg, setEcxSentKg] = useState(0);
  const [ecxVehiclePlate, setEcxVehiclePlate] = useState("");
  const [ecxTransferReference, setEcxTransferReference] = useState("");
  const [ecxDriverName, setEcxDriverName] = useState("");
  const [ecxSealNumber, setEcxSealNumber] = useState("");
  const [ecxExpectedArrivalOn, setEcxExpectedArrivalOn] = useState("");
  const [ecxDepartureDocument, setEcxDepartureDocument] = useState("");
  const [ecxDestinationDocument, setEcxDestinationDocument] = useState("");
  const [ecxReceivedKg, setEcxReceivedKg] = useState(0);
  const [ecxDestinationSection, setEcxDestinationSection] = useState("");
  const [ecxVarianceApproverId, setEcxVarianceApproverId] = useState("");
  const [transferKg, setTransferKg] = useState(6000);
  const [transferLotId, setTransferLotId] = useState("");
  const [destinationClientId, setDestinationClientId] = useState("");
  const [transferApproverId, setTransferApproverId] = useState("");
  const [signedInstructionReference, setSignedInstructionReference] =
    useState("");
  const [transferChecks, setTransferChecks] = useState({
    signedInstruction: false,
    sourceApproved: false,
    destinationAccepted: false,
    haykedApproved: false,
    hasHold: false,
  });

  async function reload() {
    try {
      const next = await loadDispatchData();
      setData(next);
      setSelectedDispatchId((current) =>
        next.dispatches.some((item) => item.id === current)
          ? current
          : (next.dispatches[0]?.id ?? ""),
      );
      setTransferLotId((current) =>
        next.lots.some((item) => item.id === current)
          ? current
          : (next.lots.find(
              (item) =>
                Number(item.quantity_kg) > 0 &&
                !["CLOSED", "DISPATCHED", "REVERSED"].includes(item.status),
            )?.id ?? ""),
      );
      setSelectedEcxId((current) =>
        next.ecxTransfers.some((item) => item.id === current)
          ? current
          : (next.ecxTransfers.find((item) => item.status === "IN_TRANSIT")
              ?.id ??
            next.ecxTransfers[0]?.id ??
            ""),
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Dispatch records could not be loaded.",
      );
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, []);

  const clients = data?.clients ?? [];
  const lots = data?.lots ?? [];
  const representatives = (data?.representatives ?? []).filter(
    (item) =>
      item.client_id === selectedClientId &&
      item.active &&
      item.valid_from <= new Date().toISOString().slice(0, 10) &&
      (!item.valid_to ||
        item.valid_to >= new Date().toISOString().slice(0, 10)),
  );
  const activeReservations =
    data?.reservations.filter((item) => item.status === "ACTIVE") ?? [];
  const reservedKg = new Map<string, number>();
  const reservedBags = new Map<string, number>();
  activeReservations.forEach((item) => {
    reservedKg.set(
      item.lot_id,
      (reservedKg.get(item.lot_id) ?? 0) + Number(item.reserved_kg),
    );
    reservedBags.set(
      item.lot_id,
      (reservedBags.get(item.lot_id) ?? 0) + item.reserved_bags,
    );
  });
  const eligibleLots = lots.filter(
    (lot) =>
      lot.client_id === selectedClientId &&
      Number(lot.quantity_kg) - (reservedKg.get(lot.id) ?? 0) > 0 &&
      !["DISPATCHED", "CLOSED", "REVERSED", "IN_PROCESS"].includes(lot.status),
  );
  const selectedDispatch =
    data?.dispatches.find((item) => item.id === selectedDispatchId) ??
    data?.dispatches[0];
  const selectedCredit = data?.credits.find(
    (item) => item.dispatch_id === selectedDispatch?.id,
  );
  const selectedLines =
    data?.lines.filter((item) => item.dispatch_id === selectedDispatch?.id) ??
    [];
  const selectedReservations =
    data?.reservations.filter(
      (item) => item.dispatch_id === selectedDispatch?.id,
    ) ?? [];
  const selectedClient = clients.find(
    (item) => item.id === selectedDispatch?.client_id,
  );
  const selectedRepresentative = data?.representatives.find(
    (item) => item.id === selectedDispatch?.representative_id,
  );
  const agreementActive = Boolean(
    data?.agreements.some(
      (item) =>
        item.client_id === selectedDispatch?.client_id &&
        item.status === "ACTIVE" &&
        item.effective_from <= selectedDispatch.dispatch_date &&
        (!item.effective_to ||
          item.effective_to >= selectedDispatch.dispatch_date),
    ),
  );
  const representativeValid = Boolean(
    selectedRepresentative?.active &&
    selectedRepresentative.valid_from <=
      (selectedDispatch?.dispatch_date ?? "") &&
    (!selectedRepresentative.valid_to ||
      selectedRepresentative.valid_to >=
        (selectedDispatch?.dispatch_date ?? "")),
  );
  const creditValid = Boolean(
    selectedCredit?.status === "APPROVED" &&
    selectedCredit.expires_on >= new Date().toISOString().slice(0, 10),
  );
  const gates = selectedDispatch
    ? {
        agreementActive,
        representativeValid,
        stockReserved:
          selectedLines.length > 0 &&
          selectedReservations.length === selectedLines.length &&
          selectedReservations.every(
            (item) =>
              item.status ===
              (selectedDispatch.status === "POSTED" ? "CONSUMED" : "ACTIVE"),
          ),
        documentsReady: Boolean(selectedDispatch.documents_reference),
        financeCleared:
          selectedDispatch.invoices_paid ||
          (selectedDispatch.credit_approved && creditValid),
        noHold: !selectedDispatch.legal_or_quality_hold,
        approved: ["APPROVED", "POSTED"].includes(selectedDispatch.status),
        weighbridgeReady: Boolean(selectedDispatch.weighbridge_reference),
      }
    : null;
  const ready = Boolean(gates && Object.values(gates).every(Boolean));
  const gateLabels = {
    agreementActive: "Active agreement",
    representativeValid: "Authorized representative",
    stockReserved: "Stock reserved",
    documentsReady: "Dispatch document",
    financeCleared: "Payment or approved credit",
    noHold: "No legal or quality hold",
    approved: "Independent approval",
    weighbridgeReady: "Weighbridge ticket",
  } as const;
  const readinessItems = gates ? Object.entries(gateLabels).map(([key, label]) => ({ key: key as keyof typeof gates, label, passed: gates[key as keyof typeof gates] })) : [];
  const readinessPassed = readinessItems.filter((item) => item.passed);
  const readinessBlocked = readinessItems.filter((item) => !item.passed);
  const clientById = new Map(clients.map((item) => [item.id, item.legal_name]));
  const lotById = new Map(lots.map((item) => [item.id, item]));
  const profileById = new Map(
    (data?.profiles ?? []).map((item) => [item.id, item.full_name]),
  );
  const transferLot = lots.find((item) => item.id === transferLotId);
  const transferSourceClient = clients.find(
    (item) => item.id === transferLot?.client_id,
  );
  const transferApprovers = (data?.profiles ?? []).filter(
    (item) =>
      item.active && ["system_admin", "warehouse_manager"].includes(item.role),
  );
  const transfer = evaluateOwnershipTransfer({
    sourceKg: Number(transferLot?.quantity_kg ?? 0),
    transferKg,
    ...transferChecks,
  });
  const selectedEcx = data?.ecxTransfers.find(
    (item) => item.id === selectedEcxId,
  );
  const ecxSourceLot = lotById.get(selectedEcx?.lot_id ?? "");
  const ecxClient = clients.find((item) => item.id === selectedEcx?.client_id);
  const warehouseById = new Map(
    (data?.warehouses ?? []).map((item) => [item.id, item]),
  );
  const selectedEcxSource = warehouseById.get(
    selectedEcx?.source_warehouse_id ?? "",
  );
  const selectedEcxDestination = warehouseById.get(
    selectedEcx?.destination_warehouse_id ?? "",
  );
  const ecxVarianceApprovers = (data?.profiles ?? []).filter(
    (item) =>
      item.active && ["system_admin", "warehouse_manager"].includes(item.role),
  );
  const effectiveEcxReceivedKg =
    ecxReceivedKg ||
    Number(selectedEcx?.received_kg ?? selectedEcx?.sent_kg ?? 0);
  const ecxResult = selectedEcx
    ? evaluateEcsReceipt({
        sentKg: Number(selectedEcx.sent_kg),
        receivedKg: effectiveEcxReceivedKg,
        alreadyReceived: selectedEcx.status === "RECEIVED",
        varianceApproved: Boolean(ecxVarianceApproverId),
      })
    : null;

  function updateLine(key: number, patch: Partial<DispatchLineDraft>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }
  function selectLot(key: number, lotId: string) {
    const lot = lotById.get(lotId);
    updateLine(key, {
      lotId,
      bagCount: Number(lot?.bag_count ?? 0) - (reservedBags.get(lotId) ?? 0),
      quantityKg: Number(lot?.quantity_kg ?? 0) - (reservedKg.get(lotId) ?? 0),
    });
  }

  async function submitNewDispatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (
      !selectedClientId ||
      lines.some(
        (line) => !line.lotId || line.bagCount <= 0 || line.quantityKg <= 0,
      )
    ) {
      setMessage(
        "Select the client and enter positive quantities for every dispatch line.",
      );
      return;
    }
    if (new Set(lines.map((line) => line.lotId)).size !== lines.length) {
      setMessage("A source lot can only appear once.");
      return;
    }
    try {
      const created = await createDispatchDraft(
        {
          clientId: selectedClientId,
          representativeId: String(form.get("representativeId")),
          dispatchDate: String(form.get("dispatchDate")),
          reason: String(form.get("reason")),
          destination: String(form.get("destination")),
          documentsReference: String(form.get("documentsReference")),
          weighbridgeReference: String(form.get("weighbridgeReference")),
          notes: String(form.get("notes")),
          creditAmount: useCredit ? Number(form.get("creditAmount")) : 0,
          creditExpiry: String(form.get("creditExpiry")),
          creditReason: String(form.get("creditReason")),
          creditDocumentReference: String(form.get("creditDocumentReference")),
        },
        lines.map((line) => ({
          lotId: line.lotId,
          bagCount: line.bagCount,
          quantityKg: line.quantityKg,
        })),
      );
      await reload();
      setSelectedDispatchId(created.id);
      setSelectedClientId("");
      setLines([newLine()]);
      setUseCredit(false);
      setMessage(
        `${created.dispatch_number} created and its stock is reserved.`,
      );
      setTab("Release readiness");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Dispatch draft could not be created.",
      );
    }
  }

  async function advanceDispatch(
    action: "submit_dispatch" | "approve_dispatch" | "post_dispatch_v2",
  ) {
    if (!selectedDispatch) return;
    try {
      await dispatchRpc(action, selectedDispatch.id);
      await reload();
      setMessage(
        `${selectedDispatch.dispatch_number} ${action === "submit_dispatch" ? "submitted" : action === "approve_dispatch" ? "approved" : "posted to the stock ledger"}.`,
      );
      if (action === "post_dispatch_v2") setTab("Dispatches");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Dispatch action failed.",
      );
    }
  }

  async function decideCredit(decision: "APPROVED" | "REJECTED") {
    if (!selectedCredit) return;
    try {
      await decideCreditOverride(selectedCredit.id, decision);
      await reload();
      setMessage(`Credit override ${decision.toLowerCase()}.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Credit decision failed.",
      );
    }
  }

  async function saveReadiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDispatch) return;
    const form = new FormData(event.currentTarget);
    try {
      await updateDispatchReadiness(
        selectedDispatch.id,
        String(form.get("documentReference")),
        String(form.get("weighbridgeReference")),
        String(form.get("notes") ?? ""),
      );
      await reload();
      setMessage(
        `${selectedDispatch.dispatch_number} missing release information updated.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Dispatch readiness could not be updated.",
      );
    }
  }

  async function sendEcx(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ecxLotId || !ecxDestinationWarehouseId || ecxSentKg <= 0) {
      setMessage(
        "Select a source lot, destination warehouse and positive transfer weight.",
      );
      return;
    }
    try {
      const id = await postEcxTransfer({
        lotId: ecxLotId,
        destinationWarehouseId: ecxDestinationWarehouseId,
        sentKg: ecxSentKg,
        vehiclePlate: ecxVehiclePlate,
        transferReference: ecxTransferReference,
        driverName: ecxDriverName,
        sealNumber: ecxSealNumber,
        expectedArrivalOn: ecxExpectedArrivalOn,
        departureDocumentReference: ecxDepartureDocument,
      });
      await reload();
      setSelectedEcxId(id);
      setEcxLotId("");
      setEcxDestinationWarehouseId("");
      setEcxSentKg(0);
      setEcxVehiclePlate("");
      setEcxTransferReference("");
      setEcxDriverName("");
      setEcxSealNumber("");
      setEcxExpectedArrivalOn("");
      setEcxDepartureDocument("");
      setMessage(
        "ECX transfer sent and source stock posted once. Client ownership is unchanged.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "ECX transfer could not be sent.",
      );
    }
  }

  async function receiveEcx() {
    if (!selectedEcx || !ecxResult?.valid || !ecxDestinationSection.trim()) {
      setMessage(ecxResult?.errors[0] ?? "Enter the destination section.");
      return;
    }
    try {
      await receiveEcxTransfer({
        transferId: selectedEcx.id,
        receivedKg: effectiveEcxReceivedKg,
        destinationSection: ecxDestinationSection,
        varianceApprovedBy:
          ecxResult.varianceKg > 0.01 ? ecxVarianceApproverId || null : null,
        destinationDocumentReference: ecxDestinationDocument,
      });
      await reload();
      setEcxReceivedKg(0);
      setEcxDestinationSection("");
      setEcxVarianceApproverId("");
      setEcxDestinationDocument("");
      setMessage(
        `${selectedEcx.transfer_number} received once. A destination lot and immutable stock movement were created.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "ECX destination receipt could not be posted.",
      );
    }
  }
  async function postTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !transferLotId ||
      !destinationClientId ||
      !transferApproverId ||
      !signedInstructionReference.trim()
    ) {
      setMessage(
        "Select the source lot, destination client, signed instruction, and independent approver.",
      );
      return;
    }
    if (!transfer.valid) {
      setMessage(transfer.errors[0]);
      return;
    }
    try {
      await postOwnershipTransfer({
        sourceLotId: transferLotId,
        destinationClientId,
        quantityKg: transferKg,
        signedInstructionPath: signedInstructionReference.trim(),
        haykedApprovedBy: transferApproverId,
      });
      await reload();
      setDestinationClientId("");
      setTransferApproverId("");
      setSignedInstructionReference("");
      setTransferChecks({
        signedInstruction: false,
        sourceApproved: false,
        destinationAccepted: false,
        haykedApproved: false,
        hasHold: false,
      });
      setMessage(
        "Ownership transfer posted. The destination child lot is now available without changing physical warehouse stock.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Ownership transfer could not be posted.",
      );
    }
  }
  const notice = message && (
    <div className="operation-message" role="status">
      <Check size={17} />
      {message}
      <button type="button" onClick={() => setMessage("")}>
        Close
      </button>
    </div>
  );

  if (activeView === "Ownership Transfers")
    return (
      <div className="module-page">
        <Header
          label="LEGAL OWNERSHIP CHANGE"
          title="Ownership transfers"
          copy="Physical warehouse stock remains unchanged while legal ownership changes."
        />
        {notice}
        <form className="transfer-layout" onSubmit={postTransfer}>
          <section className="transfer-form">
            <header>
              <ArrowRightLeft size={19} />
              <div>
                <h2>New ownership transfer</h2>
                <p>Controlled source and destination acceptance</p>
              </div>
            </header>
            <div className="form-grid compact transfer-selectors">
              <label>
                Source lot
                <select
                  required
                  value={transferLotId}
                  onChange={(event) => {
                    setTransferLotId(event.target.value);
                    setDestinationClientId("");
                  }}
                >
                  <option value="" disabled>
                    Select available lot
                  </option>
                  {lots
                    .filter(
                      (item) =>
                        Number(item.quantity_kg) > 0 &&
                        !["CLOSED", "DISPATCHED", "REVERSED"].includes(
                          item.status,
                        ),
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.lot_number} - {clientById.get(item.client_id)} -{" "}
                        {Number(item.quantity_kg).toLocaleString()} kg
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Destination client
                <select
                  required
                  value={destinationClientId}
                  onChange={(event) =>
                    setDestinationClientId(event.target.value)
                  }
                >
                  <option value="" disabled>
                    Select destination client
                  </option>
                  {clients
                    .filter(
                      (item) =>
                        item.active && item.id !== transferLot?.client_id,
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.code} - {item.legal_name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Independent Hayked approver
                <select
                  required
                  value={transferApproverId}
                  onChange={(event) =>
                    setTransferApproverId(event.target.value)
                  }
                >
                  <option value="" disabled>
                    Select approver
                  </option>
                  {transferApprovers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.full_name} - {item.role.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Signed instruction reference
                <input
                  required
                  value={signedInstructionReference}
                  onChange={(event) =>
                    setSignedInstructionReference(event.target.value)
                  }
                  placeholder="DOC-TRF-2026-0001"
                />
              </label>
            </div>
            <div className="ownership-flow">
              <div>
                <span>Source client</span>
                <strong>
                  {transferSourceClient?.legal_name ?? "Select source lot"}
                </strong>
                <small>
                  {Number(transferLot?.quantity_kg ?? 0).toLocaleString()} kg
                  available
                </small>
              </div>
              <ArrowRightLeft size={22} />
              <div>
                <span>Destination client</span>
                <strong>
                  {clients.find((item) => item.id === destinationClientId)
                    ?.legal_name ?? "Select destination"}
                </strong>
                <small>Child-lot lineage required</small>
              </div>
            </div>
            <label className="transfer-quantity">
              Transfer weight (kg)
              <input
                type="number"
                min="0.01"
                max={Number(transferLot?.quantity_kg ?? 0)}
                step="0.01"
                value={transferKg}
                onChange={(event) => setTransferKg(Number(event.target.value))}
              />
            </label>
            <div className="control-checks transfer-checks">
              {Object.entries({
                signedInstruction: "Signed transfer instruction attached",
                sourceApproved: "Source-client representative approved",
                destinationAccepted: "Destination client accepted",
                haykedApproved: "Independent Hayked approval confirmed",
                hasHold: "Unpaid-release or legal hold exists",
              }).map(([key, label]) => (
                <label
                  key={key}
                  className={key === "hasHold" ? "hold-check" : ""}
                >
                  <input
                    type="checkbox"
                    checked={transferChecks[key as keyof typeof transferChecks]}
                    onChange={(event) =>
                      setTransferChecks((value) => ({
                        ...value,
                        [key]: event.target.checked,
                      }))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            {transfer.errors.length > 0 && (
              <div className="control-errors">
                {transfer.errors.map((error) => (
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
              disabled={
                !transfer.valid ||
                !destinationClientId ||
                !transferApproverId ||
                !signedInstructionReference.trim()
              }
            >
              <ShieldCheck size={16} />
              Post ownership transfer
            </button>
          </section>
          <aside className="transfer-result">
            <h2>Expected atomic result</h2>
            <div>
              <span>Source remaining</span>
              <strong>{transfer.sourceRemainingKg.toLocaleString()} kg</strong>
            </div>
            <div>
              <span>Destination child lot</span>
              <strong>{transfer.destinationKg.toLocaleString()} kg</strong>
            </div>
            <div className="physical-total">
              <span>Physical warehouse total</span>
              <strong>{transfer.physicalTotalKg.toLocaleString()} kg</strong>
              <small>No physical stock change</small>
            </div>
          </aside>
        </form>
      </div>
    );

  return (
    <div className="module-page">
      <Header
        label="CONTROLLED PRODUCT RELEASE"
        title="Dispatch and release"
        copy="Reserve the correct client lot, complete the release checks, then post the movement once."
        action={
          <button
            className="secondary-button"
            type="button"
            onClick={() =>
              onNavigate?.({ view: "Reports", reportType: "Dispatch" })
            }
          >
            <FileBarChart size={16} />
            Open dispatch report
          </button>
        }
      />
      {notice}
      <div className="module-tabs processing-tabs" role="tablist">
        {(
          [
            "New dispatch",
            "Release readiness",
            "Dispatches",
            "ECX transfers",
          ] as Tab[]
        ).map((item) => (
          <button
            role="tab"
            aria-selected={tab === item}
            className={tab === item ? "active" : ""}
            type="button"
            key={item}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {tab === "New dispatch" && (
        <form className="operation-form" onSubmit={submitNewDispatch}>
          <header>
            <div>
              <span className="demo-label">DISPATCH DRAFT</span>
              <h2>Reserve stock for release</h2>
              <p>
                Choose an ordinary dispatch here. Use the separate ECX Transfer
                tab for warehouse-to-warehouse ECX movements.
              </p>
            </div>
          </header>
          <div className="form-grid compact">
            <label>
              Client
              <select
                required
                value={selectedClientId}
                onChange={(event) => {
                  setSelectedClientId(event.target.value);
                  setLines([newLine()]);
                }}
              >
                <option value="" disabled>
                  Select client
                </option>
                {clients
                  .filter((item) => item.active)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} - {item.legal_name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Authorized representative
              <select name="representativeId" required defaultValue="">
                <option value="" disabled>
                  Select representative
                </option>
                {representatives.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Dispatch date
              <input
                name="dispatchDate"
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
                required
              />
            </label>
            <label>
              Reason
              <select name="reason" defaultValue="Export">
                <option>Export</option>
                <option>Client collection</option>
                <option>Other</option>
              </select>
            </label>
            <label>
              Destination
              <input name="destination" required />
            </label>
            <label>
              Document reference
              <input
                name="documentsReference"
                placeholder="DOC-GEL-2026-0001"
                required
              />
            </label>
            <label>
              Weighbridge reference
              <input
                name="weighbridgeReference"
                placeholder="WB-OUT-0001"
                required
              />
            </label>
            <label className="wide">
              Notes
              <input name="notes" />
            </label>
          </div>
          <div className="section-title-row dispatch-lines-title">
            <h3>Dispatch lines</h3>
            <button
              type="button"
              className="table-action"
              disabled={!selectedClientId}
              onClick={() => setLines((current) => [...current, newLine()])}
            >
              <Plus size={13} />
              Add lot
            </button>
          </div>
          <div className="line-editor dispatch-line-editor">
            {lines.map((line, index) => {
              const lot = lotById.get(line.lotId);
              return (
                <article key={line.key}>
                  <div className="line-number">{index + 1}</div>
                  <label>
                    Available lot
                    <select
                      required
                      value={line.lotId}
                      onChange={(event) =>
                        selectLot(line.key, event.target.value)
                      }
                    >
                      <option value="" disabled>
                        Select lot
                      </option>
                      {eligibleLots.map((item) => (
                        <option
                          key={item.id}
                          value={item.id}
                          disabled={lines.some(
                            (other) =>
                              other.key !== line.key && other.lotId === item.id,
                          )}
                        >
                          {item.lot_number} -{" "}
                          {(
                            Number(item.quantity_kg) -
                            (reservedKg.get(item.id) ?? 0)
                          ).toLocaleString()}{" "}
                          kg free
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Bags
                    <input
                      type="number"
                      min="1"
                      max={
                        lot
                          ? Number(lot.bag_count) -
                            (reservedBags.get(lot.id) ?? 0)
                          : undefined
                      }
                      value={line.bagCount || ""}
                      onChange={(event) =>
                        updateLine(line.key, {
                          bagCount: Number(event.target.value),
                        })
                      }
                      required
                    />
                  </label>
                  <label>
                    Quantity kg
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      max={
                        lot
                          ? Number(lot.quantity_kg) -
                            (reservedKg.get(lot.id) ?? 0)
                          : undefined
                      }
                      value={line.quantityKg || ""}
                      onChange={(event) =>
                        updateLine(line.key, {
                          quantityKg: Number(event.target.value),
                        })
                      }
                      required
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-button"
                    title="Remove line"
                    aria-label={`Remove dispatch line ${index + 1}`}
                    disabled={lines.length === 1}
                    onClick={() =>
                      setLines((current) =>
                        current.filter((item) => item.key !== line.key),
                      )
                    }
                  >
                    <Minus size={14} />
                  </button>
                </article>
              );
            })}
          </div>
          <label className="credit-toggle">
            <input
              type="checkbox"
              checked={useCredit}
              onChange={(event) => setUseCredit(event.target.checked)}
            />
            <CreditCard size={16} />
            Request credit override if invoices are not paid
          </label>
          {useCredit && (
            <div className="credit-fields dispatch-credit-fields">
              <label>
                Amount ETB
                <input name="creditAmount" type="number" min="0.01" required />
              </label>
              <label>
                Expiry
                <input name="creditExpiry" type="date" required />
              </label>
              <label>
                Reason
                <input name="creditReason" required />
              </label>
              <label>
                Document reference
                <input name="creditDocumentReference" required />
              </label>
            </div>
          )}
          <footer>
            <button
              className="primary-button"
              type="submit"
              disabled={!selectedClientId || !representatives.length}
            >
              <PackageCheck size={16} />
              Create draft and reserve
            </button>
          </footer>
        </form>
      )}

      {tab === "Release readiness" &&
        (selectedDispatch ? (
          <div className="release-layout">
            <section className="release-checklist">
              <header>
                <PackageCheck size={20} />
                <div>
                  <h2>{selectedDispatch.dispatch_number}</h2>
                  <p>
                    {selectedClient?.legal_name} -{" "}
                    {Number(selectedDispatch.quantity_kg).toLocaleString()} kg -{" "}
                    {selectedDispatch.dispatch_reason}
                  </p>
                </div>
                <Status value={ready ? "READY" : "BLOCKED"} />
              </header>
              <div className="release-explainer">
                <strong>{readinessBlocked.length ? `${readinessBlocked.length} item${readinessBlocked.length === 1 ? "" : "s"} to fix` : "All release checks are complete"}</strong>
                <span>
                  {readinessPassed.length} of {readinessItems.length} checks ready. Only missing actions are shown below.
                </span>
              </div>
              <div className="dispatch-selector">
                <label>
                  Selected dispatch
                  <select
                    value={selectedDispatch.id}
                    onChange={(event) =>
                      setSelectedDispatchId(event.target.value)
                    }
                  >
                    {data?.dispatches.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.dispatch_number}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="readiness-grid">
                {readinessBlocked.map(({ key, label, passed }) => {
                    const help =
                      key === "stockReserved"
                        ? "Create a new dispatch with an available lot"
                        : key === "documentsReady"
                          ? "Add the document reference below"
                          : key === "weighbridgeReady"
                            ? "Add the weighbridge reference below"
                            : key === "approved"
                              ? "Complete the independent approval"
                              : key === "financeCleared"
                                ? "Record payment or approve credit"
                                : `Review ${label.toLowerCase()}`;
                    return (
                      <div
                        key={key}
                        className={passed ? "gate-pass" : "gate-block"}
                      >
                        {passed ? (
                          <Check size={15} />
                        ) : (
                          <AlertTriangle size={15} />
                        )}
                        <span>
                          <strong>{label}</strong>
                          <small>{passed ? "Ready" : help}</small>
                        </span>
                      </div>
                    );
                  })}
                {!readinessBlocked.length && <div className="gate-pass"><Check size={15} /><span><strong>Ready for release</strong><small>No missing checks</small></span></div>}
              </div>
              {!!readinessPassed.length && <details className="completed-readiness"><summary>Completed checks ({readinessPassed.length})</summary><div className="readiness-grid">{readinessPassed.map((item) => <div className="gate-pass" key={item.key}><Check size={15} /><span><strong>{item.label}</strong><small>Ready</small></span></div>)}</div></details>}
              {["DRAFT", "AWAITING_APPROVAL"].includes(
                selectedDispatch.status,
              ) && (
                <form className="readiness-fix-form" onSubmit={saveReadiness}>
                  <h3>Fix missing document information</h3>
                  <div className="form-grid compact">
                    <label>
                      Dispatch document reference
                      <input
                        name="documentReference"
                        defaultValue={
                          selectedDispatch.documents_reference ?? ""
                        }
                        placeholder="DOC-GEL-2026-0001"
                      />
                    </label>
                    <label>
                      Weighbridge reference
                      <input
                        name="weighbridgeReference"
                        defaultValue={
                          selectedDispatch.weighbridge_reference ?? ""
                        }
                        placeholder="WB-OUT-0001"
                      />
                    </label>
                    <label className="wide">
                      Notes
                      <input
                        name="notes"
                        defaultValue={selectedDispatch.notes ?? ""}
                      />
                    </label>
                  </div>
                  <button className="secondary-button" type="submit">
                    <Save size={15} />
                    Save missing information
                  </button>
                </form>
              )}
              {selectedCredit && (
                <div className="credit-panel">
                  <CreditCard size={18} />
                  <div>
                    <strong>Credit override: {selectedCredit.status}</strong>
                    <p>
                      ETB {Number(selectedCredit.amount_etb).toLocaleString()}{" "}
                      until {selectedCredit.expires_on} -{" "}
                      {selectedCredit.document_reference}
                    </p>
                  </div>
                  {selectedCredit.status === "PENDING" && (
                    <span className="request-actions">
                      <button
                        type="button"
                        onClick={() => decideCredit("APPROVED")}
                      >
                        Approve
                      </button>
                      <button
                        className="reject"
                        type="button"
                        onClick={() => decideCredit("REJECTED")}
                      >
                        Reject
                      </button>
                    </span>
                  )}
                </div>
              )}
              <div className="release-actions">
                {selectedDispatch.status === "DRAFT" && (
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => advanceDispatch("submit_dispatch")}
                  >
                    Submit for approval <ArrowRight size={14} />
                  </button>
                )}
                {selectedDispatch.status === "AWAITING_APPROVAL" && (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={
                      !gates?.agreementActive ||
                      !gates?.representativeValid ||
                      !gates?.stockReserved ||
                      !gates?.documentsReady ||
                      !gates?.financeCleared ||
                      !gates?.noHold ||
                      !gates?.weighbridgeReady
                    }
                    onClick={() => advanceDispatch("approve_dispatch")}
                  >
                    <ShieldCheck size={15} />
                    Approve dispatch
                  </button>
                )}
                {selectedDispatch.status === "APPROVED" && (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!ready}
                    onClick={() => advanceDispatch("post_dispatch_v2")}
                  >
                    <Truck size={15} />
                    Post dispatch
                  </button>
                )}
                {selectedDispatch.status === "POSTED" && (
                  <Status value="POSTED" />
                )}
              </div>
            </section>
            <aside className={`release-score ${ready ? "ready" : "blocked"}`}>
              <div>
                {ready ? <Check size={30} /> : <AlertTriangle size={30} />}
                <strong>
                  {ready ? "Ready for release" : "Release blocked"}
                </strong>
                <span>
                  {Object.values(gates ?? {}).filter((value) => !value).length}{" "}
                  item(s) remain.
                </span>
              </div>
              <dl>
                <div>
                  <dt>Reserved lines</dt>
                  <dd>{selectedLines.length}</dd>
                </div>
                <div>
                  <dt>Document</dt>
                  <dd>{selectedDispatch.documents_reference ?? "Missing"}</dd>
                </div>
                <div>
                  <dt>Prepared by</dt>
                  <dd>
                    {profileById.get(selectedDispatch.prepared_by) ?? "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt>Approved by</dt>
                  <dd>
                    {selectedDispatch.approved_by
                      ? profileById.get(selectedDispatch.approved_by)
                      : "Pending"}
                  </dd>
                </div>
              </dl>
            </aside>
          </div>
        ) : (
          <Empty
            title="No dispatch record"
            copy="Create a dispatch draft first."
          />
        ))}

      {tab === "Dispatches" && (
        <section className="record-panel">
          <div className="record-table dispatch-cols">
            <div className="table-head">
              <span>Dispatch</span>
              <span>Client</span>
              <span>Lots</span>
              <span>Destination</span>
              <span>Quantity</span>
              <span>Status</span>
            </div>
            {(data?.dispatches ?? []).map((item: DispatchRow) => (
              <div key={item.id} onClick={() => setSelectedDispatchId(item.id)}>
                <span className="reference">
                  {item.dispatch_number}
                  <small>{item.dispatch_date}</small>
                </span>
                <span>{clientById.get(item.client_id) ?? "Unknown"}</span>
                <span>
                  {data?.lines
                    .filter((line) => line.dispatch_id === item.id)
                    .map((line) => lotById.get(line.lot_id)?.lot_number)
                    .join(", ") || lotById.get(item.lot_id)?.lot_number}
                </span>
                <span>{item.destination ?? "-"}</span>
                <span>
                  {Number(item.quantity_kg).toLocaleString()} kg
                  <small>{item.bag_count} bags</small>
                </span>
                <span>
                  <Status value={item.status} />
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "ECX transfers" && (
        <div className="ecx-workspace">
          <form className="operation-form ecx-send-form" onSubmit={sendEcx}>
            <header>
              <div>
                <span className="demo-label">ECX WAREHOUSE TRANSFER</span>
                <h2>Send coffee to the ECX warehouse</h2>
                <p>
                  Step 1 records departure. Step 2 records destination receipt.
                  The client remains the owner throughout.
                </p>
              </div>
            </header>
            <div className="form-grid compact">
              <label>
                Source lot
                <select
                  required
                  value={ecxLotId}
                  onChange={(event) => {
                    const lot = lotById.get(event.target.value);
                    setEcxLotId(event.target.value);
                    setEcxSentKg(Number(lot?.quantity_kg ?? 0));
                  }}
                >
                  <option value="" disabled>
                    Select transferable lot
                  </option>
                  {lots
                    .filter(
                      (item) =>
                        Number(item.quantity_kg) > 0 &&
                        ![
                          "CLOSED",
                          "DISPATCHED",
                          "REVERSED",
                          "IN_PROCESS",
                          "IN_TRANSIT",
                        ].includes(item.status),
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.lot_number} - {clientById.get(item.client_id)} -{" "}
                        {Number(item.quantity_kg).toLocaleString()} kg
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Destination warehouse
                <select
                  required
                  value={ecxDestinationWarehouseId}
                  onChange={(event) =>
                    setEcxDestinationWarehouseId(event.target.value)
                  }
                >
                  <option value="" disabled>
                    Select destination
                  </option>
                  {(data?.warehouses ?? [])
                    .filter(
                      (item) => item.id !== lotById.get(ecxLotId)?.warehouse_id,
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} - {item.location}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Weight to send (kg)
                <input
                  type="number"
                  min="0.01"
                  max={Number(lotById.get(ecxLotId)?.quantity_kg ?? 0)}
                  step="0.01"
                  required
                  value={ecxSentKg || ""}
                  onChange={(event) => setEcxSentKg(Number(event.target.value))}
                />
              </label>
              <label>
                Vehicle plate
                <input
                  required
                  value={ecxVehiclePlate}
                  onChange={(event) => setEcxVehiclePlate(event.target.value)}
                />
              </label>
              <label>
                ECX / transport reference
                <input required value={ecxTransferReference} onChange={(event) => setEcxTransferReference(event.target.value)} placeholder="ECX or transport reference" />
              </label>
              <label>
                Driver name
                <input value={ecxDriverName} onChange={(event) => setEcxDriverName(event.target.value)} />
              </label>
              <label>
                Seal number
                <input value={ecxSealNumber} onChange={(event) => setEcxSealNumber(event.target.value)} />
              </label>
              <label>
                Expected arrival
                <input type="date" value={ecxExpectedArrivalOn} onChange={(event) => setEcxExpectedArrivalOn(event.target.value)} />
              </label>
              <label className="wide">
                Departure document reference
                <input required value={ecxDepartureDocument} onChange={(event) => setEcxDepartureDocument(event.target.value)} placeholder="Waybill, gate pass, or ECX dispatch document" />
              </label>
            </div>
            <footer>
              <button
                className="primary-button"
                type="submit"
                disabled={
                  !ecxLotId || !ecxDestinationWarehouseId || ecxSentKg <= 0 || !ecxVehiclePlate.trim() || !ecxTransferReference.trim() || !ecxDepartureDocument.trim()
                }
              >
                <Truck size={16} />
                1. Post transfer departure
              </button>
            </footer>
          </form>
          <section className="record-panel ecx-transfer-list">
            <header>
              <div>
                <h2>Transfers</h2>
                <p>
                  Select an in-transit transfer to record its destination
                  receipt.
                </p>
              </div>
            </header>
            <div className="record-table five-cols">
              <div className="table-head">
                <span>Transfer</span>
                <span>Client / lot</span>
                <span>Route</span>
                <span>Weight</span>
                <span>Status</span>
              </div>
              {(data?.ecxTransfers ?? []).map((item) => (
                <button
                  className="lot-table-row"
                  type="button"
                  key={item.id}
                  onClick={() => {
                    setSelectedEcxId(item.id);
                    setEcxReceivedKg(0);
                    setEcxDestinationSection("");
                    setEcxVarianceApproverId("");
                    setEcxDestinationDocument("");
                  }}
                >
                  <span className="reference">
                    {item.transfer_number}
                    <small>{new Date(item.sent_at).toLocaleString()}</small>
                  </span>
                  <span>
                    {clientById.get(item.client_id)}
                    <small>{lotById.get(item.lot_id)?.lot_number}</small>
                  </span>
                  <span>
                    {warehouseById.get(item.source_warehouse_id)?.name}
                    <small>
                      to{" "}
                      {warehouseById.get(item.destination_warehouse_id)?.name}
                    </small>
                  </span>
                  <span>
                    {Number(item.sent_kg).toLocaleString()} kg
                    <small>{item.sent_bags ?? "-"} bags</small>
                  </span>
                  <span>
                    <Status value={item.status} />
                  </span>
                </button>
              ))}
            </div>
            {!data?.ecxTransfers.length && (
              <p className="empty-result">
                No ECX transfers have been recorded.
              </p>
            )}
          </section>
          {selectedEcx && (
            <div className="ecs-layout">
              <section className="ecs-route">
                <div>
                  <span>Source</span>
                  <strong>
                    {selectedEcxSource?.name ?? "Unknown warehouse"}
                  </strong>
                  <small>
                    {Number(selectedEcx.sent_kg).toLocaleString()} kg sent from{" "}
                    {ecxSourceLot?.lot_number}
                  </small>
                </div>
                <div className="transit-line">
                  <Truck size={22} />
                  <Status value={selectedEcx.status} />
                </div>
                <div>
                  <span>Destination</span>
                  <strong>
                    {selectedEcxDestination?.name ?? "Unknown warehouse"}
                  </strong>
                  <small>Owner remains {ecxClient?.legal_name}</small>
                </div>
              </section>
              <section className="ecs-receipt">
                <h2>Destination receipt</h2>
                <label>
                  Received weight (kg)
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={effectiveEcxReceivedKg || ""}
                    disabled={selectedEcx.status !== "IN_TRANSIT"}
                    onChange={(event) =>
                      setEcxReceivedKg(Number(event.target.value))
                    }
                  />
                </label>
                <label>
                  Destination section
                  <input
                    value={ecxDestinationSection}
                    disabled={selectedEcx.status !== "IN_TRANSIT"}
                    onChange={(event) =>
                      setEcxDestinationSection(event.target.value)
                    }
                    placeholder="ECX receiving section"
                  />
                </label>
                <label>
                  Destination receipt reference
                  <input value={selectedEcx.destination_document_reference ?? ecxDestinationDocument} disabled={selectedEcx.status !== "IN_TRANSIT"} onChange={(event) => setEcxDestinationDocument(event.target.value)} placeholder="ECX receipt, scale ticket, or gate entry" />
                </label>
                {ecxResult && (
                  <div
                    className={`rule-result ${Math.abs(ecxResult.varianceKg) <= 0.01 ? "good" : "bad"}`}
                  >
                    <span>Quantity variance</span>
                    <strong>{ecxResult.varianceKg.toLocaleString()} kg</strong>
                    <small>Client ownership never changes</small>
                  </div>
                )}
                {ecxResult && Math.abs(ecxResult.varianceKg) > 0.01 && (
                  <label>
                    Independent variance approver
                    <select
                      required
                      value={ecxVarianceApproverId}
                      onChange={(event) =>
                        setEcxVarianceApproverId(event.target.value)
                      }
                    >
                      <option value="" disabled>
                        Select independent manager
                      </option>
                      {ecxVarianceApprovers.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.full_name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  className="primary-button"
                  type="button"
                  disabled={
                    selectedEcx.status !== "IN_TRANSIT" ||
                    !ecxResult?.valid ||
                    !ecxDestinationSection.trim() || !ecxDestinationDocument.trim()
                  }
                  onClick={receiveEcx}
                >
                  <ClipboardCheck size={16} />
                  {selectedEcx.status === "RECEIVED"
                    ? "Receipt already posted"
                    : "2. Post destination receipt"}
                </button>
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
