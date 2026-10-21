# Production release readiness — 22 October 2026

Status: **HOLD**. No production code, data, or migration has been changed by this release attempt.

## Prepared candidate

- Integration branch: `codex/production-integration`, commit `67495d7`.
- The candidate merges the ERP workflow release into Vercel's configured production branch, `agent/processing-traceability-labour`. The dispatch conflict was resolved with the newer database-backed ECX workflow; existing hosting files were retained.
- Next.js was updated to 16.4.2 and the Sharp override to 0.35.5. A clean `npm ci` and `npm audit --omit=dev --audit-level=high` report zero production dependency vulnerabilities.
- Type checking, lint, Vinext build and bundle budget, Next.js production build, 78 application tests, and 106 local database tests pass. Database lint completes with three existing unused-parameter/variable warnings.
- [Demo-only Vercel preview](https://hayked-coffee-warehouse-4ld8eamo7-joni-building-s-projects.vercel.app): deployment `dpl_EWYsgBVs2g55dFaqRfRRXcdUJyzD`, READY. Its Supabase settings are intentionally empty; `/api/health` reports `not_configured`. It does not satisfy the connected preview gate.

## Production facts checked

- The active Vercel production deployment is `dpl_8SCUFeGPMc2Uk9bcFuPn3xM5qtz9`; its `/api/health` reports `healthy` and `database: reachable`. It was deployed through the CLI, so Vercel does not provide a Git commit SHA for it.
- Vercel's configured production branch is `agent/processing-traceability-labour`. Do not deploy the older `codex/simplify-erp-workflows` branch directly.
- A linked Supabase migration dry run with `--include-all` lists four pending migrations:
  - `20260901090000_simplify_processing_approval_flow.sql`
  - `20260909013150_billing_rent_and_service_workspace.sql`
  - `20261021204848_clarify_empty_bag_function_volatility.sql`
  - `20261021204917_clarify_empty_bag_quote_volatility.sql`
- A read-only production schema dump confirms that the earlier processing approval columns and billing workspace columns are absent. The two older migrations must be tested in a copied database before applying them after newer migrations. The schema dump is kept only under the ignored local `tmp/` directory.
- The pending processing migration makes ECX results optional for approval and start. The current UI and SQL tests expect this, but the former production gate described ECX as required. Warehouse management must confirm the policy before release.

## Required before production

1. Locate the warehouse, finance, and management approvals and decisions listed in [PHASE1_PRODUCTION_GATE.md](PHASE1_PRODUCTION_GATE.md), including the named dispatch and storage-run exceptions.
2. Obtain the copied/test Supabase database details. Apply and validate the four pending migrations there; verify the full receive, process, dispatch, laboratory, bag custody, billing, invoice, payment, report, and audit flows with authorized roles.
3. Verify a recent production backup by restoring it to an isolated environment and checking data and application health.
4. Record the release approvers, rollback owner, monitoring destination, and successful CI run for the exact candidate commit.
5. Only then apply the reviewed migration sequence and deploy the exact candidate to production, followed by read-only reconciliations and a live smoke test.
