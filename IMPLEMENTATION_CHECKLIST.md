# Hayked Warehouse ERP - Current Checklist

Source of truth: Agreement-Aligned Master Plan v2.0 and Agreement No. 001/2018.

- [x] Fresh project created in the requested folder.
- [x] Responsive login and warehouse application shell.
- [x] Database-derived operational dashboard with clearly separated demo and unavailable states.
- [x] Clickable receipt draft, search, print overview, mobile navigation, and sign-out.
- [x] Persistent clients, agreements, representatives, GRN posting, lots, stock movements, reversals, and printable records.
- [x] Persistent processing requests, ECX checks, queue, reservations, intake, completion, output lots, and mass-balance checks.
- [x] Persistent storage loss, bag control, labour, generator, service history, and storage-rent records.
- [x] Transactional dispatch, release checks, ECX transfer, ownership transfer, and stock-reservation controls.
- [x] Tariff review, daily storage evidence, invoice snapshots, payments, statements, arrears, reports, documents, approvals, and audit history.
- [x] Role-aware UI, RLS, immutable ledgers, private documents, truthful database failure states, and server health check.
- [x] Application tests, database tests, production builds, dependency audit, CI workflow, browser checks, and client-bundle budget prepared locally.
- [ ] Obtain verified tariffs, labour/service rates, tax mappings, and management sign-off.
- [ ] Resolve `DSP-2026-0018` and `SBR-2026-0008` through approved business corrections.
- [ ] Configure an isolated preview, production server secret, monitoring, and release ownership.
- [ ] Complete and document a successful backup restore rehearsal.
- [ ] Run the full pilot with real role users, physical weighing/printing, concurrent actions, network interruption, duplicate clicks, and recovery scenarios.

Production tariffs and unapproved service charges remain blocked until signed sources and tax mappings are independently verified. The detailed release gate is `docs/PHASE1_PRODUCTION_GATE.md`.
