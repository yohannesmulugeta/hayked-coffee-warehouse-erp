"use client";

import { Check, ChevronRight, Eye, FileText, LoaderCircle, Paperclip, Upload, X } from "lucide-react";
import { ChangeEvent, ReactNode, useRef, useState } from "react";
import { uploadBusinessDocument, type BusinessReference } from "@/lib/erp-data";

export type WorkflowStep = {
  label: string;
  help: string;
  state: "done" | "current" | "next";
};

export function WorkflowGuide({ steps, title = "Your next action" }: { steps: WorkflowStep[]; title?: string }) {
  const current = steps.find((step) => step.state === "current");
  return <section className="action-guide" aria-label="Workflow progress">
    <header><span>{title}</span><strong>{current?.label ?? "Workflow complete"}</strong><small>{current?.help ?? "Every required step is complete."}</small></header>
    <div className="action-guide-steps">{steps.map((step, index) => <div className={step.state} key={step.label}>
      <i>{step.state === "done" ? <Check size={15} /> : index + 1}</i>
      <span><strong>{step.label}</strong><small>{step.help}</small></span>
      {index < steps.length - 1 && <ChevronRight size={15} />}
    </div>)}</div>
  </section>;
}

export function RecordDetailDrawer({
  open,
  eyebrow,
  title,
  subtitle,
  status,
  children,
  actions,
  onClose,
}: {
  open: boolean;
  eyebrow: string;
  title: string;
  subtitle?: string;
  status?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return <div className="record-drawer-layer" role="presentation">
    <button className="record-drawer-scrim" type="button" aria-label="Close details" onClick={onClose} />
    <aside className="record-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="record-drawer-title">
      <header><div><span>{eyebrow}</span><h2 id="record-drawer-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{status}<button type="button" onClick={onClose} aria-label="Close details"><X size={20} /></button></header>
      <div className="record-detail-body">{children}</div>
      <footer><button className="secondary-button" type="button" onClick={onClose}>Close</button>{actions}</footer>
    </aside>
  </div>;
}

export function DetailGrid({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return <dl className="detail-grid">{items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value || "-"}</dd></div>)}</dl>;
}

export function DetailSection({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return <section className="detail-section"><header><h3>{title}</h3>{help && <p>{help}</p>}</header>{children}</section>;
}

export function EvidenceUploader({
  reference,
  documentType,
  label,
  help,
  onUploaded,
}: {
  reference?: BusinessReference;
  documentType: string;
  label: string;
  help: string;
  onUploaded?: (documentNumber: string, fileName: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [uploaded, setUploaded] = useState<{ number: string; name: string } | null>(null);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!reference) { setError("Save the record first, then attach its document."); return; }
    if (!file.size || file.size > 20 * 1024 * 1024) { setError("Choose a file smaller than 20 MB."); return; }
    if (!/^(image\/(jpeg|png)|application\/pdf)$/i.test(file.type)) { setError("Use a PDF, JPG, or PNG file."); return; }
    setUploading(true); setError("");
    try {
      const number = await uploadBusinessDocument(file, documentType, reference);
      setUploaded({ number, name: file.name });
      onUploaded?.(number, file.name);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The document could not be uploaded.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  return <div className="evidence-uploader">
    <div><Paperclip size={18} /><span><strong>{label}</strong><small>{help}</small></span></div>
    <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png" onChange={chooseFile} hidden />
    {uploaded ? <div className="uploaded-evidence"><Check size={17} /><span><strong>{uploaded.name}</strong><small>{uploaded.number}</small></span><button type="button" title="Document saved in the controlled register"><Eye size={16} /></button></div> : <button className="evidence-drop" type="button" onClick={() => inputRef.current?.click()} disabled={uploading || !reference}>
      {uploading ? <LoaderCircle className="spin" size={22} /> : <Upload size={22} />}
      <strong>{uploading ? "Uploading..." : reference ? "Add PDF or image" : "Save record before attaching"}</strong>
      <small>PDF, JPG or PNG · maximum 20 MB</small>
    </button>}
    {error && <p className="field-error">{error}</p>}
  </div>;
}

export function DocumentLink({ name, number }: { name: string; number: string }) {
  return <div className="document-link"><FileText size={17} /><span><strong>{name}</strong><small>{number}</small></span></div>;
}
