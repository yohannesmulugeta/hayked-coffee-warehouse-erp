"use client";

import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  Check,
  Eye,
  FileCheck2,
  LockKeyhole,
  Printer,
  ReceiptText,
  Search,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { allocatePayment, type StorageCategory } from "./finance-rules";
import {
  loadFinanceData,
  quoteStorageBilling,
  recordPayment as postPayment,
  runStorageBilling,
  type FinanceData,
  type ServiceEventRow,
  type StorageQuote,
} from "@/lib/erp-data";
import { daysOverdue } from "./ux-rules";
import {
  DetailGrid,
  DetailSection,
  EvidenceUploader,
  RecordDetailDrawer,
  WorkflowGuide,
} from "./workflow-ui";

export const financeViews = ["Finance"];
type Tab =
  | "Client Accounts"
  | "Unbilled Services"
  | "Invoices"
  | "Payments"
  | "Storage Review"
  | "Client Statement"
  | "Rate Reference";

function Status({ value }: { value: string }) {
  return (
    <span className={`status-pill ${value.toLowerCase().replaceAll("_", "-")}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}
const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 7)}-01`;

export function FinanceOperations() {
  const [tab, setTab] = useState<Tab>("Client Accounts");
  const [message, setMessage] = useState("");
  const [data, setData] = useState<FinanceData | null>(null);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedLotId, setSelectedLotId] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [serviceType, setServiceType] = useState("All");
  const [billingFrom, setBillingFrom] = useState(monthStart);
  const [billingTo, setBillingTo] = useState(today);
  const [billingClientId, setBillingClientId] = useState("");
  const [billingQuery, setBillingQuery] = useState("");
  const [accountStatus, setAccountStatus] = useState("All");
  const [accountSort, setAccountSort] = useState("Outstanding high to low");
  const [category, setCategory] =
    useState<StorageCategory>("WAITING_PROCESSING");
  const [periodStart, setPeriodStart] = useState(monthStart);
  const [periodEnd, setPeriodEnd] = useState(today);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [paymentMethod, setPaymentMethod] = useState("BANK_TRANSFER");
  const [payerName, setPayerName] = useState("");
  const [financialInstitution, setFinancialInstitution] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [accountClientId, setAccountClientId] = useState("");
  const [statementClientId, setStatementClientId] = useState("");
  const [lastPayment, setLastPayment] = useState<{
    id: string;
    paymentNumber: string;
  } | null>(null);
  const [storage, setStorage] = useState<StorageQuote | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [showAllStorageDays, setShowAllStorageDays] = useState(false);
  const [selectedService, setSelectedService] = useState<ServiceEventRow | null>(null);
  const [invoicePreparationIds, setInvoicePreparationIds] = useState<string[]>([]);

  async function reloadFinance() {
    try {
      const next = await loadFinanceData();
      const defaultInvoice = next.invoices[0];
      const defaultClientId =
        defaultInvoice?.client_id ??
        next.clients.find((item) => item.active)?.id ??
        "";
      setData(next);
      setSelectedClientId((current) =>
        next.clients.some((item) => item.id === current)
          ? current
          : defaultClientId,
      );
      setSelectedInvoiceId((current) =>
        next.invoices.some((item) => item.id === current)
          ? current
          : (defaultInvoice?.id ?? ""),
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Billing records could not be loaded.",
      );
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reloadFinance();
  }, []);

  const clients = data?.clients.filter((item) => item.active) ?? [];
  const clientById = new Map(clients.map((item) => [item.id, item.legal_name]));
  const serviceTypes = [
    ...new Set((data?.serviceEvents ?? []).map((item) => item.service_type)),
  ].sort();
  const inBillingPeriod = (date: string | null) =>
    Boolean(
      date &&
      (!billingFrom || date.slice(0, 10) >= billingFrom) &&
      (!billingTo || date.slice(0, 10) <= billingTo),
    );
  const visibleServices = (data?.serviceEvents ?? []).filter(
    (item) =>
      !item.invoice_id &&
      item.status === "UNBILLED" &&
      (!billingClientId || item.client_id === billingClientId) &&
      (serviceType === "All" || item.service_type === serviceType) &&
      inBillingPeriod(item.created_at) &&
      `${clientById.get(item.client_id)} ${item.description} ${item.service_type}`
        .toLowerCase()
        .includes(billingQuery.trim().toLowerCase()),
  );
  const invoicePreparation = (data?.serviceEvents ?? []).filter((item) => invoicePreparationIds.includes(item.id));
  const invoicePreparationTotal = invoicePreparation.reduce((sum, item) => sum + Number(item.total_amount), 0);
  function toggleInvoicePreparation(service: ServiceEventRow) {
    const selectedClient = invoicePreparation[0]?.client_id;
    if (selectedClient && selectedClient !== service.client_id) {
      setMessage("Prepare one client invoice at a time. Clear the current selection first.");
      return;
    }
    setInvoicePreparationIds((current) => current.includes(service.id) ? current.filter((id) => id !== service.id) : [...current, service.id]);
    setSelectedService(null);
  }
  const invoiceRows = (data?.invoices ?? []).map((invoice) => {
    const paid = (data?.payments ?? [])
      .filter((payment) => payment.invoice_id === invoice.id)
      .reduce(
        (sum, payment) =>
          sum +
          (payment.direction === "REVERSAL"
            ? -Number(payment.amount_etb)
            : Number(payment.amount_etb)),
        0,
      );
    return {
      invoice,
      paid,
      outstanding: Math.max(0, Number(invoice.total_etb) - paid),
      overdue: daysOverdue(invoice.due_on),
    };
  });
  const clientAccounts = clients.map((client) => {
    const invoices = invoiceRows.filter(
      (row) => row.invoice.client_id === client.id,
    );
    const services = (data?.serviceEvents ?? []).filter(
      (item) =>
        item.client_id === client.id &&
        !item.invoice_id &&
        item.status === "UNBILLED",
    );
    const payments = (data?.payments ?? []).filter(
      (item) => item.client_id === client.id && item.direction !== "REVERSAL",
    );
    const periodInvoices = invoices.filter((row) =>
      inBillingPeriod(row.invoice.issued_on),
    );
    const periodServices = services.filter((row) =>
      inBillingPeriod(row.created_at),
    );
    const periodPayments = payments.filter((row) =>
      inBillingPeriod(row.paid_at),
    );
    const openInvoices = invoices.filter((row) => row.outstanding > 0);
    return {
      client,
      invoices,
      services,
      payments,
      billed: periodInvoices.reduce(
        (sum, row) => sum + Number(row.invoice.total_etb),
        0,
      ),
      paid: periodPayments.reduce(
        (sum, row) => sum + Number(row.amount_etb),
        0,
      ),
      outstanding: invoices.reduce((sum, row) => sum + row.outstanding, 0),
      unbilled: periodServices.reduce(
        (sum, row) => sum + Number(row.total_amount),
        0,
      ),
      oldestDue:
        openInvoices
          .map((row) => row.invoice.due_on)
          .filter(Boolean)
          .sort()[0] ?? null,
      overdue: openInvoices.some((row) => row.overdue > 0),
    };
  });
  const visibleClientAccounts = clientAccounts
    .filter((account) => {
      const matchesClient =
        !billingClientId || account.client.id === billingClientId;
      const matchesSearch =
        `${account.client.code} ${account.client.legal_name}`
          .toLowerCase()
          .includes(billingQuery.trim().toLowerCase());
      const matchesStatus =
        accountStatus === "All" ||
        (accountStatus === "Owing" && account.outstanding > 0) ||
        (accountStatus === "Overdue" && account.overdue) ||
        (accountStatus === "Clear" && account.outstanding === 0);
      return matchesClient && matchesSearch && matchesStatus;
    })
    .sort((a, b) =>
      accountSort === "Client A to Z"
        ? a.client.legal_name.localeCompare(b.client.legal_name)
        : accountSort === "Oldest unpaid"
          ? (a.oldestDue ?? "9999-12-31").localeCompare(
              b.oldestDue ?? "9999-12-31",
            )
          : b.outstanding - a.outstanding,
    );
  const filteredInvoiceRows = invoiceRows.filter(
    (row) =>
      (!billingClientId || row.invoice.client_id === billingClientId) &&
      inBillingPeriod(row.invoice.issued_on) &&
      `${row.invoice.invoice_number} ${clientById.get(row.invoice.client_id)}`
        .toLowerCase()
        .includes(billingQuery.trim().toLowerCase()) &&
      (accountStatus === "All" ||
        (accountStatus === "Owing" && row.outstanding > 0) ||
        (accountStatus === "Overdue" &&
          row.outstanding > 0 &&
          row.overdue > 0) ||
        (accountStatus === "Clear" && row.outstanding === 0)),
  );
  const openAccount = clientAccounts.find(
    (item) => item.client.id === accountClientId,
  );
  const selectedInvoiceRow =
    invoiceRows.find((item) => item.invoice.id === selectedInvoiceId) ??
    invoiceRows[0];
  const selectedClient = clients.find((item) => item.id === selectedClientId);
  const clientLots =
    data?.lots.filter(
      (item) =>
        item.client_id === selectedClientId && Number(item.quantity_kg) > 0,
    ) ?? [];
  const selectedLot = clientLots.find((item) => item.id === selectedLotId);
  const selectedLotCertified = Boolean(
    selectedLot?.certification_status === "VERIFIED" &&
    selectedLot.certification_schemes?.length &&
    selectedLot.certification_valid_from &&
    selectedLot.certification_valid_to &&
    selectedLot.certification_valid_from <= periodStart &&
    selectedLot.certification_valid_to >= periodEnd,
  );
  const tariff = data?.tariffs.find(
    (item) =>
      item.active &&
      item.verified_by_1 &&
      item.verified_by_2 &&
      item.verified_by_1 !== item.verified_by_2,
  );
  const visibleTariff = tariff ?? data?.tariffs[0];
  const visibleTariffLines =
    data?.tariffLineItems.filter(
      (item) => item.tariff_version_id === visibleTariff?.id,
    ) ?? [];
  const storagePosted = Boolean(
    storage &&
    data?.storageRuns.some(
      (item) => item.duplicate_key === storage.duplicateKey,
    ),
  );
  const storageRows = storage?.rows ?? [];
  const changedStorageRows = storageRows.filter(
    (row, index) =>
      index === 0 ||
      index === storageRows.length - 1 ||
      row.movementBags !== 0 ||
      row.rate !== storageRows[index - 1]?.rate,
  );
  const displayedStorageRows = showAllStorageDays
    ? storageRows
    : changedStorageRows;
  const statementClient =
    clients.find((item) => item.id === statementClientId) ??
    clients.find((item) => item.id === selectedInvoiceRow?.invoice.client_id);
  const statementAccount = clientAccounts.find(
    (item) => item.client.id === statementClient?.id,
  );

  function openPaymentFor(row: (typeof invoiceRows)[number]) {
    setSelectedInvoiceId(row.invoice.id);
    setPaymentAmount(row.outstanding);
    setStatementClientId(row.invoice.client_id);
    setBillingClientId(row.invoice.client_id);
    setLastPayment(null);
    setTab("Payments");
    setAccountClientId("");
  }
  const allStatementEvents = statementClient
    ? [
        ...invoiceRows
          .filter(
            (item) =>
              item.invoice.client_id === statementClient.id &&
              item.invoice.issued_on,
          )
          .map((item) => ({
            id: item.invoice.id,
            date: item.invoice.issued_on!,
            reference: item.invoice.invoice_number,
            description:
              item.invoice.line_snapshot
                .map((line) => line.description)
                .filter(Boolean)
                .join(", ") || "Warehouse services",
            debit: Number(item.invoice.total_etb),
            credit: 0,
          })),
        ...(data?.payments ?? [])
          .filter((item) => item.client_id === statementClient.id)
          .map((item) => ({
            id: item.id,
            date: item.paid_at.slice(0, 10),
            reference: item.payment_number,
            description: `${item.payment_method.replaceAll("_", " ")} · ${item.bank_reference}`,
            debit: item.direction === "REVERSAL" ? Number(item.amount_etb) : 0,
            credit: item.direction === "REVERSAL" ? 0 : Number(item.amount_etb),
          })),
      ].sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.reference.localeCompare(b.reference),
      )
    : [];
  const statementOpeningBalance = allStatementEvents
    .filter((item) => billingFrom && item.date < billingFrom)
    .reduce((sum, item) => sum + item.debit - item.credit, 0);
  const statementEventsInPeriod = allStatementEvents.filter(
    (item) =>
      (!billingFrom || item.date >= billingFrom) &&
      (!billingTo || item.date <= billingTo),
  );
  const statementEvents = statementEventsInPeriod.map((item, index) => ({
    ...item,
    balance:
      statementOpeningBalance +
      statementEventsInPeriod
        .slice(0, index + 1)
        .reduce((sum, event) => sum + event.debit - event.credit, 0),
  }));

  function clearStorageQuote() {
    setStorage(null);
    setStorageError("");
    setShowAllStorageDays(false);
  }
  function selectClient(clientId: string) {
    setSelectedClientId(clientId);
    setSelectedLotId("");
    clearStorageQuote();
  }

  async function calculateStorageQuote() {
    if (
      !selectedClient ||
      !selectedLot ||
      !visibleTariff ||
      periodStart > periodEnd
    )
      return;
    setStorageBusy(true);
    setStorageError("");
    setStorage(null);
    try {
      setStorage(
        await quoteStorageBilling({
          clientId: selectedClient.id,
          lotId: selectedLot.id,
          category,
          periodStart,
          periodEnd,
          tariffVersion: visibleTariff.version_code,
          certified: selectedLotCertified,
        }),
      );
    } catch (error) {
      setStorageError(
        error instanceof Error
          ? error.message
          : "The storage quote could not be calculated.",
      );
    } finally {
      setStorageBusy(false);
    }
  }

  async function postStorage() {
    if (!storage || !selectedLot || !selectedClient || !visibleTariff) return;
    if (!tariff) {
      setMessage(
        "Storage billing is disabled until the tariff has two independent verifications.",
      );
      return;
    }
    try {
      const runId = await runStorageBilling({
        clientId: selectedClient.id,
        lotId: selectedLot.id,
        category,
        periodStart,
        periodEnd,
        tariffVersion: visibleTariff.version_code,
        certified: selectedLotCertified,
      });
      await reloadFinance();
      setMessage(
        `Storage billing run ${runId.slice(0, 8).toUpperCase()} posted.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Storage billing run failed.",
      );
    }
  }

  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedInvoiceRow) return;
    try {
      allocatePayment(selectedInvoiceRow.outstanding, paymentAmount);
      const payment = await postPayment({
        invoiceId: selectedInvoiceRow.invoice.id,
        amount: paymentAmount,
        reference: paymentReference.trim(),
        paidAt: `${paymentDate}T12:00:00`,
        paymentMethod,
        payerName,
        financialInstitution,
        note: paymentNote,
      });
      setLastPayment({ id: payment.id, paymentNumber: payment.payment_number });
      await reloadFinance();
      setPaymentAmount(0);
      setPaymentReference("");
      setPayerName("");
      setFinancialInstitution("");
      setPaymentNote("");
      setMessage("Payment posted and allocated to the selected invoice.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Payment could not be posted.",
      );
    }
  }

  return (
    <div className="module-page finance-page">
      <section className="module-heading">
        <div>
          <span className="demo-label">CLIENT BILLING</span>
          <h1>Billing</h1>
          <p>
            Review unbilled services, invoices, outstanding balances, and
            payments without interpreting stock-control codes.
          </p>
        </div>
        <div className="finance-balance">
          <WalletCards size={19} />
          <span>
            Outstanding
            <strong>
              ETB{" "}
              {invoiceRows
                .reduce((sum, item) => sum + item.outstanding, 0)
                .toLocaleString()}
            </strong>
          </span>
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
        title="Billing journey"
        steps={[
          {
            label: "Client account",
            help: "See why each client owes money",
            state: tab === "Client Accounts" ? "current" : "done",
          },
          {
            label: "Review charges",
            help: "Check unbilled services and invoices",
            state: ["Unbilled Services", "Invoices", "Storage Review"].includes(
              tab,
            )
              ? "current"
              : tab === "Client Accounts"
                ? "next"
                : "done",
          },
          {
            label: "Record payment",
            help: "Allocate payment and attach slip",
            state:
              tab === "Payments"
                ? "current"
                : [
                      "Client Accounts",
                      "Unbilled Services",
                      "Invoices",
                      "Storage Review",
                    ].includes(tab)
                  ? "next"
                  : "done",
          },
          {
            label: "Statement",
            help: "Print the full client account",
            state: tab === "Client Statement" ? "current" : "next",
          },
        ]}
      />
      <div className="module-tabs billing-primary-tabs" role="tablist">
        {(
          [
            "Client Accounts",
            "Unbilled Services",
            "Invoices",
            "Payments",
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
        <details>
          <summary>More billing tools</summary>
          <div>
            {(
              ["Storage Review", "Client Statement", "Rate Reference"] as Tab[]
            ).map((item) => (
              <button
                className={tab === item ? "active" : ""}
                type="button"
                key={item}
                onClick={() => setTab(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </details>
      </div>

      {["Client Accounts", "Unbilled Services", "Invoices"].includes(tab) && (
        <section
          className="filter-toolbar billing-filter-toolbar"
          aria-label="Billing filters"
        >
          <label>
            From date
            <input
              type="date"
              value={billingFrom}
              onChange={(event) => setBillingFrom(event.target.value)}
            />
          </label>
          <label>
            To date
            <input
              type="date"
              min={billingFrom}
              value={billingTo}
              onChange={(event) => setBillingTo(event.target.value)}
            />
          </label>
          <label>
            Client
            <select
              value={billingClientId}
              onChange={(event) => setBillingClientId(event.target.value)}
            >
              <option value="">All clients</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.legal_name}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-search">
            <Search size={15} />
            <input
              value={billingQuery}
              onChange={(event) => setBillingQuery(event.target.value)}
              placeholder="Search client or reference"
              aria-label="Search billing"
            />
          </label>
          {tab !== "Unbilled Services" && (
            <label>
              Account status
              <select
                value={accountStatus}
                onChange={(event) => setAccountStatus(event.target.value)}
              >
                <option>All</option>
                <option>Owing</option>
                <option>Overdue</option>
                <option>Clear</option>
              </select>
            </label>
          )}
          {tab === "Unbilled Services" && (
            <label>
              Service type
              <select
                value={serviceType}
                onChange={(event) => setServiceType(event.target.value)}
              >
                <option>All</option>
                {serviceTypes.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          )}
          {tab === "Client Accounts" && (
            <label>
              Sort by
              <select
                value={accountSort}
                onChange={(event) => setAccountSort(event.target.value)}
              >
                <option>Outstanding high to low</option>
                <option>Oldest unpaid</option>
                <option>Client A to Z</option>
              </select>
            </label>
          )}
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setBillingFrom(monthStart);
              setBillingTo(today);
              setBillingClientId("");
              setBillingQuery("");
              setAccountStatus("All");
              setAccountSort("Outstanding high to low");
              setServiceType("All");
            }}
          >
            Reset
          </button>
          <p className="filter-help">
            Date filters change period activity. Current outstanding always
            shows the complete account balance.
          </p>
        </section>
      )}

      {tab === "Client Accounts" && (
        <section className="record-panel">
          <div className="record-table client-account-cols">
            <div className="table-head">
              <span>Client</span>
              <span>Period unbilled</span>
              <span>Period invoiced</span>
              <span>Period paid</span>
              <span>Current outstanding</span>
              <span>Oldest unpaid</span>
              <span>Action</span>
            </div>
            {visibleClientAccounts.map((account) => (
              <div
                className="clickable-row"
                role="button"
                tabIndex={0}
                key={account.client.id}
                onClick={() => setAccountClientId(account.client.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ")
                    setAccountClientId(account.client.id);
                }}
              >
                <span>
                  <strong>{account.client.legal_name}</strong>
                  <small>{account.client.code}</small>
                </span>
                <span>ETB {account.unbilled.toLocaleString()}</span>
                <span>ETB {account.billed.toLocaleString()}</span>
                <span>ETB {account.paid.toLocaleString()}</span>
                <span>
                  <strong
                    className={
                      account.outstanding > 0 ? "negative" : "positive"
                    }
                  >
                    ETB {account.outstanding.toLocaleString()}
                  </strong>
                </span>
                <span>
                  {account.oldestDue ?? "-"}
                  <small>
                    {account.overdue
                      ? "Overdue"
                      : account.outstanding > 0
                        ? "Open"
                        : "Clear"}
                  </small>
                </span>
                <span>
                  <button
                    className="table-action"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setAccountClientId(account.client.id);
                    }}
                  >
                    <Eye size={14} />
                    Full account
                  </button>
                </span>
              </div>
            ))}
          </div>
          {visibleClientAccounts.length === 0 && (
            <p className="empty-result">
              No client accounts match these filters.
            </p>
          )}
        </section>
      )}

      {tab === "Unbilled Services" && (
        <>
          <section className="record-panel">
            <div className="record-table unbilled-service-cols">
              <div className="table-head">
                <span>Date</span>
                <span>Client</span>
                <span>Service</span>
                <span>Reference</span>
                <span>Amount</span>
                <span>Status</span>
              </div>
              {visibleServices.map((item) => (
                <button className="clickable-row" type="button" key={item.id} onClick={() => setSelectedService(item)}>
                  <span>{item.service_date ?? item.created_at.slice(0, 10)}</span>
                  <span>
                    {clientById.get(item.client_id) ?? "Unknown client"}
                  </span>
                  <span>
                    <strong>{item.service_type.replaceAll("_", " ")}</strong>
                    <small>{item.description}</small>
                  </span>
                  <span className="reference">
                    {item.reference_id?.slice(0, 8).toUpperCase() ?? "MANUAL"}
                  </span>
                  <span>
                    ETB {Number(item.total_amount).toLocaleString()}
                    <small>
                      {Number(item.quantity).toLocaleString()} {item.unit_label} x{" "}
                      {Number(item.unit_price).toLocaleString()}
                    </small>
                  </span>
                  <Status value={item.status} />
                </button>
              ))}
            </div>
            {visibleServices.length === 0 && (
              <p className="empty-result">
                No unbilled services match the selected filters.
              </p>
            )}
          </section>
          {invoicePreparation.length > 0 && <section className="invoice-preparation-summary"><div><strong>Invoice preparation</strong><p>{invoicePreparation.length} service(s) for {clientById.get(invoicePreparation[0].client_id)} · ETB {invoicePreparationTotal.toLocaleString()}</p></div><button className="secondary-button" type="button" onClick={() => setInvoicePreparationIds([])}>Clear selection</button></section>}
          <div className="locked-action">
            <LockKeyhole size={16} />
            <span>
              <strong>{invoicePreparation.length ? "Services selected; final invoice still controlled" : "Invoice creation remains controlled"}</strong>
              <small>
                Selecting and issuing service events stays disabled until
                verified tax mappings and invoice rules are confirmed.
              </small>
            </span>
            <button type="button" disabled>
              Create invoice
            </button>
          </div>
        </>
      )}

      {tab === "Invoices" && (
        <section className="record-panel">
          <div className="record-table invoice-workspace-cols">
            <div className="table-head">
              <span>Invoice</span>
              <span>Client</span>
              <span>Issue / due</span>
              <span>Total</span>
              <span>Paid</span>
              <span>Outstanding</span>
              <span>Status</span>
              <span>Action</span>
            </div>
            {filteredInvoiceRows.map((item) => (
              <div key={item.invoice.id}>
                <span className="reference">{item.invoice.invoice_number}</span>
                <span>
                  {clientById.get(item.invoice.client_id) ?? "Unknown client"}
                </span>
                <span>
                  {item.invoice.issued_on ?? "Draft"}
                  <small>
                    Due {item.invoice.due_on ?? "-"}
                    {item.overdue > 0 && item.outstanding > 0
                      ? ` - ${item.overdue} days overdue`
                      : ""}
                  </small>
                </span>
                <span>
                  ETB {Number(item.invoice.total_etb).toLocaleString()}
                </span>
                <span>ETB {item.paid.toLocaleString()}</span>
                <span>
                  <strong>ETB {item.outstanding.toLocaleString()}</strong>
                </span>
                <Status
                  value={
                    item.outstanding === 0
                      ? "PAID"
                      : item.overdue > 0
                        ? "OVERDUE"
                        : item.invoice.status
                  }
                />
                <span>
                  <button
                    className="table-action"
                    type="button"
                    disabled={item.outstanding === 0}
                    onClick={() => {
                      setSelectedInvoiceId(item.invoice.id);
                      setPaymentAmount(item.outstanding);
                      setTab("Payments");
                    }}
                  >
                    Record payment
                  </button>
                </span>
              </div>
            ))}
          </div>
          {filteredInvoiceRows.length === 0 && (
            <p className="empty-result">No invoices match these filters.</p>
          )}
        </section>
      )}

      {tab === "Payments" && (
        <div className="payment-layout">
          <form className="payment-form" onSubmit={recordPayment}>
            <header>
              <Banknote size={19} />
              <div>
                <h2>Record payment</h2>
                <p>
                  Allocate one verified payment to one invoice, then attach the
                  supporting slip.
                </p>
              </div>
            </header>
            <label>
              Invoice
              <select
                required
                value={selectedInvoiceRow?.invoice.id ?? ""}
                onChange={(event) => {
                  const row = invoiceRows.find(
                    (item) => item.invoice.id === event.target.value,
                  );
                  setSelectedInvoiceId(event.target.value);
                  setPaymentAmount(row?.outstanding ?? 0);
                  setStatementClientId(row?.invoice.client_id ?? "");
                  setLastPayment(null);
                }}
              >
                <option value="" disabled>
                  Select invoice
                </option>
                {invoiceRows
                  .filter((item) => item.outstanding > 0)
                  .map((item) => (
                    <option key={item.invoice.id} value={item.invoice.id}>
                      {item.invoice.invoice_number} -{" "}
                      {clientById.get(item.invoice.client_id)} - ETB{" "}
                      {item.outstanding.toLocaleString()}
                    </option>
                  ))}
              </select>
            </label>
            <div className="form-grid compact payment-detail-grid">
              <label>
                Payment date
                <input
                  type="date"
                  max={today}
                  required
                  value={paymentDate}
                  onChange={(event) => setPaymentDate(event.target.value)}
                />
              </label>
              <label>
                Method
                <select
                  required
                  value={paymentMethod}
                  onChange={(event) => setPaymentMethod(event.target.value)}
                >
                  <option value="BANK_TRANSFER">Bank transfer</option>
                  <option value="CASH">Cash</option>
                  <option value="CHEQUE">Cheque</option>
                  <option value="MOBILE_MONEY">Mobile money</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
              <label>
                Amount (ETB)
                <input
                  type="number"
                  min="0.01"
                  max={selectedInvoiceRow?.outstanding ?? 0}
                  step="0.01"
                  required
                  value={paymentAmount || ""}
                  onChange={(event) =>
                    setPaymentAmount(Number(event.target.value))
                  }
                />
              </label>
              <label>
                Transaction / receipt reference
                <input
                  required
                  value={paymentReference}
                  onChange={(event) => setPaymentReference(event.target.value)}
                  placeholder="Bank, cheque or cash receipt number"
                />
              </label>
              <label>
                Payer name
                <input
                  value={payerName}
                  onChange={(event) => setPayerName(event.target.value)}
                />
              </label>
              <label>
                Bank / institution
                <input
                  value={financialInstitution}
                  onChange={(event) =>
                    setFinancialInstitution(event.target.value)
                  }
                />
              </label>
              <label className="wide">
                Note
                <textarea
                  rows={2}
                  value={paymentNote}
                  onChange={(event) => setPaymentNote(event.target.value)}
                />
              </label>
            </div>
            <button
              className="primary-button"
              type="submit"
              disabled={
                !selectedInvoiceRow ||
                selectedInvoiceRow.outstanding === 0 ||
                !paymentReference.trim()
              }
            >
              <Banknote size={16} />
              Post and allocate payment
            </button>
            {lastPayment && (
              <EvidenceUploader
                reference={{
                  type: "PAYMENT",
                  id: lastPayment.id,
                  label: lastPayment.paymentNumber,
                }}
                documentType="PAYMENT_SLIP"
                label="Payment slip"
                help="Attach the bank slip, cash receipt, cheque, PDF, JPG or PNG."
              />
            )}
          </form>
          <section className="payment-summary">
            <h2>Invoice allocation</h2>
            <div>
              <span>Client</span>
              <strong>
                {selectedInvoiceRow
                  ? clientById.get(selectedInvoiceRow.invoice.client_id)
                  : "-"}
              </strong>
            </div>
            <div>
              <span>Invoice</span>
              <strong>
                {selectedInvoiceRow?.invoice.invoice_number ?? "-"}
              </strong>
            </div>
            <div>
              <span>Invoice total</span>
              <strong>
                ETB{" "}
                {Number(
                  selectedInvoiceRow?.invoice.total_etb ?? 0,
                ).toLocaleString()}
              </strong>
            </div>
            <div>
              <span>Already paid</span>
              <strong>
                ETB {Number(selectedInvoiceRow?.paid ?? 0).toLocaleString()}
              </strong>
            </div>
            <div className="outstanding">
              <span>Outstanding before this payment</span>
              <strong>
                ETB{" "}
                {Number(selectedInvoiceRow?.outstanding ?? 0).toLocaleString()}
              </strong>
            </div>
            <div>
              <span>Balance after this payment</span>
              <strong>
                ETB{" "}
                {Math.max(
                  0,
                  Number(selectedInvoiceRow?.outstanding ?? 0) - paymentAmount,
                ).toLocaleString()}
              </strong>
            </div>
          </section>
        </div>
      )}

      {tab === "Storage Review" && (
        <div className="storage-layout">
          <section className="storage-controls">
            <header>
              <CalendarDays size={19} />
              <div>
                <h2>Storage charge review</h2>
                <p>
                  {selectedLot
                    ? `${selectedLot.lot_number} - ${selectedLot.bag_count} current bags`
                    : "Select a client and lot"}
                </p>
              </div>
            </header>
            <div className="control-fields">
              <label>
                Client
                <select
                  value={selectedClientId}
                  onChange={(event) => selectClient(event.target.value)}
                >
                  <option value="" disabled>
                    Select client
                  </option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.legal_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Lot
                <select
                  value={selectedLotId}
                  onChange={(event) => {
                    setSelectedLotId(event.target.value);
                    clearStorageQuote();
                  }}
                >
                  <option value="" disabled>
                    Select lot
                  </option>
                  {clientLots.map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.lot_number}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Period start
                <input
                  type="date"
                  value={periodStart}
                  onChange={(event) => {
                    setPeriodStart(event.target.value);
                    clearStorageQuote();
                  }}
                />
              </label>
              <label>
                Period end
                <input
                  type="date"
                  min={periodStart}
                  value={periodEnd}
                  onChange={(event) => {
                    setPeriodEnd(event.target.value);
                    clearStorageQuote();
                  }}
                />
              </label>
              <label>
                Storage category
                <select
                  value={category}
                  onChange={(event) => {
                    setCategory(event.target.value as StorageCategory);
                    clearStorageQuote();
                  }}
                >
                  <option value="NO_PROCESSING">
                    Stored without processing
                  </option>
                  <option value="WAITING_PROCESSING">
                    Waiting for processing
                  </option>
                  <option value="PROCESSED_EXPORT">
                    Processed export coffee
                  </option>
                  <option value="GRADE_IMPROVEMENT">
                    Grade-improvement coffee
                  </option>
                  <option value="REJECT">Reject coffee</option>
                  <option value="EMPTY_BAGS">Empty bags</option>
                </select>
              </label>
              <div className={`certification-billing-control ${selectedLotCertified ? "verified" : "standard"}`}>
                <ShieldCheck size={17} />
                <span><strong>{selectedLotCertified ? "Verified certified rate applies" : "Standard rate applies"}</strong><small>{!selectedLot ? "Choose a lot to check certification" : selectedLotCertified ? `${selectedLot.certification_schemes?.join(", ")} · valid for the full billing period` : "Certification is not verified for the full selected period"}</small></span>
              </div>
            </div>
            <div className="tariff-source">
              <ShieldCheck size={16} />
              <span>
                <strong>
                  {tariff
                    ? `${tariff.version_code} verified rate source`
                    : "No verified tariff"}
                </strong>
                <small>
                  The database—not the browser—selects the rate for every day.
                </small>
              </span>
            </div>
            <button
              className="secondary-button calculate-storage-button"
              type="button"
              onClick={calculateStorageQuote}
              disabled={
                !selectedLot ||
                !tariff ||
                storageBusy ||
                periodStart > periodEnd
              }
            >
              <CalendarDays size={16} />
              {storageBusy ? "Calculating..." : "Calculate daily charges"}
            </button>
            {storageError && (
              <div className="request-form-error" role="alert">
                {storageError}
              </div>
            )}
            <div className="storage-summary">
              <div>
                <span>Billable days</span>
                <strong>
                  {storage
                    ? storage.rows
                        .filter((row) => row.rate > 0)
                        .length.toLocaleString()
                    : "-"}
                </strong>
              </div>
              <div>
                <span>Billable bag-days</span>
                <strong>
                  {storage?.billableBagDays.toLocaleString() ?? "-"}
                </strong>
              </div>
              <div>
                <span>Calculated amount</span>
                <strong>ETB {storage?.amount.toLocaleString() ?? "-"}</strong>
              </div>
            </div>
            <button
              className="primary-button"
              type="button"
              onClick={postStorage}
              disabled={!storage || !tariff || storagePosted}
            >
              <FileCheck2 size={16} />
              {storagePosted
                ? "Billing run already posted"
                : storage
                  ? "Post verified storage run"
                  : "Calculate before posting"}
            </button>
          </section>
          <section className="storage-explanation">
            <header>
              <div>
                <h2>Daily calculation</h2>
                <p>
                  {showAllStorageDays
                    ? "Every day in the selected period"
                    : "Only the first, last, movement and rate-change days"}
                </p>
              </div>
              {storageRows.length > 0 && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setShowAllStorageDays((value) => !value)}
                >
                  {showAllStorageDays
                    ? "Show changes only"
                    : `Show every day (${storageRows.length})`}
                </button>
              )}
            </header>
            <div className="storage-table daily-storage-table">
              <div>
                <span>Date</span>
                <span>Opening</span>
                <span>Change</span>
                <span>Closing</span>
                <span>Age</span>
                <span>Rate</span>
                <span>Daily amount</span>
                <span>Why shown</span>
              </div>
              {displayedStorageRows.map((row) => {
                const sourceIndex = storageRows.findIndex(
                  (item) => item.date === row.date,
                );
                const previous = storageRows[sourceIndex - 1];
                const reason =
                  row.movementBags !== 0
                    ? `Stock movement${row.references.length ? ` · ${row.references.join(", ")}` : ""}`
                    : previous && row.rate !== previous.rate
                      ? `Rate changed from ETB ${previous.rate}`
                      : sourceIndex === 0
                        ? "First selected day"
                        : sourceIndex === storageRows.length - 1
                          ? "Last selected day"
                          : "Daily detail";
                return (
                  <div
                    className={
                      row.movementBags !== 0 ||
                      (previous && row.rate !== previous.rate)
                        ? "changed-day"
                        : ""
                    }
                    key={row.date}
                  >
                    <span>{row.date}</span>
                    <span>{Number(row.openingBags).toLocaleString()}</span>
                    <span
                      className={
                        row.movementBags < 0
                          ? "negative"
                          : row.movementBags > 0
                            ? "positive"
                            : ""
                      }
                    >
                      {row.movementBags > 0 ? "+" : ""}
                      {Number(row.movementBags).toLocaleString()}
                    </span>
                    <span>{Number(row.closingBags).toLocaleString()}</span>
                    <span>Day {row.ageDay}</span>
                    <span>
                      <strong>ETB {Number(row.rate).toLocaleString()}</strong>
                    </span>
                    <span>ETB {Number(row.amount).toLocaleString()}</span>
                    <span>
                      <small>{reason}</small>
                    </span>
                  </div>
                );
              })}
            </div>
            {storage && displayedStorageRows.length === 0 && (
              <p className="empty-result">
                No storage days are available for this period.
              </p>
            )}
            {!storage && !storageBusy && (
              <p className="empty-result">
                Choose the client, lot and dates, then calculate the daily
                charges.
              </p>
            )}
          </section>
        </div>
      )}

      {tab === "Client Statement" && (
        <>
          <section className="filter-toolbar statement-filter-toolbar no-print">
            <label>
              Client
              <select
                value={statementClient?.id ?? ""}
                onChange={(event) => setStatementClientId(event.target.value)}
              >
                <option value="" disabled>
                  Select client
                </option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.legal_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              From date
              <input
                type="date"
                value={billingFrom}
                onChange={(event) => setBillingFrom(event.target.value)}
              />
            </label>
            <label>
              To date
              <input
                type="date"
                min={billingFrom}
                value={billingTo}
                onChange={(event) => setBillingTo(event.target.value)}
              />
            </label>
          </section>
          <section className="statement print-surface">
            <header>
              <div>
                <h2>{statementClient?.legal_name ?? "Select client"}</h2>
                <p>
                  Full client account · {billingFrom || "Beginning"} to{" "}
                  {billingTo || "Today"}
                </p>
              </div>
              <strong>
                Current balance ETB{" "}
                {Number(statementAccount?.outstanding ?? 0).toLocaleString()}
              </strong>
              <button
                className="secondary-button no-print"
                type="button"
                onClick={() => window.print()}
              >
                <Printer size={16} />
                Print / Save PDF
              </button>
            </header>
            <div className="statement-table">
              <div>
                <span>Date</span>
                <span>Reference</span>
                <span>Description</span>
                <span>Debit</span>
                <span>Credit</span>
                <span>Balance</span>
              </div>
              {statementOpeningBalance !== 0 && (
                <div>
                  <span>{billingFrom || "-"}</span>
                  <span>OPENING</span>
                  <span>Balance before selected period</span>
                  <span>
                    {statementOpeningBalance > 0
                      ? statementOpeningBalance.toLocaleString()
                      : "-"}
                  </span>
                  <span>
                    {statementOpeningBalance < 0
                      ? Math.abs(statementOpeningBalance).toLocaleString()
                      : "-"}
                  </span>
                  <span>{statementOpeningBalance.toLocaleString()}</span>
                </div>
              )}
              {statementEvents.map((item) => (
                <div key={`${item.date}-${item.id}`}>
                  <span>{item.date}</span>
                  <span>{item.reference}</span>
                  <span>{item.description}</span>
                  <span>{item.debit ? item.debit.toLocaleString() : "-"}</span>
                  <span>
                    {item.credit ? item.credit.toLocaleString() : "-"}
                  </span>
                  <span>{item.balance.toLocaleString()}</span>
                </div>
              ))}
            </div>
            {statementClient &&
              statementEvents.length === 0 &&
              statementOpeningBalance === 0 && (
                <p className="empty-result">
                  No invoices or payments in this period.
                </p>
              )}
            <footer className="statement-summary">
              <span>
                Unbilled services are shown in Client Accounts and are not
                included in the accounting balance until invoiced.
              </span>
            </footer>
          </section>
        </>
      )}

      {tab === "Rate Reference" && (
        <>
          <div className="tariff-warning">
            <AlertTriangle size={18} />
            <div>
              <strong>
                {visibleTariff
                  ? `${visibleTariff.version_code} database rate record`
                  : "Rate posting is locked"}
              </strong>
              <p>
                {tariff
                  ? "Two database reviewers are recorded. Confirm every transcribed figure against Agreement 001/2018 before production billing."
                  : "Scanned tariff figures require two independent verifications before billing can post."}
              </p>
            </div>
            <ShieldCheck size={18} />
          </div>
          <section className="tariff-grid">
            {visibleTariffLines.map((line) => (
              <article key={line.id}>
                <ReceiptText size={18} />
                <span>
                  <strong>{line.category.replaceAll("_", " ")}</strong>
                  <small>
                    Day {line.age_start_days} to {line.age_end_days ?? "onward"}{" "}
                    · ETB {Number(line.daily_rate_per_unit).toLocaleString()} /{" "}
                    {line.category === "EMPTY_BAGS" ? "50 bags/day" : "bag/day"}
                    {line.certified ? " · Certified" : ""}
                  </small>
                </span>
              </article>
            ))}
          </section>
          {visibleTariff && visibleTariffLines.length === 0 && (
            <p className="empty-result">
              This tariff has no configured storage rates.
            </p>
          )}
          <div className="locked-action">
            <LockKeyhole size={16} />
            <span>
              <strong>
                Tax and automatic invoice issuance remain disabled
              </strong>
              <small>
                Activate only after finance approves the agreement transcription
                and tax mapping.
              </small>
            </span>
          </div>
        </>
      )}
      {selectedService && (
        <RecordDetailDrawer
          open
          eyebrow="UNBILLED SERVICE"
          title={selectedService.service_type.replaceAll("_", " ")}
          subtitle={clientById.get(selectedService.client_id) ?? "Unknown client"}
          status={<Status value={selectedService.status} />}
          onClose={() => setSelectedService(null)}
          actions={<button className="primary-button" type="button" onClick={() => toggleInvoicePreparation(selectedService)}>{invoicePreparationIds.includes(selectedService.id) ? "Remove from preparation" : "Add to invoice preparation"}</button>}
        >
          <DetailGrid items={[
            { label: "Service date", value: selectedService.service_date ?? selectedService.created_at.slice(0, 10) },
            { label: "Description", value: selectedService.description },
            { label: "Quantity", value: `${Number(selectedService.quantity).toLocaleString()} ${selectedService.unit_label}` },
            { label: "Approved rate", value: `ETB ${Number(selectedService.unit_price).toLocaleString()} per ${selectedService.unit_label}` },
            { label: "Unbilled amount", value: `ETB ${Number(selectedService.total_amount).toLocaleString()}` },
            { label: "Source type", value: (selectedService.reference_type ?? "Service record").replaceAll("_", " ") },
            { label: "Source record", value: selectedService.reference_id?.slice(0, 8).toUpperCase() ?? "Manual service" },
          ]} />
          <p className="drawer-explainer">This is work awaiting invoice preparation, not a payment. Payment is recorded only after finance issues an invoice.</p>
          <EvidenceUploader reference={{ type: selectedService.reference_type ?? "SERVICE_EVENT", id: selectedService.reference_id ?? selectedService.id, label: selectedService.description }} documentType="SERVICE_EVIDENCE" label="Service evidence" help="Attach the job card, voucher, receipt, or approved worksheet." />
        </RecordDetailDrawer>
      )}
      {openAccount && (
        <RecordDetailDrawer
          open
          eyebrow="CLIENT BILLING ACCOUNT"
          title={openAccount.client.legal_name}
          subtitle={`${openAccount.client.code} · period ${billingFrom || "Beginning"} to ${billingTo || "Today"}`}
          status={
            <Status
              value={openAccount.outstanding > 0 ? "OUTSTANDING" : "CLEAR"}
            />
          }
          onClose={() => setAccountClientId("")}
          actions={
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                setStatementClientId(openAccount.client.id);
                setTab("Client Statement");
                setAccountClientId("");
              }}
            >
              <Printer size={16} />
              Open full statement
            </button>
          }
        >
          <DetailGrid
            items={[
              {
                label: "Period unbilled",
                value: `ETB ${openAccount.unbilled.toLocaleString()}`,
              },
              {
                label: "Period invoiced",
                value: `ETB ${openAccount.billed.toLocaleString()}`,
              },
              {
                label: "Period payments",
                value: `ETB ${openAccount.paid.toLocaleString()}`,
              },
              {
                label: "Current balance (all time)",
                value: `ETB ${openAccount.outstanding.toLocaleString()}`,
              },
            ]}
          />
          <DetailSection
            title="Why this client owes money"
            help="Review the invoice or record its remaining payment directly."
          >
            {openAccount.invoices.length ? (
              openAccount.invoices.map((row) => (
                <div className="detail-list-row account-invoice-row" key={row.invoice.id}>
                  <span>
                    <strong>{row.invoice.invoice_number}</strong>
                    <small>Due {row.invoice.due_on ?? "not set"}</small>
                  </span>
                  <span>ETB {row.outstanding.toLocaleString()}</span>
                  <Status
                    value={
                      row.outstanding === 0
                        ? "PAID"
                        : row.overdue > 0
                          ? "OVERDUE"
                          : row.invoice.status
                    }
                  />
                  <span className="row-actions"><button type="button" onClick={() => { setSelectedInvoiceId(row.invoice.id); setBillingClientId(openAccount.client.id); setBillingFrom(""); setBillingTo(""); setTab("Invoices"); setAccountClientId(""); }}>Review invoice</button>{row.outstanding > 0 && <button className="primary-button" type="button" onClick={() => openPaymentFor(row)}>Record payment</button>}</span>
                </div>
              ))
            ) : (
              <p className="empty-result">No invoices for this client.</p>
            )}
          </DetailSection>
          <DetailSection
            title="Unbilled work"
            help="Services recorded but not yet put on an invoice."
          >
            {openAccount.services.length ? (
              openAccount.services.map((service) => (
                <button className="detail-list-row" type="button" key={service.id} onClick={() => { setSelectedService(service); setAccountClientId(""); }}>
                  <span>
                    <strong>{service.service_type.replaceAll("_", " ")}</strong>
                    <small>{service.description}</small>
                  </span>
                  <span>
                    ETB {Number(service.total_amount).toLocaleString()}
                  </span>
                  <Status value={service.status} />
                </button>
              ))
            ) : (
              <p className="empty-result">No unbilled services.</p>
            )}
          </DetailSection>
        </RecordDetailDrawer>
      )}
    </div>
  );
}
