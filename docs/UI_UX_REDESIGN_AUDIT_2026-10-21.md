# Hayked ERP UI/UX audit and redesign plan

Date: 21 October 2026
Status: audit and implementation plan; no application, database, or deployment changes

## Scope and evidence

This plan covers the current checkout at `D:\01_Software_Development\1.3_AI_and_Agent_Projects\antigravity project\Hayked coffee ERP`. It includes the recently added physical quantity checks, rebagging and blending jobs, operational approval queue, lot trace, empty-bag custody, empty-bag storage charges, and laboratory workflow. Preserve the existing React/TypeScript application, Hayked navy and teal identity, Supabase/PostgreSQL rules, records, and role permissions.

- The checkout is on `codex/simplify-erp-workflows`, five commits behind its remote, with substantial existing modified and untracked work. The new components and migrations are among that work. Preserve and reconcile it before implementation or release.
- Current source was reviewed across `app/page.tsx`, the operational modules, shared UI, `app/globals.css`, `lib/erp-data.ts`, `lib/quantity-checks.ts`, `lib/empty-bags.ts`, and the new migrations and SQL tests.
- The local sign-in page was checked at 1440px desktop and 390px mobile earlier today. At 390px, the form begins 605px down the page; the page has no horizontal overflow. Those captures are in `output/playwright/audit-2026-10-21-*.png`.
- A fresh, signed-in production tab was inspected read only. Its dashboard is usable but visually dense at a wide desktop size. Its Laboratory form differs from this checkout, so production is not proof of the new local features. A current signed-in local walkthrough was unavailable.
- Baseline commands passed: `npm.cmd run typecheck`, `npm.cmd test` (78 tests, including the Vinext build and bundle budget), and `npm.cmd run build:next`. `npm.cmd run lint` returned zero errors and two warnings in existing `tmp/` scripts. The new SQL tests and an authenticated browser journey were not run in this audit.

## Product structure to retain

| Existing area | Current role in the journey | Newly added behavior to include |
| --- | --- | --- |
| Dashboard and navigation | Warehouse position, attention, global search | Pending physical checks and transformation reviews need to appear in attention and search |
| Receiving and stock | GRN, lots, movements and detail views | Declared versus measured arrival check; source and destination lot trace |
| Processing | Requests, queue, intake, completion, output lots | Intake/output checks; rebagging and blending jobs |
| Dispatch | Approval, release and stock exit | Physical exit check before posting |
| Bag Control | Client-owned empty-bag custody ledger | Locations, condition, movements and correction approval |
| Billing | Client accounts, rent, services, invoices and payments | Receipt-cohort empty-bag charge calculation, review and posting |
| Laboratory | Samples and versioned reports | Controlled category/grade entry and independent approval |
| Approvals and Reports | Review queues and oversight | Physical checks, special jobs and quantity issue reporting |

## Findings, ordered by impact

### P0 — make pending decisions visible and trustworthy

**1. New approvals are split from the dashboard's attention count.** `OperationalApprovalQueue` loads pending quantity checks and transformation jobs, but `buildDashboardData` calculates `pendingApprovals` only from the older `approvals` records. A manager can see a clear dashboard badge while new stock-changing work waits in the Approvals page. The new queue sits above the older queue, creating two review sections with different summaries. Fix the aggregate count and route each attention item to the exact filtered review, while retaining each authoritative decision RPC and maker-checker rule.

**2. Review cards lack enough record identity.** The new queue headings use stage plus the first eight characters of a UUID, or job type plus a shortened UUID. They show quantities and evidence text but do not lead reviewers to a clearly identified client, human-readable receipt/order/lot, warehouse, time, and full source record. Add an evidence-first review detail: source reference, client, stage, expected versus measured kg/bags and variance, evidence reference, previous decision state, and an explicit link to the source record. Put the decision note and Approve/Reject actions after that context. Never imply that a reviewer can approve their own work.

**3. Visible text contradicts the new workflow.** Bag Control still says storage charges are pending finance-approved billing rules, while Billing contains an empty-bag charge flow. The sign-in page still offers a nonfunctional password reset button and a session checkbox with no implemented behavior; the dashboard offers a movement-period selector with no change behavior. Update or remove these controls and notices as part of the first slice. Every visible control should have a clear result.

### P1 — connect the user's work across modules

**4. Navigation loses context.** `app/page.tsx` keeps the active view in local component state and resets it to Dashboard on refresh. Global search results navigate into a module, but only some modules receive a focus ID; Billing receives no client or record intent. The new trace, bag and approval workflows therefore require repeated client/record selection. Introduce URL-backed view, tab and record context, with role checks before navigation. Keep filters and list position when returning from detail views. A link from a lot to processing, dispatch, charges or evidence must open the related record rather than a generic list.

**5. Global search and dashboard do not cover the new records.** The dashboard search index includes common clients, receipts, lots and finance records, but not quantity checks, transformation jobs, laboratory samples or empty-bag charge runs. Add only authorized, human-readable results with type and client context. Show recent or task-specific results when the query is empty, an empty state when nothing matches, and accessible keyboard selection. Keep search within the existing data access model.

**6. New operational actions are hidden in dense parent screens.** Rebag/blend is a secondary button inside Processing; quantity checks appear inline at different stages; empty-bag custody is under More while its charges are under Billing. These are valid parent areas, but staff need clear stage-specific entry points and next actions. Put a compact "Next action" panel on each record, show whether stock is blocked, waiting for independent review, posted or rejected, and link to the corresponding review or source record. Do not create parallel business workflows.

### P1 — reduce form and review error

**7. Special jobs need a reviewable before/after summary.** The form captures multiple source lots, measured quantities, output, section and evidence, but its primary feedback is a single total line and generic validation message. Show each selected lot's available balance and the proposed remaining balance, identify duplicate/ineligible sources in place, and present an output reconciliation before submission. History should lead with client, readable job reference, date and status. Keep the database's exact kilogram equality and independent review requirements.

**8. Bag billing exposes its mechanics before its decision.** The new charge screen places client, agreement, legal clause, dates, calculation, daily cohorts, evidence, review, posting and history in one long card. Divide it into visible stages: Select client/period, Calculate and inspect, Prepare with evidence, Independent review, Post to unbilled work, then Invoice. Label a quote as an estimate and a posted charge as final. Put the amount, 50-bag-day quantity, free-day outcome and source receipts first; keep the daily ledger available as expandable evidence. Preserve the existing Article 16 rules and recorded calculation rows.

**9. Laboratory and other long forms can lose draft work.** Selecting another lab sample resets the evaluation inputs from the selected record. Several multi-section forms and drawers offer no unsaved-changes guard. Warn before switching records, closing, signing out or leaving a dirty form; retain entered values after validation errors; show the saved state and next action. Use the existing Save draft path where it exists. Do not silently autosave stock, billing, approval or laboratory decisions.

### P2 — legibility, accessibility and consistency

**10. The visual hierarchy is too small and crowded.** The current dashboard retains 9–11px metadata and metric labels, a 304px desktop sidebar, and many simultaneous cards. The production dashboard has separate sidebar and page scroll areas. Increase body and key table text to a readable scale, use at least 12px for secondary text, narrow the sidebar at laptop widths, and give records room before charts and decorative panels. The newer 14px table floor is a good start; avoid undoing it.

**11. Record lineage is present but hard to scan.** `LotTrace` renders processing inputs, outputs, checks and transformation jobs as paragraphs, often using raw IDs. Turn this into an ordered timeline with readable references, quantity changes, ownership, status and source links. For blended sources, retain the existing disclosure that individual input contribution to each output was not measured. Never invent provenance.

**12. Modal and row keyboard behavior is inconsistent.** The shared `RecordDetailDrawer` declares a modal dialog but does not manage initial focus, Escape, focus containment or focus return. Some custom dialogs and clickable rows follow different patterns. Create one tested dialog behavior and semantic record-row pattern, then apply it incrementally to touched screens. Preserve visible focus, keyboard reachability and reduced-motion support.

**13. The mobile layout needs task-based compression.** The sign-in story delays the form. Several operational screens use wide tables or full-width step guides. On 320–430px screens, show the primary action and record identity first, keep one column for editable forms, convert only essential list columns into compact cards, and let evidence tables scroll inside their own container. Never hide critical quantities or approval state solely to fit the viewport.

## Proposed experience and screen behavior

1. **Navigation and task home:** Keep role-aware navigation, grouped into Overview, Coffee Operations, Client & Services, Finance, and Governance. Keep current parent modules and labels where staff already recognize them. Add a visible pending-work entry and exact counts for legacy approvals, physical checks, special jobs and bag decisions. Use a clear profile menu with Sign out.
2. **One record context:** Show client, reference, stage, location, kg/bags, status and responsible next role in a stable header on record details. Breadcrumbs and links should preserve the selected client, filter and source record. Browser Back and refresh should return to the same safe view.
3. **Operational status language:** Use a small shared vocabulary: Draft, Waiting for review, Approved, Blocked by variance, Posted, Rejected and Corrected. Map it to existing database statuses rather than renaming the database. Show who can act next and why an action is unavailable.
4. **Receiving through dispatch:** At each physical handoff, pair the expected amount with measured kg and bags, display the difference prominently, require evidence and route to an independent review when the existing rules require it. After a decision, show the stock movement or hold and link back to its source.
5. **Processing and special jobs:** Keep normal processing and rebag/blend as distinct tasks in one Processing area. Show candidate source lots and available balances, then a review summary before submitting. Put detailed stage progress on the selected request/order/job, not on the whole list.
6. **Bag custody and finance:** Show the verified empty-bag balance by client, warehouse, location and condition in Bag Control. Link to the related charge view without treating coffee-lot bags as empty-bag custody. In Billing, show the charge source, rate version, period, quantity basis, review state, invoice state and saved daily evidence.
7. **Laboratory:** Keep the category/grade controls and independent report approval. Divide long evaluation forms into Green assessment, Cup assessment, Conclusion and Review sections, with a sticky or repeated Save draft/Submit action where appropriate. Preserve the approved report version history.
8. **Reports:** Put common operational and finance reports first. Add Quantity Issues with clear denominators and drill-downs to checked records. Keep CSV/PDF output readable at print width and preserve role restrictions.

## Implementation stages and acceptance gates

| Stage | Main changes | Likely files | Acceptance gate |
| --- | --- | --- | --- |
| 0. Preserve and map | Checkpoint current work, reconcile branch and migration state, confirm roles and representative records, capture fresh signed-in desktop/mobile baselines | No product code; audit evidence | Existing work is safe; no production records changed during the audit |
| 1. Shared foundation | Type scale, spacing, status tokens, page headers, semantic tables, form feedback, dialog focus, mobile shell and profile menu | `app/globals.css`, `app/page.tsx`, `app/workflow-ui.tsx`, touched modules | Readable at 1366×768 and 390×844; keyboard-only access; no dead controls |
| 2. Navigation and task inbox | URL-backed views and record intent, preserved filters, global search coverage, combined pending counts and actionable review links | `app/page.tsx`, `app/ux-rules.ts`, `app/view-registry.ts`, `lib/erp-data.ts`, `app/management-operations.tsx`, `app/operational-approval-queue.tsx` | Back/refresh/deep links restore context; role-appropriate counts match underlying pending records |
| 3. Coffee operations | Record headers, quantity comparisons, special-job summary, accessible approvals, lot timeline, stage-specific actions | `app/core-operations.tsx`, `app/processing-operations.tsx`, `app/dispatch-operations.tsx`, `app/quantity-check-panel.tsx`, `app/special-jobs.tsx`, `app/lot-trace.tsx` | A staff member can trace receipt → review → stock → processing/rebag/blend → exit without losing record identity |
| 4. Client services and finance | Bag custody-to-charge handoff, staged charge screen, clear account and invoice links, laboratory draft protection, report priorities | `app/empty-bag-control.tsx`, `app/empty-bag-billing.tsx`, `app/finance-operations.tsx`, `app/laboratory-operations.tsx`, `app/management-operations.tsx` | Charge source and status are understandable; no duplicate entry; drafts survive recoverable navigation |
| 5. Release verification | Role-based browser walkthroughs, accessibility/responsive checks, SQL and app tests, production parity check | Relevant focused tests and release notes | No critical console/server errors, no broken permissions or data flows; public deployment separately verified |

## Data, security and deployment boundaries

- The first two stages should not require a schema migration. Prefer existing tables and RPCs for record context and pending counts. If a new query or view is required, inspect RLS and grants before implementation; do not bypass an authoritative stock or billing function for UI convenience.
- The new migrations and SQL tests are currently untracked. Do not reset or delete a database to make them pass. Verify migration history and exercise the tests in an isolated/local database before any release decision.
- Preserve the no-negative-stock, idempotency, maker-checker, approved-grade, custody-ledger and posted-charge boundaries. The UI should explain these states; it should not recreate their rules in the browser as the only safeguard.
- The fresh production page did not match the current local Laboratory source. Treat local build success, database migration status, deployment readiness and signed-in public verification as separate gates.
- No new library or framework is needed for the proposed first stages. Extract small shared UI pieces from the large modules only when a touched flow benefits; avoid a full rewrite.

## Verification matrix for each released slice

- Roles: system admin, warehouse manager, warehouse officer, processing supervisor, finance officer, auditor and viewer. Verify both allowed actions and correctly explained unavailable actions.
- Widths: 1440×900, 1366×768, 1024×768, 768×1024, 390×844 and 320×700. Check the full page, internal table scroll and dialogs, not just the top viewport.
- Inputs: empty, valid, invalid, duplicate, boundary quantity, pending review, rejected, and database unavailable states. Verify entered values remain after errors.
- Navigation: direct link, Back/Forward, refresh, return from detail, client/lot filter preservation and search result focus.
- Accessibility: headings and labels, focus order, Escape and focus return for dialogs, keyboard activation for rows/tabs, contrast, status announcements and reduced motion.
- Build and logic: `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test`, `npm.cmd run build:next`; then focused SQL tests for the new migrations in an isolated database. Check browser console and server logs on the signed-in journey.

## Definition of done

For a representative client, staff can find a receipt, understand its physical check, follow its lot through processing or a special job, see any variance and independent decision, trace dispatch, inspect empty-bag custody and charges where applicable, then explain the invoice and report. Every screen uses readable labels and an unambiguous next action. The same journey works with a keyboard and on a phone. The numbers and approval state shown in the UI reconcile with the authoritative records, and the deployed version is verified separately from the local checkout.
