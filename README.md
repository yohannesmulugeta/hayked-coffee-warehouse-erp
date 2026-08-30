# Hayked Coffee Warehouse ERP

Agreement-aligned warehouse operations for Hayked General Trading PLC.

## Current local state

The repository contains a connected Next.js/React warehouse ERP with Supabase/PostgreSQL migrations for receiving, coffee lots, processing, dispatch, ownership and ECX transfers, service records, storage billing, invoices, payments, approvals, documents, reporting, administration, and immutable audit history.

Phase 1 adds database-authoritative posting guards, role-aware navigation, truthful database failure states, approved service-rate controls, health checking, database tests, and CI. Phase 2 adds route-level feature loading, a client-bundle budget, accessibility improvements, responsive navigation behavior, clearer operational wording, and current tooling versions.

```powershell
npm run dev
```

Open the local URL shown by the development server. When Supabase variables are configured, sign-in uses the assigned local or project user; sample credentials are only pre-filled when the app is intentionally running without Supabase configuration.

## Quality checks

```powershell
npm run lint
npm run typecheck
npm test
npm run build:next
npm audit --omit=dev
npx supabase test db
npx supabase db lint --local --level warning
```

`npm test` includes a 500 KB maximum for any generated client JavaScript chunk.

## Governing Rules

- Washed coffee allowance: 22.5% total, including 20% Hayked-owned byproduct and up to 2.5% genuine process loss.
- Unwashed/UG allowance: 2.5%.
- Storage loss is separate and normally limited to 1.5%.
- Production tariffs must not be activated until their scanned sources and tax mappings are independently verified.

## Supabase Foundation

The ordered migrations in `supabase/migrations` create the warehouse schema, role-based RLS, immutable stock/payment/audit ledgers, maker-checker approvals, transactional posting functions, and a private `erp-documents` bucket.

Copy `.env.example` to `.env.local` only after a dedicated Hayked Supabase project is selected. Use its project URL and publishable key; never place a secret or service-role key in a public environment variable. The app keeps demo sign-in active while these values are absent.

## Production status

The application is **not approved for production**. Read [docs/PHASE1_PRODUCTION_GATE.md](docs/PHASE1_PRODUCTION_GATE.md) before any preview or production release. In particular, signed tariffs and tax mappings, disputed legacy records, production secrets, a tested backup restore, monitoring ownership, the release branch, and operational sign-off remain external gates. Do not seed, migrate, or repair production data without explicit approval.
