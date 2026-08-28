-- Relife Physio generic tenant onboarding: read-only production preflight.
-- Registers Relife's Physio department as a normal relife.clinic_data_sources
-- consumer (see lib/data/clinicDataSources.ts) instead of the hardcoded
-- RELIFE / RELIFE-PHYSIO literals in lib/config/relifeSystem.ts and friends.
-- Dental is explicitly out of scope and stays on its existing hardcoded path.
-- This file contains SELECT/DO validation only and performs no writes.

begin transaction read only;

do $$
declare
  v_tenant_count integer;
  v_existing_count integer;
begin
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
select t.organization_id, t.clinic_id, r.source_kind, r.source_role, r.source_ref,
       true is_legacy, 'active' status,
       'relife-physio-generic-tenant:2026-08-28' notes
from tenant t cross join rows r
order by r.source_kind, r.source_role;

rollback;
