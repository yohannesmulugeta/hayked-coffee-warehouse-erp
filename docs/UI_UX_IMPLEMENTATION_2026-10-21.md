# Hayked ERP UI/UX implementation status

Date: 21 October 2026. This is local checkout work; no push or deployment was made.

## Implemented

- Dashboard review count now includes pending legacy approvals, physical checks, and rebag/blend jobs. Bag charges awaiting review appear as a separate Billing task. Search includes checks, jobs, lab samples, and bag charge runs, subject to role access and database RLS.
- Review cards now show client, readable source reference, recorded time, expected and measured quantities, variance, and evidence before decision actions. Source links open the corresponding operational area. Approval RPCs and independent-review rules remain authoritative.
- View, selected record, stock filter, processing state, report type, and bag-billing entry can be restored from the URL. Back, refresh, and unauthorized deep-link handling were added. The shared record drawer now manages initial focus, Tab containment, Escape, and focus return.
- Sign-in dead controls were removed and administrator reset guidance added. The profile control now opens a sign-out menu. The movement chart's inactive period selector was removed. Bag Control now links to Billing → Storage Review.
- Mobile sign-in places the form near the top. Dashboard and sidebar text scale, mini cards, focus outlines, and selected-record highlights were improved. Special jobs show per-source available and remaining balances; bag billing shows its work in numbered stages; lot trace has a scannable quantity-check timeline and readable processing references. Laboratory warns before discarding an edited evaluation.

## Files touched for this implementation

- Shared shell and navigation: `app/page.tsx`, `app/globals.css`, `app/workflow-ui.tsx`, `app/ux-rules.ts`, `lib/erp-data.ts`.
- Review and record context: `lib/quantity-checks.ts`, `app/operational-approval-queue.tsx`, `app/management-operations.tsx`, `app/core-operations.tsx`, `app/processing-operations.tsx`, `app/dispatch-operations.tsx`, `app/lot-trace.tsx`, `app/special-jobs.tsx`.
- Client services: `app/warehouse-controls.tsx`, `app/empty-bag-control.tsx`, `app/empty-bag-billing.tsx`, `app/finance-operations.tsx`, `app/laboratory-operations.tsx`.
- This status document. No schema, migration, deployment, or Git history files were changed by this implementation.

## Verification

- `npm.cmd run typecheck`: passed.
- `npm.cmd run lint`: passed with two existing warnings in `tmp/phase1-db-outage.js` and `tmp/phase1-db-restore.js`.
- `npm.cmd test`: 78/78 passed, including Vinext build and bundle budget.
- `npm.cmd run build:next`: passed.
- Local browser: mobile sign-in form top approximately 180px at 390×844 (previous audit about 605px); no horizontal overflow. Demo-mode Reports URL survived refresh/sign-in, Back returned to Dashboard, viewer Finance deep link returned to Dashboard, profile menu opened on mobile, and console had no errors.
- `npm.cmd run test:db`: failed on the existing local database. Recent empty-bag and quantity-check tables are absent there; laboratory grade and one rate-message assertion also fail against that local schema. No reset or migration was run.

## Release limits and next gate

The current checkout contains substantial pre-existing modified and untracked work, including recent migrations. The local database history differs from the checkout and remote history. Before release, reconcile migration history in an isolated database, run the SQL suite, and complete an authorized signed-in walkthrough across warehouse officer, reviewer, finance, and laboratory roles. Verify stock, charge, and approval counts against real records and recheck desktop/mobile dialogs. The public deployment still reflects an older application snapshot and was not changed here.
