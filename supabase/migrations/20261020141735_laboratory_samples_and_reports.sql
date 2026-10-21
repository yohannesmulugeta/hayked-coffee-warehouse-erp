-- Laboratory assessments are independent of stock and financial ledgers.
create sequence public.lab_sample_number_seq;

create table public.lab_samples (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  sample_code text not null unique,
  client_id uuid not null references public.clients(id),
  lot_id uuid references public.coffee_lots(id),
  received_on date not null,
  origin text not null check (char_length(btrim(origin)) between 2 and 120),
  process text not null check (char_length(btrim(process)) between 2 and 120),
  moisture_percent numeric(6,2) check (moisture_percent between 0 and 100),
  screen_14_percent numeric(6,2) check (screen_14_percent between 0 and 100),
  shape_make text,
  green_odour text,
  green_colour text,
  green_quality text,
  green_comment text,
  cup_cleanliness text,
  acidity text,
  body text,
  flavour text,
  cup_overall text,
  cup_comment text,
  green_value numeric(8,2) check (green_value >= 0 and green_value::text <> 'NaN'),
  cup_value numeric(8,2) check (cup_value >= 0 and cup_value::text <> 'NaN'),
  total_value numeric(8,2) check (total_value >= 0 and total_value::text <> 'NaN'),
  proposed_grade text,
  recommendation text,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED', 'APPROVED')),
  report_version integer not null default 0 check (report_version >= 0),
  created_by uuid not null references public.profiles(id),
  last_edited_by uuid references public.profiles(id),
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'SUBMITTED' or (submitted_by is not null and submitted_at is not null)),
  check (greatest(
    char_length(coalesce(shape_make, '')), char_length(coalesce(green_odour, '')),
    char_length(coalesce(green_colour, '')), char_length(coalesce(green_quality, '')),
    char_length(coalesce(green_comment, '')), char_length(coalesce(cup_cleanliness, '')),
    char_length(coalesce(acidity, '')), char_length(coalesce(body, '')),
    char_length(coalesce(flavour, '')), char_length(coalesce(cup_overall, '')),
    char_length(coalesce(cup_comment, '')), char_length(coalesce(proposed_grade, '')),
    char_length(coalesce(recommendation, ''))
  ) <= 2000)
);
create index lab_samples_client_date_idx on public.lab_samples(client_id, received_on desc);
create index lab_samples_lot_idx on public.lab_samples(lot_id) where lot_id is not null;

create function private.validate_lab_document_reference()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.reference_type = 'LAB_SAMPLE' and not exists (
    select 1 from public.lab_samples s join public.profiles p
      on p.organization_id = s.organization_id
    where s.id = new.reference_id and p.id = (select auth.uid()) and p.active
  ) then raise exception 'Choose a laboratory sample in your organization.'; end if;
  return new;
end; $$;
create trigger documents_validate_lab_reference before insert or update of reference_type, reference_id on public.documents
for each row execute function private.validate_lab_document_reference();
revoke all on function private.validate_lab_document_reference() from public, anon, authenticated;

create table public.lab_reports (
  id uuid primary key default gen_random_uuid(),
  sample_id uuid not null references public.lab_samples(id),
  version integer not null check (version > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null default now(),
  unique(sample_id, version)
);

create function private.prevent_lab_report_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Approved laboratory reports are immutable. Create a new version.';
end; $$;
create trigger lab_reports_immutable before update or delete on public.lab_reports
for each row execute function private.prevent_lab_report_mutation();
revoke all on function private.prevent_lab_report_mutation() from public, anon, authenticated;

create table public.lab_report_deliveries (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.lab_reports(id),
  organization_id uuid not null references public.organizations(id),
  recipient_email text not null,
  sent_by uuid not null references public.profiles(id),
  status text not null check (status in ('PENDING', 'ACCEPTED', 'FAILED', 'UNKNOWN')),
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'ACCEPTED' or provider_message_id is not null)
);
create unique index lab_delivery_one_unresolved_idx
  on public.lab_report_deliveries(report_id, lower(recipient_email))
  where status in ('PENDING', 'ACCEPTED', 'UNKNOWN');

alter table public.lab_samples enable row level security;
alter table public.lab_reports enable row level security;
alter table public.lab_report_deliveries enable row level security;

create policy lab_samples_staff_read on public.lab_samples for select to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid())
  and p.active and p.organization_id = lab_samples.organization_id));
create policy lab_reports_staff_read on public.lab_reports for select to authenticated
using (exists (select 1 from public.lab_samples s where s.id = lab_reports.sample_id));
create policy lab_deliveries_staff_read on public.lab_report_deliveries for select to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid())
  and p.active and p.organization_id = lab_report_deliveries.organization_id));

revoke all on public.lab_samples, public.lab_reports, public.lab_report_deliveries from public, anon, authenticated;
grant select on public.lab_samples, public.lab_reports, public.lab_report_deliveries to authenticated;
revoke all on sequence public.lab_sample_number_seq from public, anon, authenticated;

create function public.create_lab_sample(
  p_client_id uuid, p_lot_id uuid, p_received_on date, p_origin text, p_process text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_id uuid; v_code text;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  select p.organization_id into v_org from public.profiles p
    where p.id = (select auth.uid()) and p.active;
  if v_org is null then raise exception 'Your account is not active.'; end if;
  if not exists (select 1 from public.clients c where c.id = p_client_id
    and c.organization_id = v_org and c.active) then
    raise exception 'Choose an active client in your organization.';
  end if;
  if p_lot_id is not null and not exists (select 1 from public.coffee_lots l
    where l.id = p_lot_id and l.client_id = p_client_id) then
    raise exception 'The selected lot does not belong to this client.';
  end if;
  if p_received_on is null or p_received_on > current_date then
    raise exception 'Choose a valid sample receipt date.';
  end if;
  if char_length(btrim(coalesce(p_origin, ''))) not between 2 and 120
    or char_length(btrim(coalesce(p_process, ''))) not between 2 and 120 then
    raise exception 'Origin and process must each contain 2 to 120 characters.';
  end if;
  v_code := 'LAB-' || to_char(current_date, 'YYYY') || '-' ||
    lpad(nextval('public.lab_sample_number_seq'::regclass)::text, 6, '0');
  insert into public.lab_samples(organization_id, sample_code, client_id, lot_id,
    received_on, origin, process, created_by)
  values(v_org, v_code, p_client_id, p_lot_id, p_received_on,
    btrim(p_origin), btrim(p_process), (select auth.uid())) returning id into v_id;
  perform private.record_audit('LAB_SAMPLE_CREATED', 'LAB_SAMPLE', v_id,
    jsonb_build_object('sample_code', v_code, 'client_id', p_client_id, 'lot_id', p_lot_id));
  return v_id;
end; $$;

create function public.save_lab_sample(p_sample_id uuid, p_results jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_sample public.lab_samples;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  if p_results is null or jsonb_typeof(p_results) <> 'object' then
    raise exception 'Provide the laboratory result fields.';
  end if;
  select s.* into v_sample from public.lab_samples s
    join public.profiles p on p.organization_id = s.organization_id
    where s.id = p_sample_id and p.id = (select auth.uid()) and p.active
    for update of s;
  if not found then raise exception 'Sample not found in your organization.'; end if;
  if v_sample.status <> 'DRAFT' then raise exception 'Only a draft sample can be edited.'; end if;
  update public.lab_samples set
    moisture_percent = nullif(p_results->>'moisturePercent', '')::numeric,
    screen_14_percent = nullif(p_results->>'screen14Percent', '')::numeric,
    shape_make = nullif(btrim(p_results->>'shapeMake'), ''),
    green_odour = nullif(btrim(p_results->>'greenOdour'), ''),
    green_colour = nullif(btrim(p_results->>'greenColour'), ''),
    green_quality = nullif(btrim(p_results->>'greenQuality'), ''),
    green_comment = nullif(btrim(p_results->>'greenComment'), ''),
    cup_cleanliness = nullif(btrim(p_results->>'cupCleanliness'), ''),
    acidity = nullif(btrim(p_results->>'acidity'), ''),
    body = nullif(btrim(p_results->>'body'), ''),
    flavour = nullif(btrim(p_results->>'flavour'), ''),
    cup_overall = nullif(btrim(p_results->>'cupOverall'), ''),
    cup_comment = nullif(btrim(p_results->>'cupComment'), ''),
    green_value = nullif(p_results->>'greenValue', '')::numeric,
    cup_value = nullif(p_results->>'cupValue', '')::numeric,
    total_value = nullif(p_results->>'totalValue', '')::numeric,
    proposed_grade = nullif(btrim(p_results->>'proposedGrade'), ''),
    recommendation = nullif(btrim(p_results->>'recommendation'), ''),
    last_edited_by = (select auth.uid()), updated_at = now()
  where id = p_sample_id;
  perform private.record_audit('LAB_SAMPLE_SAVED', 'LAB_SAMPLE', p_sample_id,
    jsonb_build_object('sample_code', v_sample.sample_code));
end; $$;

create function public.submit_lab_sample(p_sample_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_sample public.lab_samples;
begin
  perform private.require_role('system_admin', 'warehouse_manager', 'processing_supervisor');
  select s.* into v_sample from public.lab_samples s
    join public.profiles p on p.organization_id = s.organization_id
    where s.id = p_sample_id and p.id = (select auth.uid()) and p.active
    for update of s;
  if not found then raise exception 'Sample not found in your organization.'; end if;
  if v_sample.status <> 'DRAFT' then raise exception 'Only a draft sample can be submitted.'; end if;
  if v_sample.green_comment is null or v_sample.cup_comment is null
    or v_sample.proposed_grade is null then
    raise exception 'Complete green quality, cup quality, and proposed grade before review.';
  end if;
  update public.lab_samples set status = 'SUBMITTED', submitted_by = (select auth.uid()),
    submitted_at = now(), updated_at = now() where id = p_sample_id;
  perform private.record_audit('LAB_SAMPLE_SUBMITTED', 'LAB_SAMPLE', p_sample_id,
    jsonb_build_object('sample_code', v_sample.sample_code));
end; $$;

create function public.approve_lab_sample(p_sample_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_sample public.lab_samples; v_report_id uuid; v_client_name text; v_lot_number text;
  v_reviewer_name text; v_version integer; v_approved_at timestamptz := now();
begin
  perform private.require_role('system_admin', 'warehouse_manager');
  select s.* into v_sample from public.lab_samples s
    join public.profiles p on p.organization_id = s.organization_id
    where s.id = p_sample_id and p.id = (select auth.uid()) and p.active
    for update of s;
  if not found then raise exception 'Sample not found in your organization.'; end if;
  if v_sample.status <> 'SUBMITTED' then raise exception 'Only a submitted sample can be approved.'; end if;
  if v_sample.submitted_by = (select auth.uid()) then
    raise exception 'Another employee must approve this assessment.';
  end if;
  select c.legal_name into v_client_name from public.clients c where c.id = v_sample.client_id;
  select l.lot_number into v_lot_number from public.coffee_lots l where l.id = v_sample.lot_id;
  select p.full_name into v_reviewer_name from public.profiles p where p.id = (select auth.uid());
  v_version := v_sample.report_version + 1;
  insert into public.lab_reports(sample_id, version, snapshot, approved_by, approved_at)
  values(p_sample_id, v_version,
    to_jsonb(v_sample) || jsonb_build_object('client_name', v_client_name,
      'lot_number', v_lot_number,
      'reviewer_name', v_reviewer_name, 'approved_at', v_approved_at),
    (select auth.uid()), v_approved_at)
  returning id into v_report_id;
  update public.lab_samples set status = 'APPROVED', report_version = v_version,
    updated_at = now() where id = p_sample_id;
  perform private.record_audit('LAB_REPORT_APPROVED', 'LAB_SAMPLE', p_sample_id,
    jsonb_build_object('sample_code', v_sample.sample_code, 'version', v_version,
      'report_id', v_report_id));
  return v_report_id;
end; $$;

create function public.reopen_lab_sample(p_sample_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_sample public.lab_samples;
begin
  perform private.require_role('system_admin', 'warehouse_manager');
  select s.* into v_sample from public.lab_samples s
    join public.profiles p on p.organization_id = s.organization_id
    where s.id = p_sample_id and p.id = (select auth.uid()) and p.active
    for update of s;
  if not found then raise exception 'Sample not found in your organization.'; end if;
  if v_sample.status <> 'APPROVED' then raise exception 'Only an approved sample can be revised.'; end if;
  update public.lab_samples set status = 'DRAFT', submitted_by = null,
    submitted_at = null, updated_at = now() where id = p_sample_id;
  perform private.record_audit('LAB_SAMPLE_REOPENED', 'LAB_SAMPLE', p_sample_id,
    jsonb_build_object('previous_report_version', v_sample.report_version));
end; $$;

revoke all on function public.create_lab_sample(uuid,uuid,date,text,text) from public,anon;
revoke all on function public.save_lab_sample(uuid,jsonb) from public,anon;
revoke all on function public.submit_lab_sample(uuid) from public,anon;
revoke all on function public.approve_lab_sample(uuid) from public,anon;
revoke all on function public.reopen_lab_sample(uuid) from public,anon;
grant execute on function public.create_lab_sample(uuid,uuid,date,text,text) to authenticated;
grant execute on function public.save_lab_sample(uuid,jsonb) to authenticated;
grant execute on function public.submit_lab_sample(uuid) to authenticated;
grant execute on function public.approve_lab_sample(uuid) to authenticated;
grant execute on function public.reopen_lab_sample(uuid) to authenticated;
