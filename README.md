# Hayked Coffee Warehouse ERP

Agreement-aligned warehouse operations for Hayked General Trading PLC.

## Current Prototype

The first product slice includes the responsive sign-in experience, warehouse navigation, operational dashboard, demo-state labeling, record search, print overview, alert states, and a draft warehouse-receipt form.

```powershell
npm run dev
```

Open the local URL shown by the development server. Demo credentials are pre-filled.

## Governing Rules

- Washed coffee allowance: 22.5% total, including 20% Hayked-owned byproduct and up to 2.5% genuine process loss.
- Unwashed/UG allowance: 2.5%.
- Storage loss is separate and normally limited to 1.5%.
- Production tariffs must not be activated until their scanned sources and tax mappings are independently verified.

## Supabase Foundation

The migration in `supabase/migrations` creates the warehouse schema, role-based RLS, immutable stock/payment/audit ledgers, maker-checker approvals, and a private `erp-documents` bucket.

Copy `.env.example` to `.env.local` only after a dedicated Hayked Supabase project is selected. Use its project URL and publishable key; never place a secret or service-role key in a public environment variable. The app keeps demo sign-in active while these values are absent.
