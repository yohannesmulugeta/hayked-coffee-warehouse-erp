# Laboratory sample evaluation

## Public interface preview

Open the preview deployment with `?view=Laboratory`. When the preview has no Supabase connection, this link opens the read-only sample and evaluation screens directly. Registration, approval, PDF generation, and client email are disabled and no data is stored. A working online preview requires a separate test database and preview-only credentials; the production database must not be used for this purpose.

## Staff workflow

1. Register a sample under an active client. A warehouse lot is optional; the sample does not create or move stock.
2. Record green coffee findings, cup findings, scores, a proposed grade, and comments. Attach the source sheet or evidence if available.
3. Submit the draft. A different warehouse manager or system administrator reviews and approves it.
4. Approval freezes a numbered report snapshot. Staff can open the A4 Hayked PDF to print it or download a copy. Client email can be enabled later.
5. To correct an approved result, a manager reopens the sample. The earlier report remains available; a new approval creates the next version.

The sample form supplied by the user is a reference for fields only. The application does not copy its third-party branding, calculate a grade from its 40%/60% headings, decide export eligibility, or create a charge from a result. Hayked must supply its grading rules and approved laboratory rates before those actions can be automated. The result is separate from the GRN's original grade and moisture and from dispatch holds.

## Email setup

Email is optional for the database-and-print release. Leave `NEXT_PUBLIC_LAB_EMAIL_ENABLED` unset or `false` to hide the email action. When email is ready, the server needs `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and `LAB_REPORT_FROM_EMAIL`, and `NEXT_PUBLIC_LAB_EMAIL_ENABLED=true` exposes the action. Use a verified sender address in `LAB_REPORT_FROM_EMAIL`. Server credentials belong in the deployment platform's secret settings, never browser variables or Git. The app sends a PDF attachment through Resend only after a manager clicks **Send approved PDF to client**. The client must be active and have a valid email address in the ERP.

The email history records the report version, recipient, sender, request time, provider message ID, and outcome. `ACCEPTED` means the provider accepted the email request; it is not proof that the client's mailbox received it. A definite provider rejection can be retried. `PENDING` and `UNKNOWN` require checking the provider before another send, because the message may already have been sent.

## Access and deployment

Existing `processing_supervisor`, `warehouse_manager`, and `system_admin` roles may record and submit. Only a different manager or administrator can approve; managers and administrators may email approved results. Other staff roles can read reports. This version uses the existing roles because Hayked has not supplied a separate laboratory staff role and permission map.

Apply the additive migration to a copied or local Supabase database first. It creates `lab_samples`, immutable `lab_reports`, and `lab_report_deliveries`, with organization-scoped read policies and guarded write functions. It does not alter existing warehouse or financial records. Test the workflow with two real staff accounts and an email provider test destination before any client-facing send. The repository's Phase 1 production gate remains in force.

PDF text currently uses the standard Latin report font. If a client name or observation contains characters outside that font, PDF creation returns an error instead of changing the text. Add an approved embedded Unicode font before sending multilingual reports.
