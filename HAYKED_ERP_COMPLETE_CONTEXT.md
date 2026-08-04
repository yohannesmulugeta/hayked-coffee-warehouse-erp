# Hayked Coffee Warehouse ERP - Complete Product and Technical Context

**Document purpose:** Give ChatGPT, a product expert, a warehouse consultant, or a software engineer enough context to understand, test, challenge, and improve the Hayked Coffee Warehouse ERP.

**Prepared from:** The current repository, the agreement-aligned master specification, the paper processing-request form, Supabase migrations, workflow rules, and automated tests.

**Current snapshot date:** 2 August 2026

> This document separates the intended product from what is actually persistent today. A screen looking complete does not mean its data is stored in the database.

## 1. What Hayked ERP Is

Hayked Coffee Warehouse ERP is an operational system for Hayked General Trading PLC. Hayked receives, stores, processes, controls, and dispatches coffee that is usually owned by external clients.

The system is not an export-sales CRM. Its primary job is warehouse custody and service control:

1. Register a client, agreement, and authorized representative.
2. Receive client-owned coffee and issue a GRN.
3. Create a traceable coffee lot and immutable stock movement.
4. Accept and approve a coffee processing request.
5. Queue, process, reconcile, and post processing outputs.
6. Control storage loss, bags, labour, and generator costs.
7. Block unsafe or unpaid dispatches.
8. Support ECS warehouse transfers and client-to-client ownership transfers.
9. Bill warehouse services and record payments.
10. Preserve approvals, documents, and audit history.

The central product promise is: **every quantity of coffee must be traceable from arrival to final dispatch without silently editing posted history.**

## 2. Business Problem

The current operation relies partly on paper forms, manual calculations, separate approvals, and human knowledge. That creates several risks:

- Duplicate or incomplete warehouse receipts.
- Coffee stock that cannot be reconciled to a client and source document.
- Processing orders beginning without an approved request.
- Incorrect use of processing-loss allowances.
- Confusion between client rejects, Hayked-owned byproducts, and genuine process loss.
- Dispatch of coffee while invoices, documents, or approvals are incomplete.
- Tariffs changing after a service was already performed.
- Corrections overwriting history instead of creating reversals.
- Weak evidence for who prepared, approved, posted, or changed a transaction.

Hayked ERP is intended to put these controls into the workflow and database instead of relying only on staff memory.

## 3. Source-of-Truth Hierarchy

When requirements disagree, use this order:

1. Signed agreements and approved amendments.
2. Independently verified tariff and tax source documents.
3. Approved Hayked operational policy and warehouse procedures.
4. This product specification and its approved changes.
5. Prototype behavior and demo data.

No OCR-derived tariff, tax, labour rate, or ambiguous paper value should be activated in production until two people verify it against the original source.

## 4. Product Scope

### In scope

- Users, roles, access, and maker-checker approval.
- Clients, agreements, and authorized representatives.
- Arrival coffee, GRN, lots, lot tags, and stock movements.
- Processing requests, queue, orders, completion, rejects, byproducts, and loss.
- Storage loss, bags, bag printing, labour, and generator cost recovery.
- Dispatch readiness, dispatch posting, ECS, and ownership transfer.
- Tariffs, storage billing, invoices, payments, and client statements.
- Arrears cases, reports, documents, approvals, and audit events.

### Out of scope unless separately approved

- Coffee export sales, contract negotiation, shipment booking, and buyer CRM.
- Automated sale or seizure of client coffee for unpaid invoices.
- General accounting replacement for a complete accounting package.
- Production billing from unverified tariff or tax data.
- Silent editing or deletion of posted operational and financial records.

## 5. Users and Roles

The database currently recognizes these roles:

| Role | Intended responsibility |
|---|---|
| `system_admin` | Full application administration, user roles, and operational oversight |
| `warehouse_manager` | Warehouse approvals, posting, reversals, dispatch control, and oversight |
| `warehouse_officer` | Client/GRN operational work and permitted warehouse transactions |
| `processing_supervisor` | Processing requests, queue, processing orders, and completion |
| `finance_officer` | Invoices, payments, credit-related approvals, and finance review |
| `auditor` | Read access to records, documents, approvals, and audit history |
| `viewer` | Read-only operational visibility |

### Maker-checker principle

A person who prepares or requests a controlled transaction must not approve the same transaction. This is enforced in several database functions and constraints, not only in the UI.

Current important examples:

- GRN preparer cannot approve the same GRN.
- Processing-request creator cannot approve or reject the same request.
- Processing-order preparer cannot approve its completion.
- Dispatch preparer cannot approve the same dispatch.
- Approval requester cannot decide the same approval.

## 6. Core Operational Story

Use this example when testing the full product.

**Client:** Alem Export PLC  
**Client code:** CL-0021  
**Agreement:** AGR-2026-021  
**Representative:** Sara Alemu  
**Coffee:** Washed Guji Grade 1  
**Arrival:** 320 bags, 60 kg per bag, 19,200 kg net  
**Vehicle:** ET-3-48216  
**Warehouse:** Main Warehouse, Gelancho  
**Section:** A-01 Arrival

Expected story:

1. Admin registers Alem Export PLC.
2. Admin creates an active agreement with valid dates and a tariff version.
3. Admin registers Sara Alemu as an active authorized representative.
4. Warehouse officer creates `GRN-2026-0051` for 320 bags and 19,200 kg.
5. The officer submits it. A different authorized user approves it.
6. Posting the GRN creates one lot, for example `HYK/GEL/2026/0051`, and one positive receipt movement.
7. Sara submits processing request note `00251` for 160 bags and 9,600 kg.
8. A different person approves the processing request.
9. Only then can it enter the processing queue.
10. The processing order starts only if the lot has enough stock.
11. Example washed completion for 9,600 kg:
    - Accepted client coffee: 7,440 kg
    - Client rejects: 0 kg
    - Hayked byproduct: 1,920 kg
    - Process loss: 240 kg
    - Total: 9,600 kg
12. Accepted coffee and client rejects remain client-owned. Hayked byproduct becomes a separate Hayked-owned child lot. Process loss creates no physical output stock.
13. A dispatch is prepared for the client-owned output.
14. Dispatch remains blocked until stock, agreement, representative, documents, invoice/credit, legal/quality hold, independent approval, and weighbridge checks pass.
15. Posting dispatch creates a negative stock movement and reduces lot quantity.
16. Finance charges are based on protected service/rate snapshots, not whatever tariff happens to be current later.

## 7. End-to-End Workflow

```text
Client
  -> Active agreement
  -> Authorized representative
  -> GRN draft
  -> GRN submitted
  -> GRN independently approved
  -> GRN posted
  -> Coffee lot + receipt stock movement
  -> Processing request draft
  -> Request submitted
  -> Request independently approved
  -> Queue entry / processing order
  -> Processing started + input stock movement
  -> Four-part completion reconciliation
  -> Client output + Hayked byproduct + loss posting
  -> Storage and service events
  -> Dispatch preparation
  -> Release readiness gates
  -> Dispatch approved and posted
  -> Invoice / payment / client statement
  -> Documents, approvals, and audit history remain linked
```

## 8. Module-by-Module Status

Status meanings:

- **Persistent:** Reads/writes Supabase records through implemented data functions.
- **Partial:** Some records are persistent, but important creation or transition steps remain local/demo.
- **Prototype:** Interactive rule demonstration using React state; refresh loses changes.
- **Static/demo:** Display-only sample values.

| Module | Purpose | Current state | Main work remaining |
|---|---|---|---|
| Login | Authenticate staff | Persistent Supabase email/password authentication | Password reset, invitation flow, session/user UX, production credential policy |
| Dashboard | Daily warehouse overview | Static/demo totals, chart, alerts, and activity | Calculate all cards and alerts from live records; link cards to filtered lists |
| Clients | Client master record | Persistent create/read | Edit/suspend workflow, duplicate checks, richer legal/contact fields, history |
| Agreements | Effective client service agreement | Persistent create/read | Versioning, amendments, scoped services, verification, expiry controls |
| Representatives | Authorized client actors | Persistent create/read | Action scopes, attachment/ID evidence, edit/revoke history |
| Warehouse Receipts / GRN | Record coffee arrival | Persistent create, submit, approve, post, reverse | Better numbering, attachments, weighing evidence, approval assignment, concurrent-use tests |
| Coffee Lots | Track physical and legal coffee stock | Persistent read and GRN-created lots | Reservations, split/merge, richer grades/screens/certificates, complete lineage UI |
| Stock Movements | Immutable quantity ledger | Persistent for GRN and core RPC operations | Full ledger UI, reconciliation reports, all operational modules posting through it |
| Processing Requests | Digitize paper request note | Persistent create/read/status/queue | Real file upload instead of attached flag; better client/lot selection and requester identity mapping |
| Processing Queue | First-come-first-served work sequence | Persistent through processing order records | Priority-change approval, blocking reasons, scheduling and machine capacity |
| Processing Orders | Start controlled processing | Persistent start and read | Multi-shift/multi-day model, machine/shift records, monitoring instructions |
| Processing Completion | Four-part mass balance | Persistent completion RPC and locked final records | Stronger allowance versioning, categorized reject lots, evidence upload and exception workflow |
| Storage Loss | Separate warehouse loss control | Prototype only | Tables, approval workflow, evidence, stock movement, reversal, reporting |
| Bag Control | Client-owned bag inventory and printing | Prototype only | Separate bag ledger, receipts/issues/returns/damage, persistent printing orders and billing events |
| Labour | Record chargeable work | Prototype only; billing intentionally disabled | Verified activity/rate master, approvals, service events, persistence |
| Generator Requests | Recover supported actual diesel cost | Prototype only | Persistent request, receipts, supervisor/finance approvals, service event |
| Dispatch | Block/release and issue coffee | Partial: loads existing dispatch and can post approved dispatch | Persistent creation, submission, approval, reservations, real readiness inputs and documents |
| ECS Transfer | Physical warehouse-to-warehouse move without ownership change | Prototype only | Atomic send/receive RPCs, destination receipt, variance approval, duplicate protection in active workflow |
| Ownership Transfer | Change client owner without changing physical total | Prototype only; schema exists | Atomic posting/reversal RPC, child lot, signed document upload, complete approvals |
| Tariffs | Effective-dated service prices | Static/demo, activation locked | Verified tariff-version and line tables, two-person verification, tax mapping, activation workflow |
| Storage Billing | Movement-based bag-day billing | Prototype calculation only | Persistent calculation runs/lines, source movement replay, duplicate-run DB constraint, service events |
| Invoices | Freeze billed services and rates | Partial: reads existing invoices; demo issue button | Persistent creation/issue/void/reversal, allocations, client selection, PDF |
| Payments | Allocate client payments | Persistent record-payment RPC for existing invoice | Payment allocation table, reversal UI, bank reconciliation, receipt document |
| Client Statement | Show debits, credits, balance | Partial from loaded invoice/payment data | Multi-invoice ledger, date filters, opening balance, export/PDF |
| Arrears Cases | Controlled debt recovery | Prototype only | Persistent cases, notices, attachments, approvals, settlement and closure |
| Reports | Operational reporting | Static report catalog; generic demo CSV and browser print | Real queries, filters, accurate exports, scheduled snapshots |
| Documents | Controlled document register | Partial read; schema and private bucket exist | Upload/version/post/supersede workflow, checksum generation, preview/download |
| Approvals | Independent decision queue | Persistent read/approve for existing records | Reject action, decision notes, role limits, source-record synchronization for every request type |
| Audit History | Append-only event history | Persistent read; core RPCs append events | Coverage for all modules, filters/export, actor/context detail |
| Administration | Assign roles and activate users | Persistent profile read/update for admin | Invite/create users, organization/warehouse settings, permission-aware UI |

## 9. GRN Logic

### Status lifecycle

```text
DRAFT -> SUBMITTED -> APPROVED -> POSTED -> REVERSED
```

Rules:

- Client, active agreement, and authorized representative are required.
- Bag count and bag weight must be positive.
- Gross weight, tare, and net weight must be valid.
- `net = gross - tare` within 0.01 kg.
- Only an approved GRN can post.
- Posting creates exactly one coffee lot and one `RECEIPT` stock movement.
- A posted GRN cannot be edited directly.
- Reversal requires a reason and creates a compensating `REVERSAL` movement.
- Direct GRN reversal is blocked when downstream stock activity exists.
- The preparer cannot approve the same GRN.

Current database transaction: `transition_grn`.

## 10. Processing Request Logic

This workflow digitizes the paper form titled **Export Coffee Processing Order Requesting Notes**.

Captured fields:

- Request note number and date.
- Client/customer.
- Warehouse receipt or lot number.
- Coffee type: Washed or Unwashed / UG.
- Requested preparation/processing type.
- Grade.
- Requested bags and kg.
- Certifications: Organic, RFA, C.A.F.E, Non-certified, Fairtrade, Other.
- Other certification text when Other is selected.
- Requester, checker, and approver names.
- Notes.
- Scanned document/photo attached flag.

### Status lifecycle

```text
DRAFT -> SUBMITTED -> APPROVED
                   -> REJECTED
APPROVED -> processing queue exactly once
```

Validation:

- Request note number required and unique.
- Client required.
- Lot/GRN reference required.
- Requested bags and kg must be positive.
- Approver name cannot equal requester name.
- Other certification requires descriptive text.
- Queueing requires links to a real client and real lot.
- A request can be queued only once.

Current database transactions: `transition_processing_request` and `queue_processing_request`.

## 11. Processing Order and Completion Logic

Starting an order:

- Only a queued order can start.
- Lot stock must cover the requested input kg.
- Start posts a negative `PROCESS_INPUT` movement.
- Lot quantity decreases by input kg and status becomes `IN_PROCESS`.

Completion must reconcile four groups:

1. Accepted client coffee.
2. Client rejects, ideally by reject category.
3. Hayked-owned byproduct.
4. Genuine process loss.

Formula:

```text
input kg = accepted client kg + client reject kg + Hayked byproduct kg + process loss kg
```

Tolerance is 0.01 kg. Negative outputs are prohibited. Weighing evidence is required by the TypeScript rule layer.

Agreement-aligned allowance rules:

- **Washed coffee:** 22.5% total, intended as 20% Hayked-owned byproduct plus up to 2.5% genuine process loss.
- **Unwashed / UG:** 2.5% process allowance.
- Unwashed byproduct is not normally allowed and requires an effective approved rule/evidence.
- An above-allowance completion requires independent approval and evidence.
- Storage loss is separate and must never be mixed into processing allowance.

Posting completion:

- Client accepted coffee and client rejects return to client-owned lot stock.
- Hayked byproduct creates a separate Hayked-owned child lot.
- Processing values and completion status are locked after posting.
- Correction should use reversal/replacement, not editing the posted result.

Current database transactions: `start_processing_order` and `complete_processing_order`.

### Known logic gap to review

The current database enforces a maximum combined washed allowance of 22.5%, but it does not fully model an effective-dated rule requiring exactly/nominally 20% byproduct and up to 2.5% loss as separate policy components. Exception approval is represented mainly by an evidence path, not a complete linked approval record. This needs business clarification before production processing.

## 12. Storage Loss Logic

Storage loss is not processing loss.

Current prototype rules:

- Loss must be positive and cannot exceed measured lot balance.
- Measurement evidence is required.
- Warehouse manager approval is required.
- Normal maximum is 1.5%.
- Above 1.5% requires independent exception approval.
- A wet-coffee exception above the limit requires written joint approval.

The TypeScript calculations and tests exist, but posting this result to Supabase stock movements is not yet implemented.

## 13. Bag, Labour, and Generator Logic

### Bag printing

- Minimum printing order: 50 bags.
- Prototype tiers:
  - 50-99: ETB 69.57 per bag.
  - 100-159: ETB 55.65 per bag.
  - 160 or more: ETB 43.48 per bag.
- These values must be verified against signed source material before production use.

### Labour

- Operational entries can be demonstrated.
- Production billing is intentionally blocked until the full labour tariff list is independently verified.

### Generator

- Recover supported actual diesel cost: `litres x verified unit cost`.
- No automatic markup is applied by the prototype.
- Supplier receipt, supervisor approval, and finance review are expected controls.

All three areas are currently prototype-only and need persistent records and service-event integration.

## 14. Dispatch and Release Logic

A dispatch should not post until all relevant gates pass:

- Requested quantity is positive and does not exceed available unreserved stock.
- Client agreement is active.
- Representative is authorized and currently valid.
- Certificates and required documents are ready.
- Invoices are paid, or a valid approved credit override exists.
- No legal or quality hold is active.
- Dispatch is independently approved.
- Preparer and approver are different people.
- Weighbridge is ready.

Posting an approved dispatch:

- Verifies the gates again in the database.
- Checks lot quantity.
- Creates a negative `DISPATCH` stock movement.
- Reduces lot kg and bag count.
- Sets the lot to `DISPATCHED` when empty or `AWAITING_DISPATCH` when partially remaining.
- Appends an audit event.

Current database transaction: `post_dispatch`.

Important current limitation: the UI does not yet persist the full creation, readiness, credit, and approval process. It can post an already approved database dispatch.

## 15. ECS and Ownership Transfer Logic

### ECS transfer

ECS is a physical move between warehouses:

- Client ownership does not change.
- Source sends stock and marks it in transit.
- Destination receipt completes the transfer.
- Duplicate destination receipt is blocked.
- Quantity variance above 0.01 kg requires explanation and approval.

### Ownership transfer

Ownership transfer changes the legal client owner but not the physical warehouse total:

- Source client gives signed authorization.
- Destination client accepts.
- Hayked independently approves.
- Holds can block the transfer.
- A partial transfer creates a destination child lot with lineage to the source lot.
- Source quantity plus destination quantity must equal the original physical quantity.
- Posted transfer cannot be edited; correction requires reversal and a new transaction.

Both flows currently have UI rule demonstrations and database table structures, but their complete atomic database posting functions are not implemented.

## 16. Finance Logic

### Tariffs

Production tariffs must be:

- Effective-dated.
- Versioned.
- Linked to source document/page.
- Independently verified.
- Explicit about tax inclusion/exclusion.
- Protected at the time of service so later tariff changes do not rewrite old charges.

Current tariff cards are demonstration values and activation is intentionally locked.

### Storage billing

The prototype replays dated bag movements and calculates daily bag-days using category-specific free periods and tiers. It creates a duplicate key from client, lot, category, billing period, and tariff version.

This calculation is not yet a persistent billing run. Production needs calculation-run and calculation-line records, a database uniqueness constraint, approved tariff sources, and generated service events.

### Invoices

The schema stores a frozen JSON line snapshot, subtotal, tax, generated total, status, issue date, and due date. Final invoices are intended to be immutable.

The UI reads existing database invoices, but invoice creation/issue is still a demo interaction.

### Payments

The database payment RPC:

- Accepts only an open issued or partially paid invoice.
- Requires a positive amount and bank reference.
- Inserts an immutable payment record.
- Recalculates invoice status as partially paid or paid.
- Appends an audit event.

Known gap: database logic should also prevent aggregate overpayment; the TypeScript helper prevents a single UI allocation from exceeding the displayed outstanding amount, but this should be guaranteed transactionally in Postgres.

### Arrears

Intended stages:

```text
MONITORING
-> PAYMENT_REMINDER
-> FORMAL_NOTICE
-> MANAGEMENT_REVIEW
-> LEGAL_REVIEW
-> AGREED_SETTLEMENT
-> CLOSED
```

An arrears case may block release through an approved hold. It must never automatically move ownership or sell client coffee. The current arrears screen is prototype-only.

## 17. Audit, Documents, and Immutability

### Immutable records

The database uses triggers and revoked direct updates to protect important records:

- Stock movements are append-only.
- Payments are append-only.
- Audit events are append-only.
- Final invoices and final documents are protected from normal mutation.
- Posted/reversed processing orders are locked.

### Corrections

The intended correction model is:

```text
incorrect posted record -> documented reversal -> corrected replacement record
```

### Documents

The schema supports:

- Document number and type.
- Link to a business reference.
- Version and previous version.
- Private Supabase Storage object path.
- Filename, MIME type, size, and SHA-256 checksum.
- Draft, approval, posted, and superseded states.

The private `erp-documents` bucket and policies exist, but the application still needs the end-to-end upload/version/preview/download workflow.

## 18. Current Database Architecture

Backend: Supabase Postgres, Supabase Auth, Row Level Security, and Supabase Storage.

Current public tables:

1. `organizations`
2. `warehouses`
3. `profiles`
4. `clients`
5. `agreements`
6. `authorized_representatives`
7. `warehouse_receipts`
8. `coffee_lots`
9. `stock_movements`
10. `processing_requests`
11. `processing_orders`
12. `dispatch_orders`
13. `ecs_transfers`
14. `ownership_transfers`
15. `invoices`
16. `payments`
17. `approvals`
18. `documents`
19. `audit_events`

Applied migration groups:

- `hayked_warehouse_foundation`
- `processing_requests`
- `persistent_operational_core`

### Atomic RPC operations

| RPC | Responsibility |
|---|---|
| `transition_grn` | Submit, approve, post, or reverse a GRN with stock/audit effects |
| `transition_processing_request` | Submit, approve, or reject a request with approval/audit effects |
| `queue_processing_request` | Turn one approved request into one queued order |
| `start_processing_order` | Issue processing input from lot stock |
| `complete_processing_order` | Reconcile and post processing outputs atomically |
| `post_dispatch` | Recheck release gates and post dispatch stock movement |
| `record_invoice_payment` | Insert payment and update invoice status |
| `decide_approval` | Independently approve or reject an approval record |

RPCs use row locking and role checks so related stock/status/audit changes succeed or fail together.

## 19. Current Frontend Architecture

- Next.js 16 App Router style application.
- React 19 and TypeScript.
- `vinext` development/build scripts.
- Supabase browser client through `@supabase/ssr` and `@supabase/supabase-js`.
- Lucide icons.
- Plain CSS design system in `app/globals.css`.
- No added state-management or form dependency.
- Main application currently operates as a client-side dashboard with view switching rather than URL routes for each module.

Main implementation files:

| File | Responsibility |
|---|---|
| `app/page.tsx` | Login, shell, navigation, dashboard, global demo search |
| `app/core-operations.tsx` | Clients, agreements, representatives, GRN, lots, tags |
| `app/processing-operations.tsx` | Requests, queue, orders, completion |
| `app/warehouse-controls.tsx` | Storage loss, bags, labour, generator prototype screens |
| `app/dispatch-operations.tsx` | Dispatch readiness, dispatch post, ECS, ownership transfer |
| `app/finance-operations.tsx` | Tariffs, storage calculation, invoices, payments, statement |
| `app/management-operations.tsx` | Arrears, reports, documents, approvals, audit, administration |
| `lib/erp-data.ts` | Supabase reads, inserts, and RPC calls |
| `app/*-workflow.ts` and `app/*-rules.ts` | Pure business-rule functions used by UI and tests |
| `supabase/migrations/*.sql` | Database tables, policies, triggers, and transaction functions |

## 20. Authentication and Environment

- Live application: <https://hayked-coffee-warehouse-erp.vercel.app>
- Local application: `http://localhost:3001` when the development server is running.
- Supabase project reference: `jmdnaphpsxszojieogpk`.
- The browser receives only the Supabase URL and publishable key.
- A service-role or secret key must never appear in frontend variables, source files, screenshots, or this handoff.
- Test accounts exist for admin and warehouse manager use. Credentials should be shared separately and rotated before a controlled pilot.

## 21. Current Automated Verification

The repository contains Node tests for:

- Rendered authentication page.
- GRN lifecycle, lot creation, duplicate posting, reversal, and client readiness.
- Processing allowances, mass balance, request approval, and queue gate.
- Storage loss, bag printing, and generator rules.
- Release, ECS, and ownership-transfer rules.
- Storage billing, invoice snapshot, and payment allocation.
- Arrears progression, independent approval, and append-only audit helper.
- Migration protections, role controls, atomic RPCs, and completion lock.

Standard verification commands:

```powershell
npm run lint
npm run build
npm test
```

Passing unit/build checks do not prove the complete warehouse journey is production-ready. A pilot must also test real users, concurrent actions, printing, physical weighing, network failure, duplicate clicks, and recovery from incorrect entries.

## 22. Current Strengths

- Product concept matches a real coffee warehousing and processing operation.
- GRN-to-lot and processing-request-to-queue logic are understandable.
- Stock-changing core operations use atomic Postgres functions.
- Posted history is treated as immutable and corrected through reversals.
- Maker-checker rules exist in both logic and database controls.
- Washed and unwashed allowances are not treated as the same rule.
- Client rejects, Hayked byproducts, and process loss are separated conceptually.
- Release gates include finance, documents, legal/quality holds, approval, and weighbridge readiness.
- UI is consistent, responsive, and suitable for an operational dashboard prototype.
- Production tariff activation is intentionally blocked pending source verification.

## 23. Known Gaps and Risks

### P0 - Must be resolved before a warehouse pilot handles real stock

1. Finish persistent transactions for storage loss, ECS, ownership transfer, reservations, and dispatch creation/approval.
2. Replace static dashboard totals and readiness checkboxes with database-derived values.
3. Implement real document upload, evidence linking, versioning, and retrieval.
4. Model tariff versions/lines, tax mappings, service events, and rate snapshots after two-person source verification.
5. Implement persistent storage billing and invoice creation/issue.
6. Guarantee payment over-allocation prevention in the database transaction.
7. Complete approval integration so exception evidence is linked to an actual independently decided approval.
8. Verify all role boundaries and UI permissions with separate real test users.
9. Add stock reservations and concurrency protection for competing processing/dispatch requests.
10. Reconcile the complete physical stock ledger against lot balances and define opening-balance migration.

### P1 - Required before a serious controlled pilot

1. Real numbering service for GRN, lot, processing order, transfer, dispatch, invoice, and documents.
2. Agreement amendments, versions, representative scopes, and expiry alerts.
3. Multi-shift/multi-day processing and machine/line tracking.
4. Categorized client-reject output lots and richer coffee grade/screen/certification masters.
5. Payment reversals, allocations, bank reconciliation, and receipts.
6. Real report queries, filters, CSV/PDF outputs, and operational print templates.
7. Loading, empty, error, permission-denied, conflict, and retry UX for every persistent module.
8. Password reset, invitation, user onboarding, and account suspension flow.
9. Backup/restore rehearsal and deployment rollback procedure.
10. Browser-based end-to-end tests for desktop, tablet, and 390 px mobile.

### P2 - Improvements after the core is trustworthy

1. Saved filters and role-specific dashboards.
2. Barcode/QR lot scanning.
3. Notification center and approval reminders.
4. Better cross-record global search.
5. Scheduled reports and management analytics.
6. Amharic labels where operationally useful.

## 24. Documentation Mismatch to Correct

`README.md` and `IMPLEMENTATION_CHECKLIST.md` describe an earlier prototype state. They currently understate the applied Supabase work and overstate some local prototype modules as completed. Treat this document and the actual code/database as the current technical snapshot until those files are updated.

## 25. Production-Readiness Verdict

**Verdict: Not production-ready. Partially ready for supervised workflow testing.**

The persistent GRN and processing core is a useful foundation. However, several stock, billing, document, and approval paths still stop at interactive prototype behavior. The app should not be used as the sole legal or stock record until every stock-changing workflow is persistent, atomic, audited, permission-tested, and reconciled in a controlled pilot.

Recommended next development phase:

```text
Persistent stock control
-> document/evidence workflow
-> dispatch/ECS/ownership transactions
-> verified tariffs and service events
-> storage billing and invoicing
-> full approval integration
-> end-to-end warehouse pilot
```

## 26. Questions ChatGPT Should Challenge

Ask ChatGPT to answer these instead of simply agreeing with the current design:

### Warehouse operations

1. Is one lot per posted GRN always correct, or can one arrival create several lots by grade, bag type, owner, or quality result?
2. When should coffee be reserved for processing or dispatch, and how should competing reservations be resolved?
3. Should bag count and kg always move together, and how are partial bags/rebagging handled?
4. Which weighing record is authoritative: weighbridge, warehouse scale, or processing scale?
5. Which corrections may be reversed automatically, and which require a formal exception case?

### Processing

1. Is washed byproduct always exactly 20%, a maximum, a contractual transfer, or a rate that can vary by agreement/date?
2. Is the 2.5% washed process loss included inside the 22.5% total in every agreement version?
3. How should client reject categories become distinct physical lots and later be dispatched or reprocessed?
4. Can one processing order consume multiple source lots or produce multiple accepted grades?
5. How should multi-day shifts and carry-forward work-in-process be reconciled?

### Dispatch and ownership

1. Does unpaid status block all transfers, only external dispatch, or also ownership transfer?
2. What exact documents are mandatory for Export, Horizontal, Sample, and ECS dispatch reasons?
3. Does ECS require temporary stock ownership/location accounts while in transit?
4. What legally proves client-to-client transfer, and who may revoke it before posting?

### Finance

1. What event creates each charge: receipt, day-end stock, processing acceptance, completion, bag printing, labour approval, generator approval, or dispatch?
2. Are tariffs protected at request date, service start, service completion, or invoice date?
3. How are VAT, TOT, withholding, advances, credit notes, and debit notes handled?
4. How are storage free-day boundaries interpreted in Africa/Addis_Ababa time?
5. Can one payment allocate across several invoices, and can one invoice be paid by several payments?

### Governance

1. Which roles may prepare, submit, approve, post, reverse, and view each transaction type?
2. Which approval thresholds depend on quantity, ETB value, allowance variance, or age?
3. What is the legal retention period for documents and audit events?
4. Which reports must agree daily before the warehouse closes a shift?

## 27. Recommended Test Scenarios

ChatGPT should design test scripts for at least these scenarios:

| Scenario | Expected result |
|---|---|
| Valid GRN lifecycle | One posted lot and one receipt movement |
| Same user prepares and approves GRN | Blocked |
| Duplicate GRN post/double-click | No duplicate lot or movement |
| GRN reversal before downstream use | Compensating movement and closed lot |
| GRN reversal after downstream activity | Blocked; formal correction required |
| Processing request queued while draft | Blocked |
| Processing request queued twice | Blocked |
| Washed 20% byproduct + 2.5% loss | Reconciles and posts |
| Unwashed 2.5% loss | Reconciles and posts |
| Unwashed byproduct without approved rule | Blocked |
| Processing outputs differ from input by more than 0.01 kg | Blocked |
| Storage loss at or below 1.5% | Requires normal evidence and manager approval |
| Storage loss above 1.5% | Requires independent exception approval |
| Bag print quantity 49 | Blocked |
| Bag print quantities 50, 100, 160 | Correct verified tier selected |
| Dispatch with unpaid invoice and no credit | Blocked |
| Dispatch with valid credit and all gates | Posts one negative movement |
| Duplicate ECS destination receipt | Blocked |
| Partial ownership transfer | Child lot; physical total unchanged |
| Duplicate storage billing period | Blocked by database uniqueness |
| Payment above outstanding balance | Blocked transactionally |
| Posted record edit | Blocked; reversal/replacement required |
| Network failure during posting | Entire transaction succeeds once or rolls back |
| Two users reserve same stock | Only valid available quantity is committed |

## 28. Paste-Ready Prompt for ChatGPT

Paste this complete Markdown file into ChatGPT, then add the prompt below:

```text
Act as a senior ERP product architect, coffee warehouse operations consultant, database transaction designer, and practical implementation reviewer.

Read the complete Hayked Coffee Warehouse ERP context above. Do not simply praise it and do not assume that a polished screen is persistent. Separate the intended product, the currently implemented persistent core, and the prototype-only areas.

Your job is to help us find a simpler, safer, and more operationally correct way to build this ERP.

Please produce:

1. A plain-language explanation of what this software does for Hayked, warehouse staff, processing staff, finance staff, management, and clients.
2. A corrected end-to-end workflow from client registration through final dispatch and payment.
3. Any business-rule contradictions, missing decisions, or dangerous assumptions.
4. A recommended state machine for GRN, lots, reservations, processing, dispatch, ECS, ownership transfer, invoice, payment, approval, and document records.
5. A recommended data model showing which current tables can stay, which should change, and which missing tables are genuinely necessary.
6. A module-by-module verdict: keep, simplify, merge, redesign, or postpone.
7. The smallest production-safe implementation sequence, ordered by dependency and operational risk.
8. A full real-world test story using Alem Export PLC and sample values.
9. Acceptance criteria for a controlled warehouse pilot.
10. A list of questions that must be answered by Hayked management, warehouse staff, processing staff, finance, and legal advisers before production.

Important constraints:

- Client-owned coffee must remain traceable.
- Posted records cannot be silently edited or deleted.
- Stock changes must be atomic, idempotent, and audited.
- The preparer/requester cannot approve the same controlled transaction.
- Washed processing uses a 22.5% total rule currently understood as 20% Hayked byproduct plus up to 2.5% process loss.
- Unwashed/UG uses 2.5% unless an effective approved rule says otherwise.
- Storage loss is separate and normally limited to 1.5%.
- An overdue invoice never automatically transfers or sells client coffee.
- Tariffs and taxes must not be activated from unverified OCR values.
- Recommend fewer tables and steps where they remain safe and auditable.

Be direct. Mark uncertain legal or contract interpretations as decisions requiring human confirmation. Finish with a prioritized P0/P1/P2 roadmap and a short list titled "What we should build next week."
```

## 29. What to Send Back After the Discussion

After ChatGPT reviews this document, bring back:

1. Its corrected workflow.
2. Its proposed table changes.
3. Its list of business questions.
4. Its P0/P1/P2 roadmap.
5. Any recommendation that contradicts this document.

We can then compare the proposal against the signed agreement, the paper forms, and the current code before changing the application.

## 30. Final Guiding Principle

The ERP should not attempt to digitize every paper field first. It should first guarantee three truths:

1. **Whose coffee is this?**
2. **Where is it and how much is physically available?**
3. **Which approved documents and transactions explain every change?**

Everything else - scheduling, billing, reports, and management dashboards - should be built on those trustworthy records.
