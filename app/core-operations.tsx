"use client";

import {
  ArrowRight,
  Check,
  ClipboardCheck,
  FileText,
  History,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Scale,
  Search,
  ShieldCheck,
  UserRoundCheck,
  Warehouse,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  type CoffeeLot,
  type StockMovement,
  type WarehouseReceipt,
} from "./grn-workflow";
import {
  createAgreement,
  createClient,
  createClientSetup,
  createRepresentative,
  createWarehouseReceipt,
  loadCoreData,
  transitionGrn,
  updateWarehouseReceiptDraft,
  type CoreAgreement,
  type CoreClient,
  type CoreData,
  type CoreRepresentative,
  type NewAgreement,
  type NewClient,
  type NewRepresentative,
} from "@/lib/erp-data";
import { activeOn } from "./client-onboarding";
import { lotStatusLabel, lotTypeLabel, stockMatches, type StockStatusFilter, type StockTypeFilter } from "./ux-rules";
import { DetailGrid, DetailSection, EvidenceUploader, RecordDetailDrawer, WorkflowGuide } from "./workflow-ui";

const clients: CoreClient[] = [
  { id: "demo-client-1", code: "CL-0015", name: "Guji Specialty Coffee PLC", tin: "0018472635", agreement: "AGR-2026-011", stock: "44,400 kg", status: "READY" },
  { id: "demo-client-2", code: "CL-0008", name: "Sidama Highland Coffee", tin: "0012738492", agreement: "AGR-2026-006", stock: "36,600 kg", status: "READY" },
  { id: "demo-client-3", code: "CL-0012", name: "Biftu Buna Trading", tin: "0016247853", agreement: "AGR-2026-009", stock: "28,200 kg", status: "READY" },
];

const agreements: CoreAgreement[] = [
  { id: "demo-agreement-1", clientId: "demo-client-1", number: "AGR-2026-011", client: "Guji Specialty Coffee PLC", source: "001/2018", effective: "2026-01-01", effectiveFrom: "2026-01-01", expiry: "2026-12-31", effectiveTo: "2026-12-31", tariff: "TV-001", status: "ACTIVE" },
  { id: "demo-agreement-2", clientId: "demo-client-2", number: "AGR-2026-006", client: "Sidama Highland Coffee", source: "001/2018", effective: "2026-02-12", effectiveFrom: "2026-02-12", expiry: "2027-02-11", effectiveTo: "2027-02-11", tariff: "TV-001", status: "ACTIVE" },
  { id: "demo-agreement-3", clientId: "demo-client-3", number: "AGR-2026-009", client: "Biftu Buna Trading", source: "001/2018", effective: "2026-03-22", effectiveFrom: "2026-03-22", expiry: "2027-03-21", effectiveTo: "2027-03-21", tariff: "TV-001", status: "ACTIVE" },
];

const representatives: CoreRepresentative[] = [
  { id: "demo-representative-1", clientId: "demo-client-1", name: "Aster Kebede", identityNumber: "ID-2026-0015", client: "Guji Specialty Coffee PLC", phone: "+251 911 245 760", scope: "Receipt, processing, dispatch", validFrom: "2026-01-01", expiry: "2026-12-31", validTo: "2026-12-31", status: "ACTIVE" },
  { id: "demo-representative-2", clientId: "demo-client-2", name: "Dawit Bekele", identityNumber: "ID-2026-0008", client: "Sidama Highland Coffee", phone: "+251 922 680 114", scope: "Receipt and processing", validFrom: "2026-02-12", expiry: "2027-02-11", validTo: "2027-02-11", status: "ACTIVE" },
  { id: "demo-representative-3", clientId: "demo-client-3", name: "Helen Girma", identityNumber: "ID-2026-0012", client: "Biftu Buna Trading", phone: "+251 933 418 602", scope: "Receipt and dispatch", validFrom: "2026-03-22", expiry: "2027-03-21", validTo: "2027-03-21", status: "ACTIVE" },
];

const initialReceipts: WarehouseReceipt[] = [
  { id: "GRN-2026-0040", client: "Guji Specialty Coffee PLC", agreement: "AGR-2026-011", representative: "Aster Kebede", receivedAt: "2026-08-01T08:30", warehouse: "Main Warehouse", section: "A-01 Arrival", truckPlate: "ET-3-48216", driverName: "Yonas Birhanu", sealNumber: "SL-78291", weighbridgeRef: "WB-24018", origin: "Guji", coffeeType: "Unwashed / UG", grade: "Grade 1", cropYear: 2026, bags: 320, bagWeightKg: 60, grossWeightKg: 19850, tareWeightKg: 650, netWeightKg: 19200, moisturePercent: 10.8, wetCoffee: false, receivedBy: "Meron Tadesse", createdBy: "Warehouse Clerk", status: "POSTED", lotNumber: "HYK/GEL/2026/0040" },
  { id: "GRN-2026-0041", client: "Sidama Highland Coffee", agreement: "AGR-2026-006", representative: "Dawit Bekele", receivedAt: "2026-08-01T10:15", warehouse: "Main Warehouse", section: "A-02 Arrival", truckPlate: "ET-3-73190", driverName: "Kebede Tola", sealNumber: "SL-78304", weighbridgeRef: "WB-24019", origin: "Sidama", coffeeType: "Washed", grade: "Grade 2", cropYear: 2026, bags: 210, bagWeightKg: 60, grossWeightKg: 13210, tareWeightKg: 610, netWeightKg: 12600, moisturePercent: 11.2, wetCoffee: false, receivedBy: "Meron Tadesse", createdBy: "Warehouse Clerk", status: "SUBMITTED" },
  { id: "GRN-2026-0042", client: "Biftu Buna Trading", agreement: "AGR-2026-009", representative: "Helen Girma", receivedAt: "2026-08-01T11:45", warehouse: "Main Warehouse", section: "Q-01 Quarantine", truckPlate: "ET-3-66217", driverName: "Tamirat Ayele", sealNumber: "SL-78316", weighbridgeRef: "WB-24020", origin: "Jimma", coffeeType: "Unwashed / UG", grade: "UG", cropYear: 2026, bags: 140, bagWeightKg: 60, grossWeightKg: 8920, tareWeightKg: 520, netWeightKg: 8400, moisturePercent: 12.9, wetCoffee: true, receivedBy: "Meron Tadesse", createdBy: "Warehouse Clerk", status: "DRAFT" },
];

const initialLots: CoffeeLot[] = [
  { lotNumber: "HYK/GEL/2026/0040", sourceGrn: "GRN-2026-0040", client: "Guji Specialty Coffee PLC", coffee: "Unwashed / UG Guji", grade: "Grade 1", section: "A-01 Arrival", bags: 320, weightKg: 19200, status: "ARRIVAL_IN_STORAGE", lotCategory: "ARRIVAL", ownershipType: "CLIENT" },
];

const initialMovements: StockMovement[] = [
  { id: "MOV-GRN-2026-0040", sourceGrn: "GRN-2026-0040", lotNumber: "HYK/GEL/2026/0040", type: "RECEIPT", bagsDelta: 320, weightDeltaKg: 19200 },
];

const tabs = ["Clients", "Agreements", "Representatives", "Warehouse Receipts", "Coffee Lots"];
const defaultReceivedAt = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function Status({ value }: { value: string }) {
  return <span className={`status-pill ${value.toLowerCase().replaceAll("_", "-")}`}>{value.replaceAll("_", " ")}</span>;
}

function PageHeader({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: React.ReactNode }) {
  return <section className="module-heading"><div><span className="demo-label">{eyebrow}</span><h1>{title}</h1><p>{copy}</p></div>{action}</section>;
}

function OperationMessage({ message, onClose }: { message: string; onClose: () => void }) {
  if (!message) return null;
  return <div className="operation-message" role="status"><Check size={17} />{message}<button type="button" onClick={onClose} aria-label="Dismiss message"><X size={15} /></button></div>;
}

type MasterRecordKind = "client" | "agreement" | "representative";

type RepresentativeDraft = { key: number; fullName: string; identityNumber: string; phone: string; validFrom: string; validTo: string; active: boolean };

function NewClientModal({ tariffs, onSaved, onClose }: { tariffs: CoreData["tariffs"]; onSaved: (message: string) => Promise<void>; onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [includeAgreement, setIncludeAgreement] = useState(false);
  const [representativeKey, setRepresentativeKey] = useState(1);
  const [representativeDrafts, setRepresentativeDrafts] = useState<RepresentativeDraft[]>([]);

  function addRepresentative() {
    setRepresentativeDrafts((current) => [...current, { key: representativeKey, fullName: "", identityNumber: "", phone: "", validFrom: today, validTo: "", active: true }]);
    setRepresentativeKey((value) => value + 1);
  }

  function updateRepresentative(key: number, patch: Partial<RepresentativeDraft>) {
    setRepresentativeDrafts((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    const effectiveFrom = includeAgreement ? String(data.get("effectiveFrom")) : "";
    const effectiveTo = includeAgreement ? String(data.get("effectiveTo")) || null : null;
    if (includeAgreement && effectiveTo && effectiveTo < effectiveFrom) { setError("Agreement expiry cannot be before its effective date."); return; }
    if (representativeDrafts.some((item) => !item.fullName.trim() || !item.identityNumber.trim())) { setError("Complete each added representative or remove the unfinished row."); return; }
    if (representativeDrafts.some((item) => item.validTo && item.validTo < item.validFrom)) { setError("Representative authorization expiry cannot be before its start date."); return; }
    setBusy(true);
    try {
      const legalName = String(data.get("legalName"));
      await createClientSetup({
        client: { code: String(data.get("code")), legalName, tin: String(data.get("tin")), phone: String(data.get("phone")), email: String(data.get("email")) },
        agreement: includeAgreement ? { agreementNumber: String(data.get("agreementNumber")), effectiveFrom, effectiveTo, status: String(data.get("agreementStatus")) as NewAgreement["status"], defaultBagWeightKg: Number(data.get("defaultBagWeightKg")), tariffVersion: String(data.get("tariffVersion")) } : undefined,
        representatives: representativeDrafts.map((item) => ({ fullName: item.fullName, identityNumber: item.identityNumber, phone: item.phone, validFrom: item.validFrom, validTo: item.validTo || null, active: item.active })),
      });
      const readiness = includeAgreement || representativeDrafts.length ? ` Readiness setup saved: ${includeAgreement ? "agreement" : "no agreement"}, ${representativeDrafts.length} representative${representativeDrafts.length === 1 ? "" : "s"}.` : " Add an agreement and representative before the first receipt.";
      await onSaved(`${legalName} created successfully.${readiness}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The client onboarding record could not be saved.");
    } finally { setBusy(false); }
  }

  const tariffOptions = tariffs.length ? tariffs : [{ code: "TV-001", name: "Hayked standard rates", active: true }];
  return <div className="modal-backdrop" role="presentation"><form className="receipt-modal client-onboarding-modal" onSubmit={submit} aria-labelledby="new-client-title">
    <header><div><span className="demo-label">SIMPLE CLIENT SETUP</span><h2 id="new-client-title">New client</h2><p>Save the client first. Agreement and representative details are optional now and can be added later.</p></div><button type="button" aria-label="Close client onboarding" onClick={onClose}><X size={20} /></button></header>
    {error && <div className="request-form-error" role="alert">{error}</div>}
    <section className="form-section"><h3>1. Client details</h3><div className="form-grid compact"><label>Client code<input name="code" required maxLength={30} placeholder="CL-0016" /></label><label>Legal name<input name="legalName" required maxLength={180} /></label><label>TIN<input name="tin" maxLength={60} /></label><label>Phone<input name="phone" type="tel" maxLength={60} /></label><label className="wide">Email<input name="email" type="email" maxLength={180} /></label></div></section>
    <section className="form-section optional-client-setup"><div className="section-title-row"><div><h3>2. Agreement (optional now)</h3><p className="form-note">Add it now only if the signed agreement is ready.</p></div><button className="secondary-button" type="button" onClick={() => setIncludeAgreement((value) => !value)}>{includeAgreement ? "Remove agreement" : "Add agreement now"}</button></div>{includeAgreement && <div className="form-grid compact"><label>Agreement number<input name="agreementNumber" required maxLength={60} placeholder="AGR-2026-012" /></label><label>Agreement status<select name="agreementStatus" defaultValue="ACTIVE"><option>ACTIVE</option><option>DRAFT</option></select></label><label>Effective date<input name="effectiveFrom" type="date" required defaultValue={today} /></label><label>Expiry date<input name="effectiveTo" type="date" /></label><label>Default bag weight (kg)<input name="defaultBagWeightKg" type="number" min="0.01" step="0.01" required defaultValue="60" /></label><label>Tariff / Price Agreement<select name="tariffVersion" required defaultValue={tariffOptions.find((item) => item.active)?.code ?? tariffOptions[0].code}>{tariffOptions.map((item) => <option key={item.code} value={item.code}>{item.name} {item.active ? "- Current" : "- Archived"} ({item.code})</option>)}</select></label></div>}</section>
    <section className="form-section representative-builder"><div className="section-title-row"><div><h3>3. Representatives (optional now)</h3><p className="form-note">Add only people already authorized to act for this client.</p></div><button className="secondary-button" type="button" onClick={addRepresentative}><Plus size={15} />Add representative</button></div>{representativeDrafts.length === 0 ? <div className="empty-input-lots"><UserRoundCheck size={22} /><strong>No representative added</strong><p>You can save the client now and complete readiness later.</p></div> : representativeDrafts.map((item, index) => <fieldset key={item.key}><legend>Representative {index + 1}</legend><div className="form-grid compact"><label>Full name<input required value={item.fullName} onChange={(event) => updateRepresentative(item.key, { fullName: event.target.value })} /></label><label>Identity number<input required value={item.identityNumber} onChange={(event) => updateRepresentative(item.key, { identityNumber: event.target.value })} /></label><label>Phone<input type="tel" value={item.phone} onChange={(event) => updateRepresentative(item.key, { phone: event.target.value })} /></label><label>Valid from<input type="date" required value={item.validFrom} onChange={(event) => updateRepresentative(item.key, { validFrom: event.target.value })} /></label><label>Valid to<input type="date" value={item.validTo} onChange={(event) => updateRepresentative(item.key, { validTo: event.target.value })} /></label><label className="check-label"><input type="checkbox" checked={item.active} onChange={(event) => updateRepresentative(item.key, { active: event.target.checked })} />Active authorization</label></div><button className="link-button reject" type="button" onClick={() => setRepresentativeDrafts((current) => current.filter((draft) => draft.key !== item.key))}>Remove representative</button></fieldset>)}</section>
    <footer><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={busy}><Check size={17} />{busy ? "Creating client..." : "Create client"}</button></footer>
  </form></div>;
}

function MasterRecordModal({ kind, clientOptions, onSaved, onClose }: {
  kind: MasterRecordKind;
  clientOptions: CoreClient[];
  onSaved: (message: string) => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const title = kind === "client" ? "Add Client" : kind === "agreement" ? "Add Client Agreement" : "Add Authorized Representative";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      if (kind === "client") {
        const record: NewClient = {
          code: String(data.get("code")), legalName: String(data.get("legalName")), tin: String(data.get("tin")),
          phone: String(data.get("phone")), email: String(data.get("email")),
        };
        await createClient(record);
        await onSaved(`${record.legalName} added. Add an active agreement and representative before the first GRN.`);
      } else if (kind === "agreement") {
        const effectiveFrom = String(data.get("effectiveFrom"));
        const effectiveTo = String(data.get("effectiveTo")) || null;
        if (effectiveTo && effectiveTo < effectiveFrom) throw new Error("Agreement expiry cannot be before its effective date.");
        const record: NewAgreement = {
          clientId: String(data.get("clientId")), agreementNumber: String(data.get("agreementNumber")), effectiveFrom, effectiveTo,
          status: String(data.get("status")) as NewAgreement["status"], defaultBagWeightKg: Number(data.get("defaultBagWeightKg")),
          tariffVersion: String(data.get("tariffVersion")),
        };
        await createAgreement(record);
        await onSaved(`${record.agreementNumber} added. The client also needs an active representative.`);
      } else {
        const validFrom = String(data.get("validFrom"));
        const validTo = String(data.get("validTo")) || null;
        if (validTo && validTo < validFrom) throw new Error("Authorization expiry cannot be before its start date.");
        const record: NewRepresentative = {
          clientId: String(data.get("clientId")), fullName: String(data.get("fullName")), identityNumber: String(data.get("identityNumber")),
          phone: String(data.get("phone")), validFrom, validTo, active: data.get("active") === "on",
        };
        await createRepresentative(record);
        await onSaved(`${record.fullName} added. The client is GRN-ready when its agreement and authorization are active.`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The record could not be saved.");
    }
  }

  return <div className="modal-backdrop" role="presentation"><form className="receipt-modal master-record-modal" onSubmit={submit} aria-label={title}>
    <header><div><span className="demo-label">CLIENT ONBOARDING</span><h2>{title}</h2><p>Master records remain available to all authorized warehouse workflows.</p></div><button type="button" aria-label="Close form" onClick={onClose}><X size={20} /></button></header>
    {error && <div className="request-form-error" role="alert">{error}</div>}
    <div className="form-grid">
      {kind === "client" ? <>
        <label>Client code<input name="code" required maxLength={30} placeholder="CL-0016" /></label>
        <label>Legal name<input name="legalName" required maxLength={180} /></label>
        <label>TIN<input name="tin" maxLength={60} /></label>
        <label>Phone<input name="phone" type="tel" maxLength={60} /></label>
        <label className="wide">Email<input name="email" type="email" maxLength={180} /></label>
      </> : <>
        <label className="wide">Client<select name="clientId" required defaultValue=""><option value="" disabled>Select client</option>{clientOptions.filter((client) => client.status !== "INACTIVE").map((client) => <option key={client.id} value={client.id}>{client.code} - {client.name}</option>)}</select></label>
        {kind === "agreement" ? <>
          <label>Agreement number<input name="agreementNumber" required maxLength={60} placeholder="AGR-2026-012" /></label>
          <label>Status<select name="status" defaultValue="DRAFT"><option>DRAFT</option><option>ACTIVE</option></select></label>
          <label>Effective date<input name="effectiveFrom" type="date" required defaultValue={today} /></label>
          <label>Expiry date<input name="effectiveTo" type="date" /></label>
          <label>Default bag weight (kg)<input name="defaultBagWeightKg" type="number" min="0.01" step="0.01" required defaultValue="60" /></label>
          <label>Tariff version<input name="tariffVersion" required maxLength={60} defaultValue="TV-001" /></label>
        </> : <>
          <label>Full name<input name="fullName" required maxLength={180} /></label>
          <label>Identity number<input name="identityNumber" required maxLength={80} /></label>
          <label>Phone<input name="phone" type="tel" maxLength={60} /></label>
          <label>Valid from<input name="validFrom" type="date" required defaultValue={today} /></label>
          <label>Valid to<input name="validTo" type="date" /></label>
          <label className="check-label"><input name="active" type="checkbox" defaultChecked />Active authorization</label>
        </>}
      </>}
    </div>
    <footer><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button"><Check size={17} />Save record</button></footer>
  </form></div>;
}

function NewReceipt({ receipt, clientOptions, agreementOptions, representativeOptions, originOptions, gradeOptions, onSave, onClose }: {
  receipt?: WarehouseReceipt;
  clientOptions: CoreClient[];
  agreementOptions: CoreAgreement[];
  representativeOptions: CoreRepresentative[];
  originOptions: string[];
  gradeOptions: string[];
  onSave: (receipt: WarehouseReceipt) => Promise<void>;
  onClose: () => void;
}) {
  const [gross, setGross] = useState(receipt?.grossWeightKg ?? 19850);
  const [tare, setTare] = useState(receipt?.tareWeightKg ?? 650);
  const [clientId, setClientId] = useState(receipt?.clientDatabaseId ?? clientOptions.find((item) => item.status === "READY")?.id ?? "");
  const [receivedAt, setReceivedAt] = useState(receipt?.receivedAt ?? defaultReceivedAt);
  const [formError, setFormError] = useState("");
  const net = Math.max(0, gross - tare);
  const readyClients = clientOptions.filter((item) => item.status === "READY" || item.id === receipt?.clientDatabaseId);
  const selectedClient = readyClients.find((item) => item.id === clientId) ?? readyClients[0];
  const receiptDate = receivedAt.slice(0, 10);
  const clientAgreements = agreementOptions.filter((item) => item.clientId === selectedClient?.id && activeOn(receiptDate, item.effectiveFrom, item.effectiveTo, item.status === "ACTIVE"));
  const clientRepresentatives = representativeOptions.filter((item) => item.clientId === selectedClient?.id && activeOn(receiptDate, item.validFrom, item.validTo, item.status === "ACTIVE"));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const agreement = clientAgreements.find((item) => item.id === data.get("agreementId"));
    const representative = clientRepresentatives.find((item) => item.id === data.get("representativeId"));
    if (!selectedClient || !agreement || !representative) {
      setFormError("Choose an operationally ready client with a valid agreement and representative.");
      return;
    }
    setFormError("");
    void onSave({
      databaseId: receipt?.databaseId,
      clientDatabaseId: selectedClient.id,
      agreementDatabaseId: agreement.id,
      representativeDatabaseId: representative.id,
      id: receipt?.id ?? "",
      client: selectedClient.name,
      agreement: agreement.number,
      representative: representative.name,
      receivedAt,
      warehouse: "Main Warehouse",
      section: String(data.get("section")),
      truckPlate: String(data.get("truckPlate")),
      driverName: String(data.get("driverName")),
      sealNumber: String(data.get("sealNumber")),
      weighbridgeRef: String(data.get("weighbridgeRef")),
      origin: String(data.get("origin")),
      coffeeType: String(data.get("coffeeType")) as WarehouseReceipt["coffeeType"],
      grade: String(data.get("grade")),
      cropYear: Number(data.get("cropYear")),
      bags: Number(data.get("bags")),
      bagWeightKg: Number(data.get("bagWeightKg")),
      grossWeightKg: gross,
      tareWeightKg: tare,
      netWeightKg: net,
      moisturePercent: Number(data.get("moisturePercent")),
      wetCoffee: data.get("wetCoffee") === "on",
      receivedBy: receipt?.receivedBy ?? "Meron Tadesse",
      createdBy: receipt?.createdBy ?? "Warehouse Clerk",
      status: "DRAFT",
    });
  }

  const cropYears = Array.from({ length: 6 }, (_, index) => new Date().getFullYear() - index);

  return <div className="modal-backdrop" role="presentation"><form className="receipt-modal grn-modal" onSubmit={submit} aria-label={receipt ? `Edit ${receipt.id}` : "New warehouse receipt"}>
    <header><div><span className="demo-label">{receipt ? "EDIT DRAFT GRN" : "NEW GRN"}</span><h2>{receipt ? receipt.id : "Register Arrival Coffee"}</h2><p>The GRN remains editable until it is submitted.</p></div><button type="button" aria-label="Close receipt" onClick={onClose}><X size={20} /></button></header>
    {formError && <div className="request-form-error" role="alert">{formError}</div>}
    <div className="form-section"><h3>Ownership and authorization</h3><div className="form-grid compact">
      <label>Client<select name="clientId" required value={selectedClient?.id ?? ""} onChange={(event) => setClientId(event.target.value)}><option value="" disabled>{readyClients.length ? "Select client" : "No operationally ready clients"}</option>{readyClients.map((client) => <option key={client.id} value={client.id}>{client.code} - {client.name}</option>)}</select></label>
      <label>Active agreement<select key={`agreement-${selectedClient?.id}-${receiptDate}`} name="agreementId" required defaultValue={receipt?.agreementDatabaseId ?? clientAgreements[0]?.id ?? ""}><option value="" disabled>{clientAgreements.length ? "Select agreement" : "No valid agreement"}</option>{clientAgreements.map((agreement) => <option key={agreement.id} value={agreement.id}>{agreement.number}</option>)}</select></label>
      <label>Authorized representative<select key={`representative-${selectedClient?.id}-${receiptDate}`} name="representativeId" required defaultValue={receipt?.representativeDatabaseId ?? clientRepresentatives[0]?.id ?? ""}><option value="" disabled>{clientRepresentatives.length ? "Select representative" : "No valid representative"}</option>{clientRepresentatives.map((representative) => <option key={representative.id} value={representative.id}>{representative.name}</option>)}</select></label>
      <label>Received date and time<input name="receivedAt" type="datetime-local" required value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} /></label>
    </div></div>
    <div className="form-section"><h3>Transport and location</h3><div className="form-grid compact">
      <label>Warehouse section<select name="section" defaultValue={receipt?.section ?? "A-01 Arrival"}><option>A-01 Arrival</option><option>A-02 Arrival</option><option>Q-01 Quarantine</option></select></label>
      <label>Truck plate<input name="truckPlate" required defaultValue={receipt?.truckPlate ?? "ET-3-48216"} /></label>
      <label>Driver name<input name="driverName" required defaultValue={receipt?.driverName ?? "Yonas Birhanu"} /></label>
      <label>Vehicle seal<input name="sealNumber" required defaultValue={receipt?.sealNumber ?? "SL-78291"} /></label>
      <label>Weighbridge reference<input name="weighbridgeRef" required defaultValue={receipt?.weighbridgeRef ?? "WB-24021"} /></label>
    </div></div>
    <div className="form-section"><h3>Coffee and measurement</h3><div className="form-grid compact">
      <label>Origin / region<select name="origin" required defaultValue={receipt?.origin ?? originOptions[0]}>{originOptions.map((origin) => <option key={origin}>{origin}</option>)}</select></label>
      <label>Coffee type<select name="coffeeType" defaultValue={receipt?.coffeeType ?? "Unwashed / UG"}><option>Washed</option><option>Unwashed / UG</option></select></label>
      <label>Grade<select name="grade" required defaultValue={receipt?.grade ?? gradeOptions[0]}>{gradeOptions.map((grade) => <option key={grade}>{grade}</option>)}</select></label>
      <label>Crop year<select name="cropYear" required defaultValue={receipt?.cropYear ?? new Date().getFullYear()}>{cropYears.map((year) => <option key={year}>{year}</option>)}</select></label>
      <label>Bags<input name="bags" type="number" min="1" required defaultValue={receipt?.bags ?? 320} /></label>
      <label>Bag weight (kg)<input name="bagWeightKg" type="number" min="1" step="0.01" required defaultValue={receipt?.bagWeightKg ?? 60} /></label>
      <label>Gross weight (kg)<input type="number" min="0.01" step="0.01" value={gross} onChange={(event) => setGross(Number(event.target.value))} required /></label>
      <label>Tare weight (kg)<input type="number" min="0" step="0.01" value={tare} onChange={(event) => setTare(Number(event.target.value))} required /></label>
      <label>Net weight (kg)<input value={net.toLocaleString()} readOnly /></label>
      <label>Moisture %<input name="moisturePercent" type="number" min="0" max="100" step="0.1" defaultValue={receipt?.moisturePercent ?? 10.8} required /></label>
      <label className="check-label"><input name="wetCoffee" type="checkbox" defaultChecked={receipt?.wetCoffee} />Wet-coffee exception indicator</label>
    </div></div>
    <div className="agreement-rule"><ShieldCheck size={18} /><span>Submission checks the active client agreement and representative. Posting creates one lot and one immutable receipt movement exactly once.</span></div>
    <footer><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={!selectedClient || !clientAgreements.length || !clientRepresentatives.length}><ClipboardCheck size={17} />{receipt ? "Update draft" : "Save draft"}</button></footer>
  </form></div>;
}

function LotTag({ lot, receipt, onClose }: { lot: CoffeeLot; receipt: WarehouseReceipt; onClose: () => void }) {
  return <div className="modal-backdrop"><div className="tag-dialog"><header><h2>Lot identification tag</h2><button type="button" onClick={onClose} aria-label="Close lot tag"><X size={20} /></button></header><div className="lot-tag print-surface lot-tag-print">
    <div className="tag-brand"><strong>HAYKED</strong><span>COFFEE WAREHOUSE ERP</span></div>
    <h3>{lot.lotNumber}</h3><div className="barcode" aria-label={`Barcode for ${lot.lotNumber}`} />
    <dl><div><dt>GRN</dt><dd>{receipt.id}</dd></div><div><dt>Client</dt><dd>{lot.client}</dd></div><div><dt>Coffee</dt><dd>{lot.coffee}, {lot.grade}</dd></div><div><dt>Quantity</dt><dd>{lot.bags} bags / {lot.weightKg.toLocaleString()} kg</dd></div><div><dt>Section</dt><dd>{lot.section}</dd></div><div><dt>Received</dt><dd>{receipt.receivedAt.replace("T", " ")}</dd></div></dl>
  </div><footer><button className="secondary-button" type="button" onClick={onClose}>Close</button><button className="primary-button" type="button" onClick={() => window.print()}><Printer size={17} />Print tag</button></footer></div></div>;
}

function GrnDocument({ receipt, onClose }: { receipt: WarehouseReceipt; onClose: () => void }) {
  return <div className="modal-backdrop"><div className="tag-dialog grn-dialog"><header><h2>Goods receipt note</h2><button type="button" onClick={onClose} aria-label="Close GRN"><X size={20} /></button></header><article className="grn-document print-surface grn-print">
    <div className="tag-brand"><strong>HAYKED</strong><span>COFFEE WAREHOUSE ERP</span></div><h3>GOODS RECEIPT NOTE</h3><strong className="grn-number">{receipt.id}</strong>
    <dl><div><dt>Client</dt><dd>{receipt.client}</dd></div><div><dt>Agreement</dt><dd>{receipt.agreement}</dd></div><div><dt>Representative</dt><dd>{receipt.representative}</dd></div><div><dt>Received</dt><dd>{receipt.receivedAt.replace("T", " ")}</dd></div><div><dt>Warehouse / section</dt><dd>{receipt.warehouse} / {receipt.section}</dd></div><div><dt>Coffee</dt><dd>{receipt.coffeeType}, {receipt.origin}, {receipt.grade}, crop {receipt.cropYear}</dd></div><div><dt>Vehicle / driver</dt><dd>{receipt.truckPlate} / {receipt.driverName}</dd></div><div><dt>Weighbridge</dt><dd>{receipt.weighbridgeRef}</dd></div><div><dt>Quantity</dt><dd>{receipt.bags} bags / {receipt.netWeightKg.toLocaleString()} kg net</dd></div><div><dt>Gross / tare</dt><dd>{receipt.grossWeightKg.toLocaleString()} / {receipt.tareWeightKg.toLocaleString()} kg</dd></div><div><dt>Moisture</dt><dd>{receipt.moisturePercent}%</dd></div><div><dt>Status</dt><dd>{receipt.status}</dd></div></dl>
    <div className="signature-row"><span>Prepared by</span><span>Checked by</span><span>Approved by</span></div>
  </article><footer><button className="secondary-button" type="button" onClick={onClose}>Close</button><button className="primary-button" type="button" onClick={() => window.print()}><Printer size={17} />Print GRN</button></footer></div></div>;
}

function LotDetail({ lot, receipt, movements, onPrintGrn, onPrintTag, onClose }: { lot: CoffeeLot; receipt?: WarehouseReceipt; movements: StockMovement[]; onPrintGrn: () => void; onPrintTag: () => void; onClose: () => void }) {
  return <div className="modal-backdrop"><div className="lot-detail-dialog"><header><div><span className="demo-label">STOCK LOT</span><h2>{lot.lotNumber}</h2><p>{lot.client}</p></div><button type="button" onClick={onClose} aria-label="Close lot details"><X size={20} /></button></header><dl><div><dt>Source GRN</dt><dd>{lot.sourceGrn}</dd></div><div><dt>Coffee</dt><dd>{lot.coffee}, {lot.grade}</dd></div><div><dt>Location</dt><dd>{lot.section}</dd></div><div><dt>Balance</dt><dd>{lot.bags} bags / {lot.weightKg.toLocaleString()} kg</dd></div><div><dt>Status</dt><dd><Status value={lot.status} /></dd></div></dl><section><h3>Movement history</h3>{movements.filter((movement) => movement.lotNumber === lot.lotNumber).map((movement) => <div key={movement.id}><span>{movement.id}</span><span>{movement.type}</span><strong>{movement.weightDeltaKg > 0 ? "+" : ""}{movement.weightDeltaKg.toLocaleString()} kg</strong></div>)}</section><footer><button className="secondary-button" type="button" onClick={onClose}>Close</button>{receipt && <button className="secondary-button" type="button" onClick={onPrintGrn}><FileText size={16} />GRN</button>}<button className="primary-button" type="button" onClick={onPrintTag}><Printer size={16} />Lot tag</button></footer></div></div>;
}

export function CoreOperations({ activeView, stockIntent }: { activeView: string; stockIntent?: { type: StockTypeFilter; status: StockStatusFilter; focusId?: string } }) {
  const [receipts, setReceipts] = useState(initialReceipts);
  const [lots, setLots] = useState(initialLots);
  const [movements, setMovements] = useState(initialMovements);
  const [newReceiptOpen, setNewReceiptOpen] = useState(false);
  const [editReceipt, setEditReceipt] = useState<WarehouseReceipt | null>(null);
  const [masterModal, setMasterModal] = useState<MasterRecordKind | null>(null);
  const [tagLot, setTagLot] = useState<CoffeeLot | null>(null);
  const [detailLot, setDetailLot] = useState<CoffeeLot | null>(null);
  const [printReceipt, setPrintReceipt] = useState<WarehouseReceipt | null>(null);
  const [reverseTarget, setReverseTarget] = useState<WarehouseReceipt | null>(null);
  const [selectedMaster, setSelectedMaster] = useState<{ kind: "client"; record: CoreClient } | { kind: "agreement"; record: CoreAgreement } | { kind: "representative"; record: CoreRepresentative } | null>(null);
  const [message, setMessage] = useState("");
  const [data, setData] = useState<CoreData | null>(null);
  const [stockType, setStockType] = useState<StockTypeFilter>(stockIntent?.type ?? "All");
  const [stockStatus, setStockStatus] = useState<StockStatusFilter>(stockIntent?.status ?? "All");
  const [stockClient, setStockClient] = useState("All");
  const [stockSearch, setStockSearch] = useState("");

  async function reload() {
    try {
      const next = await loadCoreData();
      setData(next);
      setReceipts(next.receipts);
      setLots(next.lots);
      setMovements(next.movements);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Warehouse records could not be loaded.");
    }
  }

  // The initial database snapshot is loaded once when this module opens.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, []);

  // Dashboard and global-search links update the stock workspace without changing database values.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!stockIntent) return;
    setStockType(stockIntent.type);
    setStockStatus(stockIntent.status);
    if (!stockIntent.focusId || !data) return;
    if (activeView === "Coffee Lots") {
      setDetailLot(data.lots.find((lot) => lot.databaseId === stockIntent.focusId) ?? null);
    }
    if (activeView === "Warehouse Receipts") {
      setPrintReceipt(data.receipts.find((receipt) => receipt.databaseId === stockIntent.focusId) ?? null);
    }
  }, [activeView, data, stockIntent]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const stock = useMemo(() => movements.reduce((total, movement) => total + movement.weightDeltaKg, 0), [movements]);

  async function masterRecordSaved(nextMessage: string) {
    await reload();
    setMasterModal(null);
    setMessage(nextMessage);
  }

  async function saveReceipt(receipt: WarehouseReceipt) {
    try {
      const number = receipt.databaseId ? receipt.id : await createWarehouseReceipt(receipt);
      if (receipt.databaseId) await updateWarehouseReceiptDraft(receipt);
      await reload();
      setNewReceiptOpen(false);
      setEditReceipt(null);
      setMessage(`${number} ${receipt.databaseId ? "updated" : "saved"} as a persistent draft.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The GRN could not be saved.");
    }
  }

  async function runAction(receipt: WarehouseReceipt) {
    try {
      if (receipt.status === "DRAFT" || receipt.status === "SUBMITTED") {
        const target = receipt.status === "DRAFT" ? "SUBMITTED" : "APPROVED";
        await transitionGrn(receipt, target);
        await reload();
        setMessage(`${receipt.id} moved to ${target.toLowerCase()}.`);
        return;
      }
      if (receipt.status === "APPROVED") {
        await transitionGrn(receipt, "POSTED");
        await reload();
        setMessage(`${receipt.id} posted with its lot and immutable stock movement.`);
        return;
      }
      if (receipt.status === "POSTED" && receipt.lotNumber) setTagLot(lots.find((lot) => lot.lotNumber === receipt.lotNumber) ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The action could not be completed.");
    }
  }

  async function confirmReversal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reverseTarget?.lotNumber) return;
    const reason = String(new FormData(event.currentTarget).get("reason"));
    try {
      await transitionGrn(reverseTarget, "REVERSED", reason);
      await reload();
      setReverseTarget(null);
      setMessage(`${reverseTarget.id} reversed with a compensating stock movement.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Reversal failed."); }
  }

  const visibleClients = data?.clients ?? clients;
  const visibleAgreements = data?.agreements ?? agreements;
  const visibleRepresentatives = data?.representatives ?? representatives;
  const visibleTariffs = data?.tariffs ?? [];
  const stockClients = [...new Set(lots.map((lot) => lot.client))].sort();
  const filteredLots = lots.filter((lot) => stockMatches(lot, stockType, stockStatus, stockClient, stockSearch));
  const originOptions = [...new Set([...receipts, ...initialReceipts].map((receipt) => receipt.origin).filter((value) => value && value !== "-"))];
  const gradeOptions = [...new Set([...receipts, ...initialReceipts].map((receipt) => receipt.grade).filter((value) => value && value !== "-"))];
  const openMasterOnKey = (event: React.KeyboardEvent, record: NonNullable<typeof selectedMaster>) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedMaster(record); }
  };
  const tables: Record<string, React.ReactNode> = {
    Clients: <><PageHeader eyebrow="CLIENT MASTER" title="Clients" copy="Touch any client to see agreements, representatives, and stock in one place." action={<button className="primary-button" type="button" onClick={() => setMasterModal("client")}><Plus size={17} />New client</button>} /><OperationMessage message={message} onClose={() => setMessage("")} /><section className="record-panel"><div className="record-table five-cols"><div className="table-head"><span>Client</span><span>TIN</span><span>Agreement</span><span>Current stock</span><span>Readiness</span></div>{visibleClients.map((client) => <div className="clickable-row" role="button" tabIndex={0} key={client.id} onClick={() => setSelectedMaster({ kind: "client", record: client })} onKeyDown={(event) => openMasterOnKey(event, { kind: "client", record: client })}><span><strong>{client.name}</strong><small>{client.code}</small></span><span>{client.tin}</span><span className="reference">{client.agreement}</span><span>{client.stock}</span><span><Status value={client.status} /></span></div>)}</div></section></>,
    Agreements: <><PageHeader eyebrow="AGREEMENT CONTROL" title="Client agreements" copy="Touch an agreement to see every date, control, and supporting file." action={<button className="primary-button" type="button" onClick={() => setMasterModal("agreement")}><Plus size={17} />New agreement</button>} /><OperationMessage message={message} onClose={() => setMessage("")} /><section className="record-panel"><div className="record-table six-cols"><div className="table-head"><span>Agreement</span><span>Client</span><span>Source</span><span>Effective</span><span>Expiry</span><span>Status</span></div>{visibleAgreements.map((agreement) => <div className="clickable-row" role="button" tabIndex={0} key={agreement.id} onClick={() => setSelectedMaster({ kind: "agreement", record: agreement })} onKeyDown={(event) => openMasterOnKey(event, { kind: "agreement", record: agreement })}><span className="reference">{agreement.number}</span><span>{agreement.client}</span><span>{agreement.source}</span><span>{agreement.effective}</span><span>{agreement.expiry}</span><span><Status value={agreement.status} /></span></div>)}</div></section></>,
    Representatives: <><PageHeader eyebrow="AUTHORIZATION" title="Authorized representatives" copy="Touch a person to review identity, permission scope, and validity." action={<button className="primary-button" type="button" onClick={() => setMasterModal("representative")}><Plus size={17} />New representative</button>} /><OperationMessage message={message} onClose={() => setMessage("")} /><section className="record-panel"><div className="record-table five-cols"><div className="table-head"><span>Representative</span><span>Client</span><span>Contact</span><span>Allowed actions</span><span>Status</span></div>{visibleRepresentatives.map((representative) => <div className="clickable-row" role="button" tabIndex={0} key={representative.id} onClick={() => setSelectedMaster({ kind: "representative", record: representative })} onKeyDown={(event) => openMasterOnKey(event, { kind: "representative", record: representative })}><span><strong>{representative.name}</strong><small>Expires {representative.expiry}</small></span><span>{representative.client}</span><span>{representative.phone}</span><span>{representative.scope}</span><span><Status value={representative.status} /></span></div>)}</div></section></>,
  };

  if (tables[activeView]) return <div className="module-page">{tables[activeView]}{masterModal === "client" ? <NewClientModal tariffs={visibleTariffs} onSaved={masterRecordSaved} onClose={() => setMasterModal(null)} /> : masterModal ? <MasterRecordModal kind={masterModal} clientOptions={visibleClients} onSaved={masterRecordSaved} onClose={() => setMasterModal(null)} /> : null}{selectedMaster && <RecordDetailDrawer open eyebrow={selectedMaster.kind === "client" ? "CLIENT ACCOUNT" : selectedMaster.kind === "agreement" ? "AGREEMENT CONTROL" : "AUTHORIZED PERSON"} title={selectedMaster.kind === "client" ? selectedMaster.record.name : selectedMaster.kind === "agreement" ? selectedMaster.record.number : selectedMaster.record.name} subtitle={selectedMaster.kind === "client" ? selectedMaster.record.code : selectedMaster.record.client} status={<Status value={selectedMaster.record.status} />} onClose={() => setSelectedMaster(null)}>{selectedMaster.kind === "client" ? <><DetailGrid items={[{ label: "TIN", value: selectedMaster.record.tin }, { label: "Current agreement", value: selectedMaster.record.agreement }, { label: "Current stock", value: selectedMaster.record.stock }, { label: "Readiness", value: selectedMaster.record.status }]} /><DetailSection title="Linked agreements" help="All agreements currently visible for this client.">{visibleAgreements.filter((item) => item.clientId === selectedMaster.record.id).map((item) => <button className="detail-list-row" type="button" key={item.id} onClick={() => setSelectedMaster({ kind: "agreement", record: item })}><strong>{item.number}</strong><span>{item.effective} to {item.expiry}</span><Status value={item.status} /></button>)}</DetailSection><DetailSection title="Authorized representatives">{visibleRepresentatives.filter((item) => item.clientId === selectedMaster.record.id).map((item) => <button className="detail-list-row" type="button" key={item.id} onClick={() => setSelectedMaster({ kind: "representative", record: item })}><strong>{item.name}</strong><span>{item.phone}</span><Status value={item.status} /></button>)}</DetailSection></> : selectedMaster.kind === "agreement" ? <><DetailGrid items={[{ label: "Client", value: selectedMaster.record.client }, { label: "Legal source", value: selectedMaster.record.source }, { label: "Effective from", value: selectedMaster.record.effective }, { label: "Expiry", value: selectedMaster.record.expiry }, { label: "Tariff", value: selectedMaster.record.tariff }, { label: "Status", value: selectedMaster.record.status }]} /><EvidenceUploader reference={selectedMaster.record.id.startsWith("demo-") ? undefined : { type: "AGREEMENT", id: selectedMaster.record.id, label: selectedMaster.record.number }} documentType="CLIENT_AGREEMENT" label="Agreement document" help="Attach the signed PDF or a clear JPG/PNG scan." /></> : <DetailGrid items={[{ label: "Client", value: selectedMaster.record.client }, { label: "Identity number", value: selectedMaster.record.identityNumber }, { label: "Phone", value: selectedMaster.record.phone }, { label: "Allowed actions", value: selectedMaster.record.scope }, { label: "Valid from", value: selectedMaster.record.validFrom }, { label: "Valid to", value: selectedMaster.record.expiry }]} />}</RecordDetailDrawer>}</div>;

  if (activeView === "Coffee Lots") return <div className="module-page"><PageHeader eyebrow="STOCK LEDGER" title="Coffee Stock" copy="Type explains what the coffee is. Status explains what is happening to it now. Balances remain movement-ledger derived." action={<div className="stock-total"><span>Posted stock</span><strong>{stock.toLocaleString()} kg</strong></div>} /><section className="stock-filter-workspace" aria-label="Coffee stock filters"><div><span>Type</span>{(["All", "Arrival", "Processed", "Reject"] as StockTypeFilter[]).map((value) => <button type="button" className={stockType === value ? "active" : ""} key={value} onClick={() => setStockType(value)}>{value}</button>)}</div><label>Status<select value={stockStatus} onChange={(event) => setStockStatus(event.target.value as StockStatusFilter)}>{(["All", "Available", "Waiting Processing", "In Processing", "Awaiting Dispatch", "Closed"] as StockStatusFilter[]).map((value) => <option key={value}>{value}</option>)}</select></label><label>Client<select value={stockClient} onChange={(event) => setStockClient(event.target.value)}><option>All</option>{stockClients.map((client) => <option key={client}>{client}</option>)}</select></label><label className="stock-search"><Search size={15} /><input value={stockSearch} onChange={(event) => setStockSearch(event.target.value)} placeholder="Search lot, GRN, coffee or section" /></label><button className="secondary-button" type="button" onClick={() => { setStockType("All"); setStockStatus("All"); setStockClient("All"); setStockSearch(""); }}>Reset</button></section><section className="record-panel"><div className="record-table eight-cols lot-cols"><div className="table-head"><span>Lot</span><span>Client</span><span>Type</span><span>Coffee</span><span>Section</span><span>Bags</span><span>Weight</span><span>Status</span></div>{filteredLots.map((lot) => <button className="lot-table-row" type="button" key={lot.lotNumber} onClick={() => setDetailLot(lot)}><span><strong className="reference">{lot.lotNumber}</strong><small>{lot.sourceGrn}</small></span><span>{lot.client}</span><span><Status value={lotTypeLabel(lot)} /></span><span>{lot.coffee}<small>{lot.grade}</small></span><span>{lot.section}</span><span>{lot.bags}</span><span>{lot.weightKg.toLocaleString()} kg</span><span><Status value={lotStatusLabel(lot.status)} /></span></button>)}</div>{filteredLots.length === 0 && <p className="empty-result">No coffee stock matches the selected filters.</p>}</section><section className="ledger-panel"><h2>Movement ledger</h2>{movements.map((movement) => <div key={movement.id}><span><History size={15} />{movement.id}</span><span>{movement.type.replaceAll("_", " ")}</span><span>{movement.lotNumber}</span><strong className={movement.weightDeltaKg < 0 ? "negative" : "positive"}>{movement.weightDeltaKg > 0 ? "+" : ""}{movement.weightDeltaKg.toLocaleString()} kg</strong></div>)}</section>{detailLot && <LotDetail lot={detailLot} receipt={receipts.find((item) => item.id === detailLot.sourceGrn)} movements={movements} onPrintGrn={() => { setPrintReceipt(receipts.find((item) => item.id === detailLot.sourceGrn) ?? null); setDetailLot(null); }} onPrintTag={() => { setTagLot(detailLot); setDetailLot(null); }} onClose={() => setDetailLot(null)} />}{tagLot && <LotTag lot={tagLot} receipt={receipts.find((item) => item.id === tagLot.sourceGrn)!} onClose={() => setTagLot(null)} />}{printReceipt && <GrnDocument receipt={printReceipt} onClose={() => setPrintReceipt(null)} />}</div>;

  return <div className="module-page">
    <PageHeader eyebrow="ARRIVAL COFFEE" title="Receive Coffee" copy="Draft, approve, and post each warehouse receipt exactly once." action={<button className="primary-button" type="button" onClick={() => setNewReceiptOpen(true)}><Plus size={17} />New receipt</button>} />
    <OperationMessage message={message} onClose={() => setMessage("")} />
    <WorkflowGuide title="How receiving works" steps={[{ label: "Draft", help: "Record delivery and attach evidence", state: "current" }, { label: "Submit", help: "Confirm agreement and representative", state: "next" }, { label: "Approve", help: "Independent manager review", state: "next" }, { label: "Post", help: "Create the lot and stock", state: "next" }]} />
    <section className="grn-summary"><article><Warehouse size={18} /><span>Posted receipts<strong>{receipts.filter((item) => item.status === "POSTED").length}</strong></span></article><article><ClipboardCheck size={18} /><span>Awaiting approval<strong>{receipts.filter((item) => item.status === "SUBMITTED").length}</strong></span></article><article><Scale size={18} /><span>Posted net weight<strong>{stock.toLocaleString()} kg</strong></span></article></section>
    <section className="record-panel"><div className="record-table grn-cols"><div className="table-head"><span>GRN</span><span>Client</span><span>Coffee</span><span>Quantity</span><span>Received</span><span>Status</span><span>Action</span></div>{receipts.map((receipt) => <div key={receipt.id}><span><button className="link-button" type="button" onClick={() => setPrintReceipt(receipt)}><strong className="reference">{receipt.id}</strong></button><small>{receipt.weighbridgeRef}</small></span><span><strong>{receipt.client}</strong><small>{receipt.representative}</small></span><span>{receipt.coffeeType} {receipt.origin}<small>{receipt.grade}</small></span><span>{receipt.bags} bags<small>{receipt.netWeightKg.toLocaleString()} kg</small></span><span>{receipt.receivedAt.replace("T", " ")}</span><span><Status value={receipt.status} /></span><span className="row-actions">{receipt.status === "DRAFT" && <button type="button" title={`Edit ${receipt.id}`} onClick={() => setEditReceipt(receipt)}><Pencil size={13} />Edit</button>}<button type="button" onClick={() => runAction(receipt)}>{receipt.status === "DRAFT" ? "Submit" : receipt.status === "SUBMITTED" ? "Approve" : receipt.status === "APPROVED" ? "Post" : receipt.status === "POSTED" ? "Lot tag" : "Closed"}<ArrowRight size={13} /></button>{receipt.status === "POSTED" && <button className="reverse-action" type="button" title="Reverse posted GRN" onClick={() => setReverseTarget(receipt)}><RotateCcw size={14} /></button>}</span></div>)}</div></section>
    {newReceiptOpen && <NewReceipt clientOptions={visibleClients} agreementOptions={visibleAgreements} representativeOptions={visibleRepresentatives} originOptions={originOptions} gradeOptions={gradeOptions} onSave={saveReceipt} onClose={() => setNewReceiptOpen(false)} />}
    {editReceipt && <NewReceipt receipt={editReceipt} clientOptions={visibleClients} agreementOptions={visibleAgreements} representativeOptions={visibleRepresentatives} originOptions={originOptions} gradeOptions={gradeOptions} onSave={saveReceipt} onClose={() => setEditReceipt(null)} />}
    {tagLot && <LotTag lot={tagLot} receipt={receipts.find((item) => item.id === tagLot.sourceGrn)!} onClose={() => setTagLot(null)} />}
    {printReceipt && <GrnDocument receipt={printReceipt} onClose={() => setPrintReceipt(null)} />}
    {reverseTarget && <div className="modal-backdrop"><form className="reverse-dialog" onSubmit={confirmReversal}><header><div><span className="demo-label">CONTROLLED CORRECTION</span><h2>Reverse {reverseTarget.id}</h2></div><button type="button" onClick={() => setReverseTarget(null)}><X size={20} /></button></header><p>Posted records are never edited or deleted. This creates a compensating stock movement and closes the lot.</p><label>Reversal reason<textarea name="reason" required minLength={10} placeholder="Explain why the posted receipt must be reversed..." /></label><footer><button type="button" className="secondary-button" onClick={() => setReverseTarget(null)}>Cancel</button><button type="submit" className="danger-button"><RotateCcw size={16} />Confirm reversal</button></footer></form></div>}
  </div>;
}

export const coreViews = tabs;
