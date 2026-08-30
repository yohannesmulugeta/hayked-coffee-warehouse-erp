# Phase 1 production gate

Status: **NO-GO for production** until every item in the release gate is signed off.

This checklist covers operational correctness, data integrity, deployment readiness, and recovery. Login security is outside this audit by request. Phase 1 changes must first be tested against a preview environment and a copied/test database; they must not be applied directly to live data.

## Completed locally

- The configured-database UI stops showing sample stock, finance, and activity values when the database is unavailable.
- Application views and master-data actions are filtered by an explicit role matrix; unknown roles fail closed to viewer access.
- Dispatch posting checks line totals, reservations, ownership, primary lot, stock quantity, and duplicate lines inside one database transaction.
- Processing cannot enter `IN_PROCESS` without an approved request and an ECX result of `PASSED` or `NOT_REQUIRED`.
- Storage billing cannot enter `INVOICED` without daily evidence that exactly reconciles its bag-days and amount.
- Manual service posting uses a database-approved, independently reviewed rate. The browser cannot choose or override the price.
- Unapproved labour, bag-printing, generator, and other service rates cannot be prepared for invoicing.
- A server-side database health endpoint is available at `/api/health`.
- CI definitions run lint, type checking, production builds, application tests, database tests, database lint, and a production-dependency audit.

## Business decisions required

| Item | Required owner | Evidence or decision | Status |
| --- | --- | --- | --- |
| Service rates | Finance + second independent reviewer | Approved rate, unit, effective dates, governing tariff, and two different reviewer identities | BLOCKED |
| Tax mapping | Finance/management | Written mapping for every billable service and effective date | BLOCKED |
| Labour, bag printing, generator, and other charges | Management + finance | Written approval of whether each charge is billable and its calculation basis | BLOCKED |
| Dispatch `DSP-2026-0018` | Warehouse manager | Cancel it or rebuild its lines/reservations so header, lines, ownership, and stock agree | BLOCKED |
| Storage run `SBR-2026-0008` | Finance + warehouse manager | Supply reconciled daily storage evidence or reverse/correct the legacy invoiced state through an approved migration | BLOCKED |

Do not bypass these blocks with hard-coded prices, sample evidence, direct table edits, or relaxed database checks.

## Preview release gate

- [ ] Create a clean release commit containing only approved Phase 1 files.
- [ ] Confirm the official production branch and its protected-branch rules.
- [ ] Create an isolated preview deployment from that commit.
- [ ] Configure preview `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY` using platform secrets.
- [ ] Apply migrations to a copied/test database using the normal migration command.
- [ ] Load management-approved rate and tax records; retain source documents and reviewer evidence.
- [ ] Run CI and retain the successful run link.
- [ ] Test the complete receive, process, dispatch, storage-billing, manual-service, invoice, payment, reporting, and audit-history flows in the preview browser.
- [ ] Test database-unavailable behavior and `/api/health` failure behavior.
- [ ] Obtain warehouse, finance, and management acceptance sign-off.

## Production release and recovery gate

- [ ] Confirm a recent production backup and record its timestamp and retention policy.
- [ ] Restore that backup into an isolated environment and complete a documented smoke test. A backup is not considered verified until a restore succeeds.
- [ ] Choose an error-monitoring/log destination and confirm alert ownership and escalation contacts.
- [ ] Verify production environment variables without displaying or copying secret values into tickets or Git.
- [ ] Take a final pre-migration backup.
- [ ] Apply migrations through the controlled release pipeline.
- [ ] Run read-only reconciliation checks for stock, dispatch reservations, storage billing, services, invoices, and payments.
- [ ] Complete a production smoke test and verify `/api/health` returns healthy.
- [ ] Record the deployed commit, migration list, approvers, release time, and rollback owner.

## Stop and rollback conditions

Stop the release if a migration fails, the health endpoint is unhealthy, stock or money totals do not reconcile, an expected role can see an unauthorized module, a required rate lacks two reviewers, or the preview and intended production commits differ. Rollback must use the reviewed release procedure and restored data when required; never repair accounting or stock ledgers with ad-hoc deletes.
