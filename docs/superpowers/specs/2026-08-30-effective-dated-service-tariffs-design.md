# Effective-Dated Service Tariffs Design

## Purpose

Implement Agreement 001/2018 as a controlled service catalogue and effective-dated tariff system. A price change applies only to service work or storage days on and after its effective date. Existing service records, billing runs, invoices, payments, and audit history never change automatically.

## Current State

The ERP already has `tariff_versions`, storage-specific `tariff_line_items`, `service_events`, manual service records, labour records, warehouse-rent instructions, invoice preparation, and maker-checker tariff verification. Storage billing selects database rates per day and records the daily calculation.

The main gaps are:

- manual services currently accept a price entered by the browser;
- the PDF's complete service catalogue is not represented in the database;
- non-storage rates do not support quantity bands, coffee attributes, container size, certification, or effective-dated selection;
- the full labour tariff and tax mapping are not independently verified.

## Scope

### Included

1. A service catalogue for storage, processing, labour, bag printing, packing, vacuum packing, weighing, loading/unloading, container handling, generator use, certification handling, transport/handling, and other approved Agreement 001/2018 services.
2. English and Amharic names, service code, category, charging unit, PDF article reference, evidence requirement, approval requirement, and active status.
3. Effective-dated non-storage tariff lines with quantity bands and optional coffee type, grade, certification scheme, and container-size conditions.
4. Draft, pending-verification, active, and retired tariff-version states using the existing two-person verification model.
5. Database-authoritative rate selection using the service-performed date.
6. Immutable rate snapshots on service events and manual service records.
7. Daily storage pricing across tariff changes without duplicate billed days.
8. A simple tariff-management workspace showing current, scheduled, and historical prices.
9. Reports for current rates, scheduled changes, historical rates, missing rates, and the source PDF clause.

### Excluded

- Automatic processing charges created from processing status changes.
- Automatic labour charges without a recorded labour event.
- Automatic correction of historical invoices after a new tariff starts.
- Activating tariff figures that have not been independently checked against the signed PDF.
- A separate page or form for each individual labour activity.

## Data Model

### `service_catalog`

One row per chargeable service:

- `id uuid primary key`
- `organization_id uuid`
- `service_code text`
- `name_en text`
- `name_am text`
- `category text`
- `default_unit text`
- `pdf_article_reference text`
- `requires_lot boolean`
- `requires_processing_order boolean`
- `requires_evidence boolean`
- `requires_independent_approval boolean`
- `active boolean`
- audit timestamps and actors
- unique `(organization_id, service_code)`

The first migration seeds service definitions only. It does not activate unverified prices.

### `service_tariff_lines`

One effective rate condition within a tariff version:

- `id uuid primary key`
- `tariff_version_id uuid`
- `service_catalog_id uuid`
- `unit_label text`
- `unit_rate numeric(12,2)`
- `minimum_quantity numeric(16,3)`
- `maximum_quantity numeric(16,3) null`
- optional `coffee_type`, `grade`, `certification_scheme`, and `container_size`
- `tax_code text`
- `source_document_id uuid null`
- `source_page integer null`
- `source_clause text`
- unique condition key inside one tariff version

Effective dates remain on `tariff_versions`. Overlapping active versions for the same organization are rejected. Existing storage `tariff_line_items` remain in place and continue to drive daily rent until they are deliberately migrated and verified.

### Immutable snapshots

`service_events` and `manual_service_records` gain:

- `service_catalog_id`
- `service_tariff_line_id`
- `tariff_version_id`
- `rate_effective_on`
- `tax_code`
- `rate_source_snapshot jsonb`

The snapshot contains the code, names, unit, rate, conditions, source clause, and tariff version used. Snapshot fields cannot be edited after insertion. Invoices continue to copy service lines into their own immutable `line_snapshot`.

## Tariff Lifecycle

1. Finance creates a draft version with `effective_from` and optional `effective_to`.
2. Finance enters service rates and attaches the source agreement scan.
3. Reviewer one checks the transcription.
4. A different reviewer completes independent verification.
5. Activation closes the preceding version on the day before the new version starts.
6. A scheduled future version is visible but not used before its effective date.
7. An activated or previously used version cannot be edited or deleted.
8. Corrections use a new version. Historical charges remain unchanged unless an authorized reversal/replacement process is performed.

## Rate Selection

The database function `quote_service_tariff` receives:

- client and agreement;
- service code;
- service-performed date;
- quantity and unit;
- optional lot, processing order, coffee type, grade, certification, and container size.

It selects exactly one independently verified tariff version covering the service date and exactly one matching tariff line. Zero matches produces a clear "no verified rate" error. More than one match produces an "ambiguous tariff" error. The browser cannot supply or override the final rate.

Client-specific pricing is not introduced in this release. Agreements continue to reference the applicable standard tariff version. A future client-specific override must use the same effective-dated, independently approved mechanism.

## Service Recording and Billing

The manual flow is:

1. Select client and service.
2. Select the relevant lot or completed processing order when required.
3. Enter service date, quantity, service conditions, and evidence.
4. Preview the database-selected rate and total.
5. Select an independent approver.
6. Post one completed-service record and one unbilled service event atomically.
7. Finance selects unbilled events and prepares an invoice draft.

Processing completion never creates a charge by itself. Labour remains split between Hayked internal cost and the separately frozen client charge.

## Storage Billing

Warehouse-rent instructions remain record-only. Finance calculates rent later from daily lot balances. Every day selects the verified storage tariff valid on that date, so a period crossing a tariff change is automatically split. Existing duplicate-day protection and billed-through tracking remain mandatory.

The saved daily line retains opening bags, movement, closing bags, age, category, certification status, tariff version, tariff line, rate, amount, and source references.

## User Interface

### Labour & Services

Keep the four focused workspaces:

- Labour
- Services
- Warehouse Rent
- History

The Services form replaces manual rate entry with:

- searchable service selection;
- service date and quantity;
- only the condition fields required by that service;
- a read-only verified rate, effective date, source clause, tax code, and calculated total;
- evidence and independent approver.

### Tariff Management

Add one administration workspace with:

- Current prices
- Scheduled changes
- Drafts awaiting verification
- Historical prices
- Services missing a verified rate

Editing is allowed only in a draft. Activated history is read-only.

## Security and Audit

- Only system administrators and finance officers create tariff drafts.
- Two different authorized reviewers are required before activation.
- Warehouse and processing staff may quote active rates but cannot change them.
- Direct table writes are revoked for authenticated users; controlled RPCs perform writes.
- Every draft, verification, activation, quote, service posting, reversal, and invoice preparation records an audit event.
- RLS keeps every catalogue, tariff, service, and invoice row inside its organization.

## Migration Safety

- Additive migration only; no table, column, invoice, service event, or storage calculation is deleted.
- Existing service events retain their current price and receive a legacy snapshot label.
- Existing storage billing continues using the established storage tables and functions.
- New non-storage service posting uses the database tariff only after a verified rate exists.
- The migration does not seed or alter production prices from the scanned PDF.

## Testing and Acceptance

Automated tests must prove:

1. A service before a tariff change uses the old rate.
2. A service on or after the change date uses the new rate.
3. A storage period crossing the date contains daily rows from both versions.
4. Existing posted services and invoices remain unchanged after activation.
5. Draft and singly verified versions cannot quote or post.
6. Overlapping or ambiguous rates are rejected.
7. Quantity-band boundaries select one correct rate.
8. Certified and non-certified conditions cannot be mixed.
9. The recorder cannot approve their own service or tariff.
10. Processing completion does not create a billable event automatically.
11. The UI does not accept an editable client charge when a verified tariff is required.
12. Existing test, lint, build, database-lint, and browser-flow checks remain green.

User acceptance uses one client journey spanning a tariff-change date: agreement, receipt, stock, processing, manual service, warehouse rent, invoice, payment, dispatch, and statement.

