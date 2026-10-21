begin;
select plan(22);

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000007';
select throws_like($sql$select public.create_lab_sample(
  '20000000-0000-0000-0000-000000000001', null, current_date, 'Wellega', 'Natural')$sql$,
  '%do not have permission%', 'A viewer cannot register a sample');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';
select throws_like($sql$select public.create_lab_sample(
  '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002',
  current_date, 'Wellega', 'Natural')$sql$,
  '%does not belong%', 'A sample cannot link to another client lot');
select throws_like($sql$select public.create_lab_sample(
  '20000000-0000-0000-0000-000000000001', null, current_date, 'Wellega', 'Other')$sql$,
  '%Choose Washed, Natural, or UG%', 'Only supported coffee categories can be registered');
select set_config('test.lab_id', public.create_lab_sample(
  '20000000-0000-0000-0000-000000000001', null, current_date, 'Wellega', 'Natural')::text, true);
select ok((select sample_code like 'LAB-%' from public.lab_samples
  where id = current_setting('test.lab_id')::uuid),
  'A standalone sample receives a unique laboratory code');
select throws_like($sql$select public.submit_lab_sample(current_setting('test.lab_id')::uuid)$sql$,
  '%Complete green quality%', 'An incomplete assessment cannot be submitted');
select throws_like($sql$select public.save_lab_sample(current_setting('test.lab_id')::uuid,
  '{"greenComment":"Checked","cupComment":"Checked","proposedGrade":"UG"}'::jsonb)$sql$,
  '%grade allowed%', 'Natural coffee cannot be saved with UG as its grade');
select throws_like($sql$select public.save_lab_sample(current_setting('test.lab_id')::uuid,
  '{"greenComment":"Checked","cupComment":"Checked","proposedGrade":"Grade 6"}'::jsonb)$sql$,
  '%grade allowed%', 'The requested workflow limits Natural grades to 1 through 5');
select throws_like($sql$select public.save_lab_sample(current_setting('test.lab_id')::uuid,
  '{"moisturePercent":"eleven","greenComment":"Checked","cupComment":"Checked","proposedGrade":"Grade 5"}'::jsonb)$sql$,
  '%invalid input syntax for type numeric%', 'Numeric measurements reject words');
select lives_ok($sql$select public.save_lab_sample(current_setting('test.lab_id')::uuid,
  '{"moisturePercent":"11.2","screen14Percent":"93","shapeMake":"Mixed","greenOdour":"Strong","greenColour":"Brownish","greenQuality":"Poor to fair","greenComment":"Physical defects noted","cupCleanliness":"Clean","acidity":"Light","body":"Thin","flavour":"Fair","cupOverall":"Fair","cupComment":"Cups assessed","greenValue":"11","cupValue":"16","totalValue":"27","proposedGrade":"Grade 5","recommendation":"Review physical defects"}'::jsonb)$sql$,
  'A technician can save typed physical and cup results');
select lives_ok($sql$select public.submit_lab_sample(current_setting('test.lab_id')::uuid)$sql$,
  'A complete assessment can be submitted');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select is((select status from public.lab_samples where id = current_setting('test.lab_id')::uuid),
  'SUBMITTED', 'A submitted assessment waits for approval');
select set_config('test.lab_report_id', public.approve_lab_sample(current_setting('test.lab_id')::uuid)::text, true);
select is((select version from public.lab_reports where id = current_setting('test.lab_report_id')::uuid),
  1, 'Independent review creates report version one');
select is((select snapshot->>'proposed_grade' from public.lab_reports
  where id = current_setting('test.lab_report_id')::uuid), 'Grade 5', 'The approved report freezes the result');
reset role;
select throws_like($sql$update public.lab_reports set version = 2
  where id = current_setting('test.lab_report_id')::uuid$sql$,
  '%immutable%', 'An approved report cannot be changed');
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select lives_ok($sql$select public.reopen_lab_sample(current_setting('test.lab_id')::uuid)$sql$,
  'A manager can reopen a sample for revision');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select lives_ok($sql$select public.save_lab_sample(current_setting('test.lab_id')::uuid,
  '{"greenComment":"Rechecked green quality","cupComment":"Rechecked cup quality","proposedGrade":"Grade 4","recommendation":"New version"}'::jsonb)$sql$,
  'A revision can change the draft result');
select lives_ok($sql$select public.submit_lab_sample(current_setting('test.lab_id')::uuid)$sql$,
  'The revised result can be resubmitted');
select throws_like($sql$select public.approve_lab_sample(current_setting('test.lab_id')::uuid)$sql$,
  '%Another employee%', 'The submitter cannot approve their own result');
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select set_config('test.lab_report_2', public.approve_lab_sample(current_setting('test.lab_id')::uuid)::text, true);
select is((select version from public.lab_reports where id = current_setting('test.lab_report_2')::uuid),
  2, 'Independent approval creates a second version');
select is((select snapshot->>'proposed_grade' from public.lab_reports
  where id = current_setting('test.lab_report_id')::uuid), 'Grade 5', 'The earlier approved result remains intact');

select set_config('test.lab_ug_id', public.create_lab_sample(
  '20000000-0000-0000-0000-000000000001', null, current_date, 'Wellega', 'UG')::text, true);
select throws_like($sql$select public.save_lab_sample(current_setting('test.lab_ug_id')::uuid,
  '{"greenComment":"Checked","cupComment":"Checked","proposedGrade":"Grade 3"}'::jsonb)$sql$,
  '%grade allowed%', 'UG samples reject numeric grades');
select lives_ok($sql$select public.save_lab_sample(current_setting('test.lab_ug_id')::uuid,
  '{"greenComment":"Checked","cupComment":"Checked","proposedGrade":"UG"}'::jsonb)$sql$,
  'UG samples accept the undergrade label');

select * from finish();
rollback;
