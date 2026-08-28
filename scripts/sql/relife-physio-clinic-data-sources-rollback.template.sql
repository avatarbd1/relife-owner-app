-- Relife Physio generic tenant onboarding: rollback only the two rows
-- created by the apply template.
-- DO NOT RUN without an explicit Owner-approved rollback change ID.

begin;

select set_config(
  'relife.owner_approved_change_id',
  'REPLACE_WITH_OWNER_APPROVED_CHANGE_ID',
  true
);

do $$
declare
  v_change_id text := current_setting('relife.owner_approved_change_id', true);
  v_matching_count integer;
begin
  if v_change_id is null or v_change_id = ''
     or v_change_id = 'REPLACE_WITH_OWNER_APPROVED_CHANGE_ID' then
    raise exception 'RELIFE_PHYSIO_SOURCES_ROLLBACK_APPROVAL_REQUIRED';
  end if;

  select count(*) into v_matching_count
  from relife.clinic_data_sources s
  join relife.organizations o on o.id = s.organization_id
  join relife.clinics c on c.organization_id = o.id and c.id = s.clinic_id
  where o.slug = 'relife' and c.slug = 'amtali-main'
    and s.notes = 'relife-physio-generic-tenant:2026-08-28'
    and s.source_kind in ('sheets_workbook', 'storage_prefix')
    and s.source_role in ('patients', 'patient_reports');
  if v_matching_count <> 2 then
    raise exception 'RELIFE_PHYSIO_SOURCES_ROLLBACK_PRECONDITION_FAILED:%', v_matching_count;
  end if;
end $$;

delete from relife.clinic_data_sources s
using relife.organizations o, relife.clinics c
where o.id = s.organization_id
  and c.organization_id = o.id and c.id = s.clinic_id
  and o.slug = 'relife' and c.slug = 'amtali-main'
  and s.notes = 'relife-physio-generic-tenant:2026-08-28'
  and s.source_kind in ('sheets_workbook', 'storage_prefix')
  and s.source_role in ('patients', 'patient_reports');

commit;
