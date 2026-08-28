-- Relife Physio generic tenant onboarding: production apply template.
-- DO NOT RUN until the Owner explicitly approves the exact production change ID.
-- The executor must replace REPLACE_WITH_OWNER_APPROVED_CHANGE_ID only after approval.
--
-- Scope: registers Relife/amtali-main's Physio department in
-- relife.clinic_data_sources so lib/patients.ts, lib/webos/reception.ts, and
-- supabase/functions/relife-report-storage resolve its legacy Sheets/storage
-- identity from config instead of a hardcoded literal. Dental is untouched.
-- This does not flip relife.clinics.status, does not run
-- relife.activate_clinic_v1, and does not change any clinic_feature_flags
-- (see scripts/sql/relife-basic-pilot-*.sql for that separate, already
-- owner-gated mechanism).

begin;

select set_config(
  'relife.owner_approved_change_id',
  'REPLACE_WITH_OWNER_APPROVED_CHANGE_ID',
  true
);

do $$
declare
  v_change_id text := current_setting('relife.owner_approved_change_id', true);
  v_tenant_count integer;
  v_existing_count integer;
begin
  if v_change_id is null or v_change_id = ''
     or v_change_id = 'REPLACE_WITH_OWNER_APPROVED_CHANGE_ID' then
    raise exception 'RELIFE_PHYSIO_SOURCES_OWNER_APPROVAL_REQUIRED';
  end if;

  select count(*) into v_tenant_count
  from relife.organizations o
  join relife.clinics c on c.organization_id = o.id
  where o.slug = 'relife' and c.slug = 'amtali-main';
  if v_tenant_count <> 1 then
    raise exception 'RELIFE_PHYSIO_SOURCES_TENANT_PRECONDITION_FAILED:%', v_tenant_count;
  end if;

  select count(*) into v_existing_count
  from relife.clinic_data_sources s
  join relife.organizations o on o.id = s.organization_id
  join relife.clinics c on c.organization_id = o.id and c.id = s.clinic_id
  where o.slug = 'relife' and c.slug = 'amtali-main'
    and s.source_kind in ('sheets_workbook', 'storage_prefix')
    and s.source_role in ('patients', 'patient_reports');
  if v_existing_count <> 0 then
    raise exception 'RELIFE_PHYSIO_SOURCES_BASELINE_CHANGED:%', v_existing_count;
  end if;
end $$;

with tenant as (
  select o.id organization_id, c.id clinic_id
  from relife.organizations o
  join relife.clinics c on c.organization_id = o.id
  where o.slug = 'relife' and c.slug = 'amtali-main'
), rows(source_kind, source_role, source_ref) as (values
  (
    'sheets_workbook',
    'patients',
    '{"workbook":"physio","department":"Physio","legacyOrganizationId":"RELIFE","legacyClinicId":"RELIFE-PHYSIO"}'
  ),
  ('storage_prefix', 'patient_reports', 'RELIFE-PHYSIO')
)
insert into relife.clinic_data_sources(
  organization_id, clinic_id, source_kind, source_role, source_ref,
  is_legacy, status, notes
)
select t.organization_id, t.clinic_id, r.source_kind, r.source_role, r.source_ref,
       true, 'active', 'relife-physio-generic-tenant:2026-08-28'
from tenant t cross join rows r;

do $$
declare
  v_applied_count integer;
begin
  select count(*) into v_applied_count
  from relife.clinic_data_sources s
  join relife.organizations o on o.id = s.organization_id
  join relife.clinics c on c.organization_id = o.id and c.id = s.clinic_id
  where o.slug = 'relife' and c.slug = 'amtali-main'
    and s.notes = 'relife-physio-generic-tenant:2026-08-28'
    and s.status = 'active';
  if v_applied_count <> 2 then
    raise exception 'RELIFE_PHYSIO_SOURCES_APPLY_VERIFICATION_FAILED:%', v_applied_count;
  end if;
end $$;

commit;
