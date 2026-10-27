# Staff access administration

The system administrator creates staff users and assigns one operational role in **Administration**. The role determines who can create, change, post, and approve records. **Feature access** below the user list controls which modules a staff member can open and read. A feature grant does not add write or approval authority.

For each feature, choose **Use role default**, **Allow reading**, or **Deny reading**. The change is saved immediately, recorded in Audit History, and enforced by database read policies on the feature's records. A signed-in user receives updated access on the next window focus or within one minute. Shared data such as client names and coffee lots can still appear in another module the user may read; feature access is not client-level data segregation.

**Administration** cannot be granted as an individual feature. Only an active `system_admin` can manage accounts or feature overrides. At least one active system administrator must remain. Suspending a user blocks database access immediately; the app signs out an open session when it next checks access. New Auth-created profiles start inactive until the administrator's account creation flow completes.

## Production trial roles

The `production_assistant` role can create and submit processing requests and record processing quantity checks. It cannot approve requests or checks, queue, start or complete processing, or post stock. `production_assistant_weighbridge` has the same production access and can also record an outgoing weighbridge reference on an unapproved dispatch. That action cannot change document readiness, notes, stock, or approval. A Production Officer uses the existing `processing_supervisor` role. Warehouse Manager and Warehouse Officer use the existing warehouse roles.

For trial accounts, use the job title as the display name. When real employees begin working, create accounts under their own identities and deactivate trial accounts so audit history stays attributable to the person who performed the action.

## Verify a change

1. As a system administrator, select the staff user and save the role and Active status first.
2. Set only the feature read overrides the staff member needs.
3. Have the staff member refresh the app, confirm the navigation and report types, and check an allowed and denied record read.
4. For operational actions, test with a separate account in the assigned role. A read grant alone must not allow posting or approval.

The database migration `user_feature_access` must be applied before deploying the app version that calls `get_my_view_access`.
