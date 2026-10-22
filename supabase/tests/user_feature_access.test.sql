begin;
select plan(15);

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000007';
select is(private.can_access_view('Finance'), false, 'Viewer has no Finance access by default');
select is(private.can_access_view('Reports'), true, 'Viewer keeps the existing Reports default');
select is((select count(*)::integer from public.invoices), 0, 'Viewer cannot read invoices through the API');
select is((select count(*)::integer from public.payments), 0, 'Viewer cannot read payments through the API');
select is((select count(*)::integer from public.audit_events), 0, 'Viewer cannot read audit history through the API');
select throws_like(
  $sql$select public.set_admin_view_override('10000000-0000-0000-0000-000000000007', 'Finance', true)$sql$,
  '%do not have permission%', 'Viewer cannot grant a feature');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select lives_ok(
  $sql$select public.set_admin_view_override('10000000-0000-0000-0000-000000000007', 'Finance', true)$sql$,
  'Administrator can grant Finance read access');
select lives_ok(
  $sql$select public.set_admin_view_override('10000000-0000-0000-0000-000000000007', 'Documents', false)$sql$,
  'Administrator can deny an existing default');
select throws_like(
  $sql$select public.set_admin_view_override('10000000-0000-0000-0000-000000000007', 'Administration', true)$sql$,
  '%Unsupported feature%', 'Administration cannot be granted as a feature');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000007';
select is(private.can_access_view('Finance'), true, 'Viewer grant takes effect without a new token');
select ok((select count(*) from public.invoices) > 0, 'Finance grant permits invoice reads');
select is(private.can_access_view('Documents'), false, 'Explicit deny overrides the role default');
select is((select count(*)::integer from public.documents), 0, 'Document deny blocks direct API reads');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select lives_ok(
  $sql$select public.update_admin_profile('10000000-0000-0000-0000-000000000007', 'viewer', false)$sql$,
  'Administrator can suspend the granted user');
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000007';
select is(private.can_access_view('Finance'), false, 'Suspension revokes the feature immediately');

select * from finish();
rollback;
