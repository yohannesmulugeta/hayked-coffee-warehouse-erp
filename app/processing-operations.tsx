"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock3,
  Factory,
  FileCheck2,
  Minus,
  PackageCheck,
  Pencil,
  Plus,
  Scale,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  ThumbsUp,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  evaluateOutputCompletion,
  validateProcessingRequest,
  validateProcessingRequestLines,
  type CoffeeProcessingType,
  type ProcessingCertification,
  type ProcessingOutputCategory,
  type ProcessingOutputLine,
  type ProcessingRequest,
  type ProcessingRequestLine,
} from "./processing-workflow";
import {
  approveProcessingRequest,
  completeProcessingOrder,
  createProcessingRequest,
  listEligibleProcessingLots,
  loadProcessingData,
  queueApprovedProcessingRequest,
  rejectProcessingRequest,
  saveEcxCheck,
  startProcessingOrder,
  submitProcessingRequest,
  type EcxCheckRow,
  type ProcessingData,
  type EligibleProcessingLot,
} from "@/lib/erp-data";
import type { ProcessingStateFilter } from "./ux-rules";
import { canPerformProcessingAction, normalizeAppRole } from "./role-permissions";
import {
  DetailGrid,
  EvidenceUploader,
  RecordDetailDrawer,
  WorkflowGuide,
} from "./workflow-ui";

type Tab =
  | "Requests"
  | "Queue"
  | "Active Orders"
  | "Intake"
  | "Completion"
  | "Output Lots"
  | "Exceptions";
type QueueItem = {
  databaseId: string;
  id: string;
  position: number;
  client: string;
  lot: string;
  coffeeType: CoffeeProcessingType;
  grade: string;
  inputBags: number;
  inputKg: number;
  received: string;
  readiness: "READY" | "BLOCKED";
  note: string;
};
type Order = QueueItem & {
  status: "IN_PROCESS" | "COMPLETED";
  completionNumber: string | null;
  machine: string;
  startedAt: string | null;
};
type SourceType = EligibleProcessingLot["source_type"];
type RequestLineDraft = {
  key: number;
  lot: EligibleProcessingLot;
  requestedBags: number;
  requestedKg: number;
};

const certifications: ProcessingCertification[] = [
  "Organic",
  "RFA",
  "C.A.F.E",
  "Non-certified",
  "Fairtrade",
  "Other",
];
const outputCategories: { value: ProcessingOutputCategory; label: string }[] = [
  { value: "ACCEPTED_CLIENT_COFFEE", label: "Accepted client coffee" },
  { value: "CLIENT_REJECT", label: "Client reject" },
  { value: "HAYKED_BYPRODUCT", label: "Hayked byproduct" },
  { value: "REWORK", label: "Rework" },
  { value: "PROCESS_LOSS", label: "Process loss" },
];
let rowKey = 1;
const newOutputLine = (
  category: ProcessingOutputCategory,
  kg = 0,
): ProcessingOutputLine => ({
  category,
  coffeeType: "WASHED",
  grade: "",
  preparation: "",
  bagCount: 0,
  bagWeightKg: null,
  quantityKg: kg,
  warehouseSection: "",
  certifications: [],
  weighingReference: "",
  evidencePath: "",
  reason: "",
});
const sourceTypeLabels: Record<SourceType, string> = {
  ARRIVAL: "Arrival",
  REJECT: "Reject",
  PROCESSED: "Processed",
};

function Status({ value }: { value: string }) {
  return (
    <span className={`status-pill ${value.toLowerCase().replaceAll("_", "-")}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <section className="empty-operation">
      <Factory size={24} />
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  );
}

function AddInputLotDialog({
  clientId,
  selectedLotIds,
  initialLine,
  onSave,
  onClose,
}: {
  clientId: string;
  selectedLotIds: string[];
  initialLine?: RequestLineDraft;
  onSave: (
    lot: EligibleProcessingLot,
    requestedKg: number,
    requestedBags: number,
  ) => void;
  onClose: () => void;
}) {
  const [sourceType, setSourceType] = useState<SourceType | null>(
    initialLine?.lot.source_type ?? null,
  );
  const [search, setSearch] = useState("");
  const [lots, setLots] = useState<EligibleProcessingLot[]>([]);
  const [selectedLot, setSelectedLot] = useState<EligibleProcessingLot | null>(
    initialLine?.lot ?? null,
  );
  const [requestedKg, setRequestedKg] = useState(initialLine?.requestedKg ?? 0);
  const [requestedBags, setRequestedBags] = useState(
    initialLine?.requestedBags ?? 0,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!sourceType) return;
    let canceled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void listEligibleProcessingLots(clientId, sourceType, search, 10)
        .then((result) => {
          if (!canceled) setLots(result);
        })
        .catch((reason: unknown) => {
          if (!canceled)
            setError(
              reason instanceof Error
                ? reason.message
                : "Eligible lots could not be loaded.",
            );
        })
        .finally(() => {
          if (!canceled) setLoading(false);
        });
    }, 200);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [clientId, search, sourceType]);

  function chooseLot(lot: EligibleProcessingLot) {
    if (selectedLotIds.includes(lot.lot_id)) {
      setError(
        `${lot.lot_number} has already been added. Edit its existing quantity instead.`,
      );
      return;
    }
    setSelectedLot(lot);
    setRequestedKg(0);
    setRequestedBags(0);
    setError("");
  }

  function save() {
    if (!selectedLot) {
      setError("Select an eligible coffee lot.");
      return;
    }
    if (requestedKg <= 0 || requestedKg > selectedLot.available_kg) {
      setError(
        `Enter a quantity up to ${selectedLot.available_kg.toLocaleString()} kg.`,
      );
      return;
    }
    if (requestedBags <= 0 || requestedBags > selectedLot.available_bags) {
      setError(
        `Enter bags up to ${selectedLot.available_bags.toLocaleString()}.`,
      );
      return;
    }
    onSave(selectedLot, requestedKg, requestedBags);
  }

  return (
    <div className="modal-backdrop">
      <section
        className="receipt-modal input-lot-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-input-lot-title"
      >
        <header>
          <div>
            <span className="demo-label">PROCESSING INPUT</span>
            <h2 id="add-input-lot-title">
              {initialLine ? "Edit input lot" : "Add input lot"}
            </h2>
            <p>Choose the coffee source first, then select an eligible lot.</p>
          </div>
          <button
            type="button"
            aria-label="Close input lot dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {!sourceType ? (
          <section className="source-type-step">
            <h3>1. Select source type</h3>
            <div className="source-type-options">
              {(["ARRIVAL", "REJECT", "PROCESSED"] as SourceType[]).map(
                (type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setSourceType(type)}
                  >
                    <PackageCheck size={20} />
                    <strong>{sourceTypeLabels[type]}</strong>
                    <small>
                      {type === "ARRIVAL"
                        ? "Received through a GRN"
                        : `Created by processing as ${sourceTypeLabels[type].toLowerCase()} coffee`}
                    </small>
                  </button>
                ),
              )}
            </div>
          </section>
        ) : (
          <>
            <section className="lot-picker-toolbar">
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setSourceType(null);
                  setSelectedLot(null);
                }}
              >
                Change source type
              </button>
              <label>
                <Search size={15} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={`Search ${sourceTypeLabels[sourceType].toLowerCase()} lots`}
                />
              </label>
            </section>
            <section className="candidate-lots" aria-busy={loading}>
              <h3>2. Select eligible {sourceTypeLabels[sourceType]} lot</h3>
              {loading && (
                <p className="muted">Loading recent eligible lots…</p>
              )}
              {!loading &&
                lots.map((lot) => {
                  const duplicate = selectedLotIds.includes(lot.lot_id);
                  return (
                    <button
                      className={
                        selectedLot?.lot_id === lot.lot_id ? "selected" : ""
                      }
                      type="button"
                      key={lot.lot_id}
                      onClick={() => chooseLot(lot)}
                      disabled={duplicate}
                    >
                      <span>
                        <strong>{lot.lot_number}</strong>
                        <small>{lot.client_name}</small>
                      </span>
                      <span>
                        <strong>{lot.available_kg.toLocaleString()} kg</strong>
                        <small>
                          {lot.available_bags.toLocaleString()} bags available
                        </small>
                      </span>
                      <span>
                        <strong>
                          {lot.source_document ?? "No source number"}
                        </strong>
                        <small>
                          {lot.origin ?? "Origin not recorded"} · {lot.grade}
                        </small>
                      </span>
                      {duplicate && <em>Already added</em>}
                    </button>
                  );
                })}
              {!loading && lots.length === 0 && !error && (
                <p className="muted">
                  No matching eligible lots are available.
                </p>
              )}
            </section>
            {selectedLot && (
              <section className="selected-lot-quantity">
                <h3>3. Quantity to process</h3>
                <div className="selected-lot-summary">
                  <strong>{selectedLot.lot_number}</strong>
                  <span>
                    {sourceTypeLabels[selectedLot.source_type]} ·{" "}
                    {selectedLot.source_document ?? "No source number"}
                  </span>
                  <span>
                    Physical {selectedLot.quantity_kg.toLocaleString()} kg ·
                    Reserved {selectedLot.reserved_kg.toLocaleString()} kg ·
                    Available {selectedLot.available_kg.toLocaleString()} kg
                  </span>
                </div>
                <div className="form-grid compact">
                  <label>
                    Quantity to process (kg)
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      max={selectedLot.available_kg}
                      value={requestedKg || ""}
                      onChange={(event) =>
                        setRequestedKg(Number(event.target.value))
                      }
                    />
                  </label>
                  <label>
                    Bags to issue
                    <input
                      type="number"
                      min="1"
                      step="1"
                      max={selectedLot.available_bags}
                      value={requestedBags || ""}
                      onChange={(event) =>
                        setRequestedBags(Number(event.target.value))
                      }
                    />
                  </label>
                </div>
              </section>
            )}
          </>
        )}
        {error && (
          <div className="request-form-error" role="alert">
            <AlertTriangle size={15} />
            {error}
          </div>
        )}
        <footer>
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={!selectedLot}
            onClick={save}
          >
            {initialLine ? "Update input" : "Add input lot"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ProcessingOrderDetail({
  data,
  orderId,
  onClose,
}: {
  data: ProcessingData;
  orderId: string;
  onClose: () => void;
}) {
  const order = data.orders.find((item) => item.id === orderId);
  if (!order) return null;
  const request = order.request_id
    ? data.requests.find((item) => item.id === order.request_id)
    : undefined;
  const client = data.clients.find((item) => item.id === order.client_id);
  const inputs = data.orderInputs.filter((item) => item.order_id === orderId);
  const outputs = data.outputs.filter((item) => item.order_id === orderId);
  const inputById = new Map(inputs.map((item) => [item.id, item]));
  const lotById = new Map(data.lots.map((item) => [item.id, item]));
  const outputSources = new Map(
    outputs.map((output) => [
      output.id,
      data.outputSources
        .filter((source) => source.output_id === output.id)
        .map((source) => inputById.get(source.input_id))
        .filter(Boolean),
    ]),
  );
  return (
    <div className="modal-backdrop">
      <section
        className="receipt-modal processing-order-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="processing-order-detail-title"
      >
        <header>
          <div>
            <span className="demo-label">TRACEABLE PROCESSING</span>
            <h2 id="processing-order-detail-title">{order.order_number}</h2>
            <p>
              {client?.legal_name ?? "Unknown client"} ·{" "}
              {order.status.replaceAll("_", " ")}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close processing order details"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <section>
          <h3>Inputs</h3>
          <div className="traceability-table">
            <div>
              <strong>Type</strong>
              <strong>Lot</strong>
              <strong>Source</strong>
              <strong>Quantity used</strong>
            </div>
            {inputs.map((input) => {
              const lot = lotById.get(input.lot_id);
              const receipt = data.receipts.find(
                (item) => item.id === lot?.receipt_id,
              );
              return (
                <div key={input.id}>
                  <span>
                    {lot?.lot_category === "ARRIVAL"
                      ? "Arrival"
                      : lot?.lot_category === "CLIENT_REJECT"
                        ? "Reject"
                        : "Processed"}
                  </span>
                  <span className="reference">
                    {lot?.lot_number ?? input.lot_id}
                  </span>
                  <span>
                    {lot?.source_processing_order_id
                      ? data.orders.find(
                          (item) => item.id === lot.source_processing_order_id,
                        )?.order_number
                      : (receipt?.receipt_number ?? "-")}
                  </span>
                  <span>
                    {Number(input.input_kg).toLocaleString()} kg /{" "}
                    {input.input_bags} bags
                  </span>
                </div>
              );
            })}
          </div>
        </section>
        <section>
          <h3>Outputs</h3>
          <div className="traceability-table">
            <div>
              <strong>Type</strong>
              <strong>Lot</strong>
              <strong>Quantity</strong>
              <strong>Source lots</strong>
            </div>
            {outputs.map((output) => {
              const child = lotById.get(output.child_lot_id ?? "");
              const sources = outputSources.get(output.id) ?? [];
              return (
                <div key={output.id}>
                  <span>
                    {output.category === "ACCEPTED_CLIENT_COFFEE"
                      ? "Processed"
                      : output.category === "CLIENT_REJECT"
                        ? "Reject"
                        : output.category.replaceAll("_", " ")}
                  </span>
                  <span className="reference">
                    {child?.lot_number ?? "No reusable lot"}
                  </span>
                  <span>{Number(output.quantity_kg).toLocaleString()} kg</span>
                  <span>
                    {sources
                      .map((source) => lotById.get(source!.lot_id)?.lot_number)
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
        <section className="processing-detail-summary">
          <h3>Processing summary</h3>
          <dl>
            <div>
              <dt>Total input</dt>
              <dd>{Number(order.input_kg).toLocaleString()} kg</dd>
            </div>
            <div>
              <dt>Processed/rework</dt>
              <dd>{Number(order.accepted_client_kg).toLocaleString()} kg</dd>
            </div>
            <div>
              <dt>Reject</dt>
              <dd>{Number(order.client_reject_kg).toLocaleString()} kg</dd>
            </div>
            <div>
              <dt>Loss</dt>
              <dd>{Number(order.process_loss_kg).toLocaleString()} kg</dd>
            </div>
            <div>
              <dt>Reusable yield</dt>
              <dd>
                {Number(order.input_kg) > 0
                  ? (
                      ((Number(order.accepted_client_kg) +
                        Number(order.client_reject_kg)) /
                        Number(order.input_kg)) *
                      100
                    ).toFixed(2)
                  : "0.00"}
                %
              </dd>
            </div>
          </dl>
        </section>
        <section className="processing-file-timeline">
          <h3>Files for this processing journey</h3>
          <p>
            Request, intake and completion evidence stay connected to this
            order.
          </p>
          {request && (
            <EvidenceUploader
              reference={{
                type: "PROCESSING_REQUEST",
                id: request.id,
                label: request.requestNumber ?? request.id,
              }}
              documentType="PROCESSING_REQUEST"
              label="1. Request document"
              help="Client request, paper note, PDF or photo."
            />
          )}
          <EvidenceUploader
            reference={{
              type: "PROCESSING_ORDER",
              id: order.id,
              label: order.order_number,
            }}
            documentType="PROCESSING_INTAKE"
            label="2. Intake evidence"
            help="Scale ticket, warehouse issue, or machine intake evidence."
          />
          {order.status === "POSTED" && (
            <EvidenceUploader
              reference={{
                type: "PROCESSING_ORDER",
                id: order.id,
                label: order.completion_number ?? order.order_number,
              }}
              documentType="PROCESSING_COMPLETION"
              label="3. Completion evidence"
              help="Output weighing sheets, reconciliation and exception evidence."
            />
          )}
        </section>
        <footer>
          <button className="secondary-button" type="button" onClick={onClose}>
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}

function ProcessingRequestDetail({
  request,
  check,
  canDecide,
  decisionBlockedReason,
  onDecision,
  onSaved,
  onClose,
}: {
  request: ProcessingRequest;
  check?: EcxCheckRow;
  canDecide: boolean;
  decisionBlockedReason: string;
  onDecision: (decision: "APPROVED" | "REJECTED") => Promise<void>;
  onSaved: (message: string) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionError, setDecisionError] = useState("");
  const [error, setError] = useState("");
  const [savedCheck, setSavedCheck] = useState(check);
  async function decide(decision: "APPROVED" | "REJECTED") {
    setDecisionBusy(true);
    setDecisionError("");
    try {
      await onDecision(decision);
    } catch (caught) {
      setDecisionError(
        caught instanceof Error ? caught.message : "The approval decision failed.",
      );
    } finally {
      setDecisionBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const saved = await saveEcxCheck({
        id: savedCheck?.id,
        processingRequestId: request.id,
        checkedOn: String(form.get("checkedOn")),
        result: String(form.get("result")) as EcxCheckRow["result"],
        referenceNumber: String(form.get("referenceNumber") ?? ""),
        inspectorName: String(form.get("inspectorName") ?? ""),
        notes: String(form.get("notes") ?? ""),
      });
      setSavedCheck(saved);
      await onSaved(
        `${saved.check_number} saved. ECX status is now ${saved.result.replaceAll("_", " ").toLowerCase()}.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The ECX check could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <RecordDetailDrawer
      open
      eyebrow="PROCESSING REQUEST"
      title={request.requestNumber ?? request.id}
      subtitle={`${request.client} · Paper note ${request.noteNumber}`}
      status={<Status value={request.status} />}
      onClose={onClose}
    >
      <DetailGrid
        items={[
          { label: "Request date", value: request.requestDate },
          { label: "Coffee lot", value: request.lot },
          {
            label: "Quantity",
            value: `${request.requestedKg.toLocaleString()} kg / ${request.requestedBags} bags`,
          },
          { label: "Preparation", value: request.preparationType },
          { label: "Requested by", value: request.requester },
          { label: "Approver", value: request.approver },
        ]}
      />
      {request.notes && <p className="drawer-explainer">{request.notes}</p>}
      {request.status === "SUBMITTED" && (
        <section className="processing-request-decision">
          <div>
            <strong>Waiting for approval</strong>
            <small>Review the request and optional attachments before deciding.</small>
          </div>
          {canDecide ? (
            <div className="processing-decision-actions">
              <button
                className="secondary-button reject"
                type="button"
                disabled={decisionBusy}
                onClick={() => void decide("REJECTED")}
              >
                Reject Request
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={decisionBusy}
                onClick={() => void decide("APPROVED")}
              >
                <ThumbsUp size={16} />
                Approve Request
              </button>
            </div>
          ) : (
            <span className="muted-action">{decisionBlockedReason}</span>
          )}
          {decisionError && (
            <p className="request-form-error" role="alert">{decisionError}</p>
          )}
        </section>
      )}
      <EvidenceUploader
        reference={{
          type: "PROCESSING_REQUEST",
          id: request.id,
          label: request.requestNumber ?? request.id,
        }}
        documentType="PROCESSING_REQUEST"
        label="Optional request attachment"
        help="Attachments are optional. Add a signed request, paper note, PDF, or photo when available."
      />
      <details className="optional-ecx-section">
        <summary>
          <span>
            <strong>Optional ECX information</strong>
            <small>ECX does not block approval or processing.</small>
          </span>
          {savedCheck && <Status value={savedCheck.result} />}
        </summary>
        <form className="drawer-form" onSubmit={submit}>
          <label>
            Check date
            <input
              name="checkedOn"
              type="date"
              required
              defaultValue={
                savedCheck?.checked_on ?? new Date().toISOString().slice(0, 10)
              }
            />
          </label>
          <label>
            Result
            <select name="result" defaultValue={savedCheck?.result ?? "PENDING"}>
              <option value="PENDING">Pending</option>
              <option value="PASSED">Passed</option>
              <option value="FAILED">Failed</option>
              <option value="NOT_REQUIRED">Not required</option>
            </select>
          </label>
          <label>
            ECX reference
            <input
              name="referenceNumber"
              defaultValue={savedCheck?.reference_number ?? ""}
              placeholder="ECX reference or certificate"
            />
          </label>
          <label>
            Inspector / checker
            <input name="inspectorName" defaultValue={savedCheck?.inspector_name ?? ""} />
          </label>
          <label className="wide">
            Notes
            <textarea name="notes" rows={3} defaultValue={savedCheck?.notes ?? ""} />
          </label>
          {error && <p className="request-form-error wide" role="alert">{error}</p>}
          <button className="secondary-button wide" type="submit" disabled={busy}>
            <FileCheck2 size={16} />
            {busy ? "Saving..." : savedCheck ? "Update optional ECX" : "Save optional ECX"}
          </button>
        </form>
        <EvidenceUploader
          reference={
            savedCheck
              ? { type: "ECX_CHECK", id: savedCheck.id, label: savedCheck.check_number }
              : undefined
          }
          documentType="ECX_CHECK_EVIDENCE"
          label="Optional ECX attachment"
          help="Add supporting ECX evidence only when it exists."
        />
      </details>
    </RecordDetailDrawer>
  );
}

export function ProcessingOperations({
  initialState = "All",
  role = "viewer",
  userId = "",
}: {
  initialState?: ProcessingStateFilter;
  role?: string;
  userId?: string;
}) {
  const [tab, setTab] = useState<Tab>("Requests");
  const [stateFilter, setStateFilter] =
    useState<ProcessingStateFilter>(initialState);
  const [data, setData] = useState<ProcessingData | null>(null);
  const [requestFormOpen, setRequestFormOpen] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [processingPurpose, setProcessingPurpose] =
    useState("Export preparation");
  const [requestLines, setRequestLines] = useState<RequestLineDraft[]>([]);
  const [inputPickerOpen, setInputPickerOpen] = useState(false);
  const [editingInputKey, setEditingInputKey] = useState<number | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [detailOrderId, setDetailOrderId] = useState("");
  const [requestDetailId, setRequestDetailId] = useState("");
  const [outputLines, setOutputLines] = useState<ProcessingOutputLine[]>([]);
  const [exceptionApproved, setExceptionApproved] = useState(false);
  const [evidencePath, setEvidencePath] = useState("");
  const [message, setMessage] = useState("");
  const [databaseError, setDatabaseError] = useState("");
  const canCreate = canPerformProcessingAction(role, "create");
  const canApprove = canPerformProcessingAction(role, "approve");
  const canQueue = canPerformProcessingAction(role, "queue");
  const canStart = canPerformProcessingAction(role, "start");
  const canComplete = canPerformProcessingAction(role, "complete");

  const clients = useMemo(() => data?.clients ?? [], [data?.clients]);
  const lots = useMemo(() => data?.lots ?? [], [data?.lots]);
  const requests = useMemo(() => data?.requests ?? [], [data?.requests]);
  const staff = useMemo(
    () => data?.profiles.filter((item) => item.active) ?? [],
    [data?.profiles],
  );
  const selectedClient = clients.find((item) => item.id === selectedClientId);
  const lotById = new Map(lots.map((item) => [item.id, item]));
  const clientById = new Map(clients.map((item) => [item.id, item.legal_name]));
  const requestById = new Map(requests.map((item) => [item.id, item]));
  const intakeByOrder = new Map(
    (data?.intakes ?? []).map((item) => [item.order_id, item]),
  );
  const inputByOrder = new Map<string, number>();
  (data?.orderInputs ?? []).forEach((item) =>
    inputByOrder.set(
      item.order_id,
      (inputByOrder.get(item.order_id) ?? 0) + item.input_bags,
    ),
  );

  const queue: QueueItem[] = (data?.orders ?? [])
    .filter((item) => ["QUEUED", "BLOCKED"].includes(item.status))
    .sort((a, b) => a.queue_position - b.queue_position)
    .map((item) => {
      const request = item.request_id
        ? requestById.get(item.request_id)
        : undefined;
      const inputs =
        data?.orderInputs.filter((input) => input.order_id === item.id) ?? [];
      const reservations =
        data?.reservations.filter(
          (reservation) =>
            reservation.processing_order_id === item.id &&
            reservation.status === "ACTIVE",
        ) ?? [];
      const blocked =
        item.status === "BLOCKED" ||
        inputs.length === 0 ||
        inputs.some(
          (input) =>
            !reservations.some(
              (reservation) =>
                reservation.lot_id === input.lot_id &&
                Number(reservation.reserved_kg) === Number(input.input_kg) &&
                reservation.reserved_bags === input.input_bags,
            ),
        );
      const inputLots = inputs
        .map((input) => lotById.get(input.lot_id)?.lot_number ?? input.lot_id)
        .join(", ");
      const primaryLot = lotById.get(inputs[0]?.lot_id ?? item.lot_id);
      return {
        databaseId: item.id,
        id: item.order_number,
        position: item.queue_position,
        client: clientById.get(item.client_id) ?? "Unknown client",
        lot: inputLots || "No source lots",
        coffeeType:
          primaryLot?.coffee_type === "WASHED" ? "Washed" : "Unwashed / UG",
        grade: request?.grade ?? "-",
        inputBags: inputByOrder.get(item.id) ?? 0,
        inputKg: Number(item.input_kg),
        received: request?.requestDate ?? "-",
        readiness: blocked ? "BLOCKED" : "READY",
        note: blocked
          ? "Processing reservations need review"
          : request
            ? `${inputs.length} source lot(s) · ${request.preparationType}`
            : "Approved processing order",
      };
    });
  const orders: Order[] = (data?.orders ?? [])
    .filter((item) => ["IN_PROCESS", "POSTED"].includes(item.status))
    .map((item) => {
      const inputs =
        data?.orderInputs.filter((input) => input.order_id === item.id) ?? [];
      const lot = lotById.get(inputs[0]?.lot_id ?? item.lot_id);
      const intake = intakeByOrder.get(item.id);
      return {
        databaseId: item.id,
        id: item.order_number,
        position: item.queue_position,
        client: clientById.get(item.client_id) ?? "Unknown client",
        lot: inputs
          .map((input) => lotById.get(input.lot_id)?.lot_number ?? input.lot_id)
          .join(", "),
        coffeeType: lot?.coffee_type === "WASHED" ? "Washed" : "Unwashed / UG",
        grade: requestById.get(item.request_id ?? "")?.grade ?? "-",
        inputBags: inputByOrder.get(item.id) ?? 0,
        inputKg: Number(item.input_kg),
        received: "-",
        readiness: "READY",
        note: `${inputs.length} source lot(s)`,
        status: item.status === "POSTED" ? "COMPLETED" : "IN_PROCESS",
        completionNumber: item.completion_number,
        machine: intake?.machine_line ?? "-",
        startedAt: item.started_at,
      };
    });
  const activeOrders = orders.filter((item) => item.status === "IN_PROCESS");
  const selectedOrder =
    orders.find((item) => item.databaseId === selectedOrderId) ??
    activeOrders[0];
  const completion = evaluateOutputCompletion(
    selectedOrder?.inputKg ?? 0,
    selectedOrder?.coffeeType ?? "Washed",
    outputLines,
    exceptionApproved,
  );

  async function reload() {
    try {
      setData(await loadProcessingData());
      setDatabaseError("");
    } catch (error) {
      setData(null);
      setDatabaseError(
        error instanceof Error
          ? error.message
          : "Processing records could not be loaded.",
      );
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStateFilter(initialState);
    setTab("Requests");
  }, [initialState]);

  function saveInputLot(
    lot: EligibleProcessingLot,
    requestedKg: number,
    requestedBags: number,
  ) {
    if (editingInputKey !== null) {
      setRequestLines((current) =>
        current.map((line) =>
          line.key === editingInputKey
            ? { ...line, lot, requestedKg, requestedBags }
            : line,
        ),
      );
    } else {
      setRequestLines((current) => [
        ...current,
        { key: rowKey++, lot, requestedKg, requestedBags },
      ]);
    }
    setEditingInputKey(null);
    setInputPickerOpen(false);
    setRequestError("");
  }

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestError("");
    const form = new FormData(event.currentTarget);
    if (!selectedClient) {
      setRequestError("Select a client.");
      return;
    }
    const selectedCertifications = form
      .getAll("certifications")
      .map(String) as ProcessingCertification[];
    const lines: ProcessingRequestLine[] = requestLines.map((line) => {
      return {
        lotDatabaseId: line.lot.lot_id,
        lot: line.lot.lot_number,
        coffeeType:
          line.lot.coffee_type === "WASHED" ? "Washed" : "Unwashed / UG",
        preparationType: processingPurpose,
        grade: line.lot.grade,
        requestedBags: line.requestedBags,
        requestedKg: line.requestedKg,
        certifications: selectedCertifications,
        specialInstruction: "",
        remark: "",
        clientDatabaseId: line.lot.client_id,
        availableKg: line.lot.available_kg,
        availableBags: line.lot.available_bags,
        sourceType: line.lot.source_type,
      };
    });
    const request: ProcessingRequest = {
      id: "",
      clientDatabaseId: selectedClient.id,
      lotDatabaseId: lines[0]?.lotDatabaseId,
      noteNumber: String(form.get("noteNumber") ?? ""),
      requestDate: String(form.get("requestDate") ?? ""),
      client: selectedClient.legal_name,
      lot: lines.map((line) => line.lot).join(", "),
      coffeeType: lines[0]?.coffeeType ?? "Washed",
      preparationType: lines[0]?.preparationType ?? "",
      grade: lines[0]?.grade ?? "-",
      requestedBags: lines.reduce((sum, line) => sum + line.requestedBags, 0),
      requestedKg: lines.reduce((sum, line) => sum + line.requestedKg, 0),
      certifications: selectedCertifications,
      otherCertification: String(form.get("otherCertification") ?? ""),
      requester: String(form.get("requester") ?? ""),
      checker: String(form.get("checker") ?? ""),
      approver: String(form.get("approver") ?? ""),
      notes: String(form.get("notes") ?? ""),
      scannedDocumentAttached: false,
      status: "DRAFT",
    };
    const validation = validateProcessingRequest(request);
    const lineValidation = validateProcessingRequestLines(lines);
    if (!validation.valid || !lineValidation.valid) {
      setRequestError(validation.errors[0] ?? lineValidation.errors[0]);
      return;
    }
    try {
      const requestNumber = await createProcessingRequest(request, lines);
      await reload();
      setRequestFormOpen(false);
      setSelectedClientId("");
      setRequestLines([]);
      setStateFilter("Waiting Approval");
      setMessage(
        `${requestNumber} submitted for approval with ${lines.length} traceable input lot${lines.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setRequestError(
        error instanceof Error
          ? error.message
          : "Processing request could not be saved.",
      );
    }
  }

  async function submitRequest(id: string) {
    try {
      await submitProcessingRequest(id);
      await reload();
      setMessage("Request submitted for approval.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Request status could not be changed.",
      );
    }
  }

  async function addRequestToQueue(request: ProcessingRequest) {
    try {
      await queueApprovedProcessingRequest(request.id);
      await reload();
      setTab("Requests");
      setStateFilter("Ready to Start");
      setMessage(`${request.requestNumber} is ready in the processing queue.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Request could not be queued.",
      );
    }
  }

  async function decideRequest(
    request: ProcessingRequest,
    decision: "APPROVED" | "REJECTED",
  ) {
    if (decision === "APPROVED") {
      await approveProcessingRequest(request.id);
    } else {
      await rejectProcessingRequest(request.id);
    }
    await reload();
    setRequestDetailId("");
    setStateFilter(decision === "APPROVED" ? "Ready to Start" : "Rejected");
    setMessage(
      decision === "APPROVED"
        ? `${request.requestNumber} approved and ready to start.`
        : `${request.requestNumber} rejected.`,
    );
  }

  function openIntake(item: QueueItem) {
    setSelectedOrderId(item.databaseId);
    setTab("Intake");
  }

  async function submitIntake(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const item = queue.find((entry) => entry.databaseId === selectedOrderId);
    if (!item) return;
    const form = new FormData(event.currentTarget);
    try {
      await startProcessingOrder(item.databaseId, {
        intakeAt: new Date(String(form.get("intakeAt"))).toISOString(),
        inputBags: item.inputBags,
        inputKg: item.inputKg,
        scaleReference: String(form.get("scaleReference")),
        warehouseIssueReference: String(form.get("warehouseIssueReference")),
        machineLine: String(form.get("machineLine")),
        shiftName: String(form.get("shiftName")),
        clientMonitorPresent: form.get("clientMonitorPresent") === "on",
        clientMonitorName: String(form.get("clientMonitorName") ?? ""),
        intakeCondition: String(form.get("intakeCondition")),
        evidencePath: String(form.get("evidencePath") ?? ""),
      });
      await reload();
      setMessage(`${item.id} intake posted and source stock issued once.`);
      setTab("Requests");
      setStateFilter("In Progress");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Intake submission failed.",
      );
    }
  }

  function openCompletion(item: Order) {
    setSelectedOrderId(item.databaseId);
    const washed = item.coffeeType === "Washed";
    setOutputLines([
      {
        ...newOutputLine(
          "ACCEPTED_CLIENT_COFFEE",
          item.inputKg * (washed ? 0.775 : 0.975),
        ),
        coffeeType: washed ? "WASHED" : "UNWASHED_UG",
        grade: item.grade,
        preparation: "Export preparation",
        warehouseSection: "Processed stock",
      },
      ...(washed
        ? [
            {
              ...newOutputLine("HAYKED_BYPRODUCT", item.inputKg * 0.2),
              coffeeType: "WASHED" as const,
              grade: "Byproduct",
              preparation: "Parchment",
              warehouseSection: "Byproduct store",
            },
          ]
        : []),
      {
        ...newOutputLine("PROCESS_LOSS", item.inputKg * 0.025),
        coffeeType: washed ? "WASHED" : "UNWASHED_UG",
        reason: "Processing difference",
      },
    ]);
    setExceptionApproved(false);
    setEvidencePath("");
    setTab("Completion");
  }

  function updateOutputLine(
    index: number,
    patch: Partial<ProcessingOutputLine>,
  ) {
    setOutputLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...patch } : line,
      ),
    );
  }

  async function submitCompletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrder || !completion.valid) {
      setMessage(completion.errors[0] ?? "Select an active processing order.");
      return;
    }
    if (
      (completion.aboveAllowance ||
        (selectedOrder.coffeeType === "Unwashed / UG" &&
          completion.totals.HAYKED_BYPRODUCT > 0)) &&
      !evidencePath.trim()
    ) {
      setMessage("Approved exceptions require an evidence reference.");
      return;
    }
    try {
      await completeProcessingOrder(
        selectedOrder.databaseId,
        outputLines,
        exceptionApproved,
        evidencePath,
      );
      await reload();
      setMessage(
        `${selectedOrder.id} completed and locked with ${outputLines.length} traceable outputs.`,
      );
      setTab("Requests");
      setStateFilter("Completed");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Processing completion failed.",
      );
    }
  }

  const requestLineCount = (requestId: string) =>
    data?.requestLines.filter((line) => line.request_id === requestId).length ??
    0;
  const currentQueueItem =
    queue.find((item) => item.databaseId === selectedOrderId) ?? queue[0];
  const exceptionOutputs = (data?.outputs ?? []).filter(
    (line) =>
      line.category === "PROCESS_LOSS" || line.category === "HAYKED_BYPRODUCT",
  );
  const workflowRows = [
    ...requests
      .filter((request) => !request.queuedAs)
      .map((request) => ({
        key: `request-${request.id}`,
        reference: request.requestNumber,
        client: request.client,
        inputs: requestLineCount(request.id),
        quantityKg: request.requestedKg,
        state: (request.status === "APPROVED"
          ? "Ready to Start"
          : request.status === "REJECTED"
            ? "Rejected"
            : "Waiting Approval") as ProcessingStateFilter,
        statusLabel:
          request.status === "DRAFT"
            ? "Draft - not submitted"
            : request.status === "SUBMITTED"
              ? "Waiting Approval"
              : request.status === "APPROVED"
                ? "Approved - ready to queue"
                : "Rejected",
        request,
        requestId: request.id,
        queueItem: null as QueueItem | null,
        order: null as Order | null,
      })),
    ...queue.map((queueItem) => ({
      key: `queue-${queueItem.databaseId}`,
      reference: queueItem.id,
      client: queueItem.client,
      inputs:
        data?.orderInputs.filter(
          (input) => input.order_id === queueItem.databaseId,
        ).length ?? 0,
      quantityKg: queueItem.inputKg,
      state: "Ready to Start" as ProcessingStateFilter,
      statusLabel:
        queueItem.readiness === "READY"
          ? "Ready to Start"
          : "Blocked - review reservations",
      request: null as ProcessingRequest | null,
      requestId:
        data?.orders.find((order) => order.id === queueItem.databaseId)
          ?.request_id ?? "",
      queueItem,
      order: null as Order | null,
    })),
    ...orders.map((order) => ({
      key: `order-${order.databaseId}`,
      reference: order.completionNumber ?? order.id,
      client: order.client,
      inputs:
        data?.orderInputs.filter((input) => input.order_id === order.databaseId)
          .length ?? 0,
      quantityKg: order.inputKg,
      state: (order.status === "IN_PROCESS"
        ? "In Progress"
        : "Completed") as ProcessingStateFilter,
      statusLabel: order.status === "IN_PROCESS" ? "In Progress" : "Completed",
      request: null as ProcessingRequest | null,
      requestId:
        data?.orders.find((record) => record.id === order.databaseId)
          ?.request_id ?? "",
      queueItem: null as QueueItem | null,
      order,
    })),
  ];
  const visibleWorkflowRows = workflowRows.filter(
    (item) => stateFilter === "All" || item.state === stateFilter,
  );

  if (databaseError && !data)
    return (
      <div className="module-page processing-page">
        <section className="module-heading">
          <div>
            <span className="demo-label">CONTROLLED WORKFLOW</span>
            <h1>Processing operations</h1>
            <p>
              Request lines, intake evidence, production, and output-lot
              reconciliation.
            </p>
          </div>
        </section>
        <section className="database-unavailable" role="alert">
          <AlertTriangle size={26} />
          <h2>Database unavailable</h2>
          <p>Unable to load warehouse data. No demo stock is being shown.</p>
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

  return (
    <div className="module-page processing-page">
      <section className="module-heading">
        <div>
          <span className="demo-label">CONTROLLED WORKFLOW</span>
          <h1>Processing</h1>
          <p>
            Follow each request from approval to completion without choosing
            internal database stages.
          </p>
        </div>
        <div className="processing-heading-actions">
          <div className="allowance-key">
            <span>
              Washed<strong>22.5%</strong>
            </span>
            <span>
              Unwashed / UG<strong>2.5%</strong>
            </span>
          </div>
          {canCreate && (
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                setRequestError("");
                setSelectedClientId("");
                setRequestLines([]);
                setProcessingPurpose("Export preparation");
                setRequestFormOpen(true);
              }}
            >
              <Plus size={16} />
              Add Processing Request
            </button>
          )}
        </div>
      </section>
      {message && (
        <div className="operation-message" role="status">
          <Check size={17} />
          {message}
          <button type="button" onClick={() => setMessage("")}>
            Close
          </button>
        </div>
      )}
      <WorkflowGuide
        title="Processing journey"
        steps={[
          {
            label: "Request",
            help: "Add the request and optional attachments",
            state: tab === "Requests" ? "current" : "done",
          },
          {
            label: "Approve",
            help: "Review, approve, and reserve the input lots",
            state:
              tab === "Queue"
                ? "current"
                : tab === "Requests"
                  ? "next"
                  : "done",
          },
          {
            label: "Start",
            help: "Record intake and issue source lots",
            state:
              tab === "Intake" || tab === "Active Orders"
                ? "current"
                : ["Completion", "Output Lots", "Exceptions"].includes(tab)
                  ? "done"
                  : "next",
          },
          {
            label: "Complete",
            help: "Reconcile outputs and create lots",
            state: ["Completion", "Output Lots", "Exceptions"].includes(tab)
              ? "current"
              : "next",
          },
        ]}
      />
      {tab !== "Requests" && (
        <div className="context-backbar">
          <button
            className="secondary-button"
            type="button"
            onClick={() => setTab("Requests")}
          >
            <ArrowRight className="back-arrow" size={15} />
            Back to processing list
          </button>
          <span>
            {tab === "Intake"
              ? "Start Processing"
              : tab === "Completion"
                ? "Complete Processing"
                : tab}
          </span>
        </div>
      )}

      {tab === "Requests" && (
        <>
          <section className="processing-state-toolbar">
            <div role="tablist" aria-label="Processing status">
              {(
                [
                  "All",
                  "Waiting Approval",
                  "Ready to Start",
                  "In Progress",
                  "Completed",
                  "Rejected",
                ] as ProcessingStateFilter[]
              ).map((state) => (
                <button
                  role="tab"
                  aria-selected={stateFilter === state}
                  className={stateFilter === state ? "active" : ""}
                  type="button"
                  key={state}
                  onClick={() => setStateFilter(state)}
                >
                  {state}
                  <small>
                    {state === "All"
                      ? workflowRows.length
                      : workflowRows.filter((row) => row.state === state)
                          .length}
                  </small>
                </button>
              ))}
            </div>
            <div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setTab("Output Lots")}
              >
                Output lots
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setTab("Exceptions")}
              >
                Exceptions
              </button>
            </div>
          </section>
          <section className="record-panel">
            <div className="record-table processing-workflow-cols">
              <div className="table-head">
                <span>Order / Request</span>
                <span>Client</span>
                <span>Inputs</span>
                <span>Quantity</span>
                <span>Status</span>
                <span>Next Action</span>
              </div>
              {visibleWorkflowRows.map((item) => {
                const openDetails = () => {
                  if (item.request) setRequestDetailId(item.request.id);
                  else if (item.queueItem) setDetailOrderId(item.queueItem.databaseId);
                  else if (item.order) setDetailOrderId(item.order.databaseId);
                };
                return (
                  <div className="processing-workflow-row" key={item.key} onClick={openDetails}>
                    <span>
                      <button
                        className="workflow-reference"
                        type="button"
                        aria-label={`Open ${item.reference} details`}
                        onClick={openDetails}
                      >
                        {item.reference}
                      </button>
                      {item.request && (
                        <small>Paper note {item.request.noteNumber}</small>
                      )}
                    </span>
                    <span>{item.client}</span>
                    <span>
                      {item.inputs} lot{item.inputs === 1 ? "" : "s"}
                    </span>
                    <span>{item.quantityKg.toLocaleString()} kg</span>
                    <span>
                      <Status value={item.statusLabel} />
                    </span>
                    <span className="request-actions">
                      {item.request?.status === "DRAFT" && canCreate && (
                        <button
                          className="workflow-primary-action"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void submitRequest(item.request!.id);
                          }}
                        >
                          <Send size={13} />
                          Submit for Approval
                        </button>
                      )}
                      {item.request?.status === "SUBMITTED" && (
                        canApprove ? (
                          <button
                            className="workflow-primary-action"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setRequestDetailId(item.request!.id);
                            }}
                          >
                            Review Request <ArrowRight size={13} />
                          </button>
                        ) : (
                          <span className="muted-action">Waiting for approval</span>
                        )
                      )}
                      {item.request?.status === "APPROVED" && canQueue && (
                        <button
                          className="workflow-primary-action"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void addRequestToQueue(item.request!);
                          }}
                        >
                          Prepare to Start <ArrowRight size={13} />
                        </button>
                      )}
                      {item.request?.status === "REJECTED" && (
                        <button
                          className="workflow-secondary-action"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setRequestDetailId(item.request!.id);
                          }}
                        >
                          View Summary
                        </button>
                      )}
                      {item.queueItem && (
                        canStart ? (
                          <button
                            className="workflow-primary-action"
                            type="button"
                            disabled={item.queueItem.readiness === "BLOCKED"}
                            onClick={(event) => {
                              event.stopPropagation();
                              openIntake(item.queueItem!);
                            }}
                          >
                            {item.queueItem.readiness === "BLOCKED"
                              ? "Resolve Reservations"
                              : "Start Processing"}
                            <ArrowRight size={13} />
                          </button>
                        ) : (
                          <span className="muted-action">Ready for processing</span>
                        )
                      )}
                      {item.order && (
                        item.order.status === "IN_PROCESS" && canComplete ? (
                          <button
                            className="workflow-primary-action"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openCompletion(item.order!);
                            }}
                          >
                            Complete Processing <ArrowRight size={13} />
                          </button>
                        ) : item.order.status === "COMPLETED" ? (
                          <button
                            className="workflow-secondary-action"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDetailOrderId(item.order!.databaseId);
                            }}
                          >
                            View Summary
                          </button>
                        ) : (
                          <span className="muted-action">Processing in progress</span>
                        )
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            {visibleWorkflowRows.length === 0 && (
              <Empty
                title={`No ${stateFilter.toLowerCase()} processing records`}
                text="Choose another status or create a new processing request."
              />
            )}
          </section>
        </>
      )}

      {requestFormOpen && (
        <div className="modal-backdrop">
          <form
            className="receipt-modal processing-request-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="processing-request-title"
            onSubmit={createRequest}
          >
            <header>
              <div>
                <span className="demo-label">PAPER FORM DIGITIZATION</span>
                <h2 id="processing-request-title">New processing request</h2>
                <p>Add one or many eligible lots owned by one client.</p>
              </div>
              <button
                type="button"
                aria-label="Close request form"
                onClick={() => setRequestFormOpen(false)}
              >
                <X size={20} />
              </button>
            </header>
            <section className="form-section">
              <h3>Request header</h3>
              <div className="form-grid compact request-form-grid">
                <label>
                  Paper note number
                  <input name="noteNumber" placeholder="00240" required />
                </label>
                <label>
                  Request date
                  <input
                    name="requestDate"
                    type="date"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    required
                  />
                </label>
                <label>
                  Client / customer
                  <select
                    required
                    value={selectedClientId}
                    onChange={(event) => {
                      setSelectedClientId(event.target.value);
                      setRequestError("");
                      setRequestLines([]);
                    }}
                  >
                    <option value="" disabled>
                      Select client
                    </option>
                    {clients
                      .filter((client) => client.active)
                      .map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.code} - {client.legal_name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Processing purpose
                  <input
                    required
                    value={processingPurpose}
                    onChange={(event) =>
                      setProcessingPurpose(event.target.value)
                    }
                    placeholder="Export preparation"
                  />
                </label>
              </div>
            </section>
            <section className="form-section processing-inputs-section">
              <div className="section-title-row">
                <div>
                  <h3>Processing inputs</h3>
                  <p className="form-note muted">
                    Arrival, Reject, and Processed lots can be combined when
                    they belong to this client.
                  </p>
                </div>
                <span className="info-badge muted">
                  {requestLines.length} selected
                </span>
              </div>
              {requestLines.length === 0 ? (
                <div className="empty-input-lots">
                  <PackageCheck size={22} />
                  <strong>No input lots selected</strong>
                  <p>
                    Start with one source lot and add more only when the
                    processing order needs them.
                  </p>
                </div>
              ) : (
                <div className="request-input-table">
                  <div className="table-head">
                    <span>Type</span>
                    <span>Lot</span>
                    <span>Source</span>
                    <span>Available</span>
                    <span>Selected</span>
                    <span>Control</span>
                  </div>
                  {requestLines.map((line) => (
                    <div key={line.key}>
                      <span>
                        <Status
                          value={sourceTypeLabels[line.lot.source_type]}
                        />
                      </span>
                      <span>
                        <strong className="reference">
                          {line.lot.lot_number}
                        </strong>
                        <small>{line.lot.grade}</small>
                      </span>
                      <span>
                        {line.lot.source_document ?? "-"}
                        <small>
                          {line.lot.origin ?? "Origin not recorded"}
                        </small>
                      </span>
                      <span>
                        {line.lot.available_kg.toLocaleString()} kg
                        <small>{line.lot.available_bags} bags</small>
                      </span>
                      <span>
                        {line.requestedKg.toLocaleString()} kg
                        <small>{line.requestedBags} bags</small>
                      </span>
                      <span className="row-actions">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingInputKey(line.key);
                            setInputPickerOpen(true);
                          }}
                        >
                          <Pencil size={13} />
                          Edit
                        </button>
                        <button
                          className="reject"
                          type="button"
                          aria-label={`Remove ${line.lot.lot_number}`}
                          onClick={() =>
                            setRequestLines((current) =>
                              current.filter((item) => item.key !== line.key),
                            )
                          }
                        >
                          <Trash2 size={13} />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <button
                className="secondary-button add-input-lot-button"
                type="button"
                disabled={!selectedClientId}
                onClick={() => {
                  setEditingInputKey(null);
                  setInputPickerOpen(true);
                }}
              >
                <Plus size={15} />
                Add Input Lot
              </button>
            </section>
            <section className="form-section">
              <h3>Certification</h3>
              <div className="certification-grid">
                {certifications.map((certification) => (
                  <label key={certification}>
                    <input
                      type="checkbox"
                      name="certifications"
                      value={certification}
                    />
                    {certification}
                  </label>
                ))}
              </div>
              <label className="other-certification">
                Other certification
                <input name="otherCertification" />
              </label>
            </section>
            <section className="form-section">
              <h3>Request control</h3>
              <div className="form-grid compact request-form-grid">
                <label>
                  Representative / requester
                  <select name="requester" required defaultValue="">
                    <option value="" disabled>
                      Select representative
                    </option>
                    {(data?.representatives ?? [])
                      .filter(
                        (item) =>
                          item.client_id === selectedClientId && item.active,
                      )
                      .map((item) => (
                        <option key={item.id}>{item.full_name}</option>
                      ))}
                  </select>
                </label>
                <label>
                  Checker
                  <select name="checker" required defaultValue="">
                    <option value="" disabled>
                      Select checker
                    </option>
                    {staff.map((profile) => (
                      <option key={profile.id}>{profile.full_name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Approver
                  <select name="approver" required defaultValue="">
                    <option value="" disabled>
                      Select approver
                    </option>
                    {staff.map((profile) => (
                      <option key={profile.id}>{profile.full_name}</option>
                    ))}
                  </select>
                </label>
                <label className="wide">
                  Notes
                  <textarea name="notes" rows={3} />
                </label>
                <div className="wide upload-after-save-note">
                  <FileCheck2 size={17} />
                  <span>
                    <strong>Attachments are optional.</strong> Submit the request
                    now, then click its reference in the table whenever you want
                    to add a signed PDF, scan, or photo.
                  </span>
                </div>
              </div>
            </section>
            {requestError && (
              <div className="request-form-error" role="alert">
                <AlertTriangle size={15} />
                {requestError}
              </div>
            )}
            <footer>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setRequestFormOpen(false)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={!selectedClientId || requestLines.length === 0}
              >
                <FileCheck2 size={16} />
                Submit for Approval
              </button>
            </footer>
          </form>
        </div>
      )}
      {inputPickerOpen && selectedClientId && (
        <AddInputLotDialog
          clientId={selectedClientId}
          selectedLotIds={requestLines
            .filter((line) => line.key !== editingInputKey)
            .map((line) => line.lot.lot_id)}
          initialLine={requestLines.find(
            (line) => line.key === editingInputKey,
          )}
          onSave={saveInputLot}
          onClose={() => {
            setInputPickerOpen(false);
            setEditingInputKey(null);
          }}
        />
      )}

      {tab === "Queue" && (
        <>
          <section className="queue-rule">
            <Clock3 size={18} />
            <div>
              <strong>Protected processing sequence</strong>
              <p>
                Queueing reserves every source lot. Intake consumes all
                reservations in one transaction.
              </p>
            </div>
          </section>
          <section className="record-panel">
            <div className="record-table queue-cols">
              <div className="table-head">
                <span>Queue / order</span>
                <span>Client / lots</span>
                <span>Coffee</span>
                <span>Received</span>
                <span>Readiness</span>
                <span>Control</span>
              </div>
              {queue.map((item) => (
                <div key={item.id}>
                  <span>
                    <span className="queue-position">{item.position}</span>
                    <small>{item.id}</small>
                  </span>
                  <span>
                    <strong>{item.client}</strong>
                    <small>{item.lot}</small>
                  </span>
                  <span>
                    {item.coffeeType}
                    <small>
                      {item.inputBags} bags - {item.inputKg.toLocaleString()} kg
                    </small>
                  </span>
                  <span>{item.received}</span>
                  <span>
                    <Status value={item.readiness} />
                    <small>{item.note}</small>
                  </span>
                  <span className="request-actions">
                    <button
                      className="table-action"
                      type="button"
                      onClick={() => setDetailOrderId(item.databaseId)}
                    >
                      Details
                    </button>
                    <button
                      className="table-action"
                      type="button"
                      disabled={item.readiness === "BLOCKED"}
                      onClick={() => openIntake(item)}
                    >
                      Record intake <ArrowRight size={13} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {tab === "Intake" &&
        (currentQueueItem ? (
          <form className="operation-form" onSubmit={submitIntake}>
            <header>
              <div>
                <span className="demo-label">{currentQueueItem.id}</span>
                <h2>Processing intake</h2>
                <p>
                  {currentQueueItem.client} - {currentQueueItem.inputBags} bags
                  / {currentQueueItem.inputKg.toLocaleString()} kg
                </p>
              </div>
              <select
                value={currentQueueItem.databaseId}
                onChange={(event) => setSelectedOrderId(event.target.value)}
              >
                {queue.map((item) => (
                  <option key={item.id} value={item.databaseId}>
                    {item.id}
                  </option>
                ))}
              </select>
            </header>
            <div className="form-grid compact">
              <label>
                Intake date and time
                <input
                  name="intakeAt"
                  type="datetime-local"
                  defaultValue={new Date().toISOString().slice(0, 16)}
                  required
                />
              </label>
              <label>
                Scale reference
                <input
                  name="scaleReference"
                  placeholder="SCALE-2026-0041"
                  required
                />
              </label>
              <label>
                Warehouse issue reference
                <input
                  name="warehouseIssueReference"
                  placeholder="WI-2026-0041"
                  required
                />
              </label>
              <label>
                Machine / line
                <input name="machineLine" placeholder="Line 1" required />
              </label>
              <label>
                Shift
                <select name="shiftName" defaultValue="Day">
                  <option>Day</option>
                  <option>Night</option>
                </select>
              </label>
              <label>
                Intake condition
                <select name="intakeCondition" defaultValue="Good">
                  <option>Good</option>
                  <option>Wet</option>
                  <option>Damaged bags</option>
                  <option>Needs review</option>
                </select>
              </label>
              <label>
                Evidence reference
                <input
                  name="evidencePath"
                  placeholder="Scale ticket or document reference"
                />
              </label>
              <label>
                Client monitor name
                <input name="clientMonitorName" />
              </label>
              <label className="check-label wide">
                <input name="clientMonitorPresent" type="checkbox" />
                Client representative was present
              </label>
            </div>
            <footer>
              <button className="primary-button" type="submit">
                <Scale size={16} />
                Post intake and issue stock
              </button>
            </footer>
          </form>
        ) : (
          <Empty
            title="No queued order needs intake"
            text="Approve and queue a processing request first."
          />
        ))}

      {tab === "Active Orders" && (
        <>
          <section className="processing-summary">
            <article>
              <Factory size={19} />
              <span>
                Active orders<strong>{activeOrders.length}</strong>
              </span>
            </article>
            <article>
              <Scale size={19} />
              <span>
                Input in process
                <strong>
                  {activeOrders
                    .reduce((sum, item) => sum + item.inputKg, 0)
                    .toLocaleString()}{" "}
                  kg
                </strong>
              </span>
            </article>
            <article>
              <PackageCheck size={19} />
              <span>
                Completed orders
                <strong>
                  {orders.filter((item) => item.status === "COMPLETED").length}
                </strong>
              </span>
            </article>
          </section>
          <section className="record-panel">
            <div className="record-table order-cols">
              <div className="table-head">
                <span>Order</span>
                <span>Client / lots</span>
                <span>Input</span>
                <span>Machine</span>
                <span>Started</span>
                <span>Status</span>
                <span>Action</span>
              </div>
              {orders.map((item) => (
                <div key={item.id}>
                  <span className="reference">
                    {item.id}
                    <small>
                      {item.completionNumber ?? "No completion yet"}
                    </small>
                  </span>
                  <span>
                    <strong>{item.client}</strong>
                    <small>{item.lot}</small>
                  </span>
                  <span>
                    {item.inputKg.toLocaleString()} kg
                    <small>
                      {item.coffeeType} · {item.note}
                    </small>
                  </span>
                  <span>{item.machine}</span>
                  <span>
                    {item.startedAt
                      ? new Date(item.startedAt).toLocaleString()
                      : "-"}
                  </span>
                  <span>
                    <Status value={item.status} />
                  </span>
                  <span className="request-actions">
                    <button
                      className="table-action"
                      type="button"
                      onClick={() => setDetailOrderId(item.databaseId)}
                    >
                      Details
                    </button>
                    <button
                      className="table-action"
                      type="button"
                      disabled={item.status === "COMPLETED"}
                      onClick={() => openCompletion(item)}
                    >
                      {item.status === "COMPLETED"
                        ? "Locked"
                        : "Record outputs"}
                      <ArrowRight size={13} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {tab === "Completion" &&
        (selectedOrder && selectedOrder.status === "IN_PROCESS" ? (
          <form className="completion-layout" onSubmit={submitCompletion}>
            <section className="completion-form">
              <header>
                <div>
                  <span className="demo-label">{selectedOrder.id}</span>
                  <h2>Output reconciliation</h2>
                  <p>
                    {selectedOrder.client} - input{" "}
                    {selectedOrder.inputKg.toLocaleString()} kg
                  </p>
                </div>
                <select
                  value={selectedOrder.databaseId}
                  onChange={(event) => {
                    const next = activeOrders.find(
                      (item) => item.databaseId === event.target.value,
                    );
                    if (next) openCompletion(next);
                  }}
                >
                  {activeOrders.map((item) => (
                    <option key={item.id} value={item.databaseId}>
                      {item.id}
                    </option>
                  ))}
                </select>
              </header>
              <div className="section-title-row">
                <div className="input-total">
                  <span>Processing input</span>
                  <strong>{selectedOrder.inputKg.toLocaleString()} kg</strong>
                </div>
                <button
                  className="table-action"
                  type="button"
                  onClick={() =>
                    setOutputLines((current) => [
                      ...current,
                      {
                        ...newOutputLine("CLIENT_REJECT"),
                        coffeeType:
                          selectedOrder.coffeeType === "Washed"
                            ? "WASHED"
                            : "UNWASHED_UG",
                      },
                    ])
                  }
                >
                  <Plus size={13} />
                  Add output
                </button>
              </div>
              <div className="output-line-editor">
                {outputLines.map((line, index) => (
                  <article
                    key={index}
                    className={`output-section ${line.category.toLowerCase()}`}
                  >
                    <div className="section-title-row">
                      <h3>
                        {index + 1}.{" "}
                        {
                          outputCategories.find(
                            (item) => item.value === line.category,
                          )?.label
                        }
                      </h3>
                      <button
                        className="icon-button"
                        type="button"
                        title="Remove output"
                        aria-label={`Remove output line ${index + 1}`}
                        disabled={outputLines.length === 1}
                        onClick={() =>
                          setOutputLines((current) =>
                            current.filter(
                              (_, lineIndex) => lineIndex !== index,
                            ),
                          )
                        }
                      >
                        <Minus size={14} />
                      </button>
                    </div>
                    <div className="form-grid compact">
                      <label>
                        Category
                        <select
                          value={line.category}
                          onChange={(event) =>
                            updateOutputLine(index, {
                              category: event.target
                                .value as ProcessingOutputCategory,
                            })
                          }
                        >
                          {outputCategories.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Quantity kg
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={line.quantityKg || ""}
                          onChange={(event) =>
                            updateOutputLine(index, {
                              quantityKg: Number(event.target.value),
                            })
                          }
                          required
                        />
                      </label>
                      {line.category !== "PROCESS_LOSS" && (
                        <>
                          <label>
                            Grade / category
                            <input
                              value={line.grade}
                              onChange={(event) =>
                                updateOutputLine(index, {
                                  grade: event.target.value,
                                })
                              }
                              required
                            />
                          </label>
                          <label>
                            Preparation
                            <input
                              value={line.preparation}
                              onChange={(event) =>
                                updateOutputLine(index, {
                                  preparation: event.target.value,
                                })
                              }
                              required
                            />
                          </label>
                          <label>
                            Bags
                            <input
                              type="number"
                              min="0"
                              value={line.bagCount}
                              onChange={(event) =>
                                updateOutputLine(index, {
                                  bagCount: Number(event.target.value),
                                })
                              }
                            />
                          </label>
                          <label>
                            Bag weight kg
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={line.bagWeightKg ?? ""}
                              onChange={(event) =>
                                updateOutputLine(index, {
                                  bagWeightKg: event.target.value
                                    ? Number(event.target.value)
                                    : null,
                                })
                              }
                            />
                          </label>
                          <label>
                            Warehouse section
                            <input
                              value={line.warehouseSection}
                              onChange={(event) =>
                                updateOutputLine(index, {
                                  warehouseSection: event.target.value,
                                })
                              }
                              required
                            />
                          </label>
                          <label>
                            Weighing reference
                            <input
                              value={line.weighingReference}
                              onChange={(event) =>
                                updateOutputLine(index, {
                                  weighingReference: event.target.value,
                                })
                              }
                              required
                            />
                          </label>
                        </>
                      )}
                      {line.category === "PROCESS_LOSS" && (
                        <label className="wide">
                          Loss reason
                          <input
                            value={line.reason}
                            onChange={(event) =>
                              updateOutputLine(index, {
                                reason: event.target.value,
                              })
                            }
                            required
                          />
                        </label>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
            <aside className="reconciliation-panel">
              <h2>Live reconciliation</h2>
              <dl>
                <div>
                  <dt>Total input</dt>
                  <dd>{selectedOrder.inputKg.toLocaleString()} kg</dd>
                </div>
                {outputCategories.map((category) => (
                  <div key={category.value}>
                    <dt>{category.label}</dt>
                    <dd>
                      {completion.totals[category.value].toLocaleString()} kg
                    </dd>
                  </div>
                ))}
                <div className="total">
                  <dt>Output total</dt>
                  <dd>{completion.outputKg.toLocaleString()} kg</dd>
                </div>
              </dl>
              <div
                className={`balance-result ${Math.abs(completion.varianceKg) <= 0.01 ? "good" : "bad"}`}
              >
                <span>Mass-balance variance</span>
                <strong>{completion.varianceKg.toLocaleString()} kg</strong>
              </div>
              <div
                className={`allowance-result ${completion.aboveAllowance ? "bad" : "good"}`}
              >
                <span>Applicable allowance</span>
                <strong>
                  {completion.actualPercent.toFixed(2)}% /{" "}
                  {completion.allowedPercent}%
                </strong>
              </div>
              {(completion.aboveAllowance ||
                (selectedOrder.coffeeType === "Unwashed / UG" &&
                  completion.totals.HAYKED_BYPRODUCT > 0)) && (
                <>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={exceptionApproved}
                      onChange={(event) =>
                        setExceptionApproved(event.target.checked)
                      }
                    />
                    Independent exception approved
                  </label>
                  <label>
                    Evidence reference
                    <input
                      value={evidencePath}
                      onChange={(event) => setEvidencePath(event.target.value)}
                      required
                    />
                  </label>
                </>
              )}
              {completion.errors.length > 0 && (
                <div className="validation-list">
                  {completion.errors.map((error) => (
                    <p key={error}>
                      <AlertTriangle size={13} />
                      {error}
                    </p>
                  ))}
                </div>
              )}
              <button
                className="primary-button complete-button"
                type="submit"
                disabled={!completion.valid}
              >
                <ShieldCheck size={17} />
                Post and lock completion
              </button>
            </aside>
          </form>
        ) : (
          <Empty
            title="No active order is selected"
            text="Record intake for a queued order, then open its outputs from Active Orders."
          />
        ))}

      {tab === "Output Lots" && (
        <section className="record-panel">
          <div className="record-table output-cols">
            <div className="table-head">
              <span>Completion</span>
              <span>Output lot</span>
              <span>Category / owner</span>
              <span>Grade / preparation</span>
              <span>Quantity</span>
              <span>Location</span>
            </div>
            {(data?.outputs ?? [])
              .filter((item) => item.child_lot_id)
              .map((item) => {
                const linkedOrder = data?.orders.find(
                  (order) => order.id === item.order_id,
                );
                const childLot = lotById.get(item.child_lot_id ?? "");
                return (
                  <div key={item.id}>
                    <span className="reference">
                      {linkedOrder?.completion_number ??
                        linkedOrder?.order_number}
                    </span>
                    <span>{childLot?.lot_number ?? "Pending lot"}</span>
                    <span>
                      {item.category.replaceAll("_", " ")}
                      <small>{item.owner_type}</small>
                    </span>
                    <span>
                      {item.grade ?? "-"}
                      <small>{item.preparation ?? "-"}</small>
                    </span>
                    <span>
                      {Number(item.quantity_kg).toLocaleString()} kg
                      <small>{item.bag_count} bags</small>
                    </span>
                    <span>{item.warehouse_section ?? "-"}</span>
                  </div>
                );
              })}
          </div>
          {!(data?.outputs ?? []).some((item) => item.child_lot_id) && (
            <Empty
              title="No processing output lots"
              text="Completed physical outputs will appear here with generated lot numbers."
            />
          )}
        </section>
      )}

      {tab === "Exceptions" && (
        <section className="record-panel">
          <div className="record-table exception-cols">
            <div className="table-head">
              <span>Order</span>
              <span>Type</span>
              <span>Quantity</span>
              <span>Evidence</span>
              <span>Reason</span>
            </div>
            {exceptionOutputs.map((item) => {
              const linkedOrder = data?.orders.find(
                (order) => order.id === item.order_id,
              );
              return (
                <div key={item.id}>
                  <span className="reference">
                    {linkedOrder?.completion_number ??
                      linkedOrder?.order_number}
                  </span>
                  <span>
                    <Status value={item.category} />
                  </span>
                  <span>{Number(item.quantity_kg).toLocaleString()} kg</span>
                  <span>
                    {item.evidence_path ??
                      linkedOrder?.completion_number ??
                      "Recorded at completion"}
                  </span>
                  <span>{item.reason ?? "Allowance output"}</span>
                </div>
              );
            })}
          </div>
          {!exceptionOutputs.length && (
            <Empty
              title="No processing exceptions"
              text="Process loss and byproduct records will appear here after completion."
            />
          )}
        </section>
      )}
      {data && detailOrderId && (
        <ProcessingOrderDetail
          data={data}
          orderId={detailOrderId}
          onClose={() => setDetailOrderId("")}
        />
      )}
      {data &&
        requestDetailId &&
        (() => {
          const request = data.requests.find(
            (item) => item.id === requestDetailId,
          );
          return request ? (
            <ProcessingRequestDetail
              request={request}
              check={data.ecxChecks.find(
                (item) => item.processing_request_id === requestDetailId,
              )}
              canDecide={
                canApprove &&
                (normalizeAppRole(role) === "system_admin" ||
                  request.createdById !== userId)
              }
              decisionBlockedReason={
                !canApprove
                  ? "Your role can view this request, but cannot approve it."
                  : "A second authorized employee must decide this request."
              }
              onDecision={(decision) => decideRequest(request, decision)}
              onSaved={async (nextMessage) => {
                await reload();
                setMessage(nextMessage);
              }}
              onClose={() => setRequestDetailId("")}
            />
          ) : null;
        })()}
    </div>
  );
}
