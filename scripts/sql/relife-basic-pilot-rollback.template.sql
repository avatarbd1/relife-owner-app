-- I-1 Relife Basic pilot: rollback only the eight rows created by the apply template.
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
    raise exception 'I1_BASIC_PILOT_ROLLBACK_APPROVAL_REQUIRED';
  end if;
  select count(*) into v_matching_count
  from relife.clinic_feature_flags f
  join relife.organizations o on o.id = f.organization_id
  join relife.clinics c on c.organization_id = o.id and c.id = f.clinic_id
  where o.slug = 'relife' and c.slug = 'amtali-main'
    and f.enabled = false
    and f.enabled_by = 'controlled_canonicalization'
    and f.notes = 'i1-basic-pilot:2026-08-28'
    and f.feature_key = any(array[
      'optional.live_chamber','optional.room_bed_runtime','optional.machines',
      'optional.gamification','optional.rewards','optional.finance_advanced',
      'optional.salary','optional.live_chat'
    ]::text[]);
  if v_matching_count <> 8 then
    raise exception 'I1_BASIC_PILOT_ROLLBACK_PRECONDITION_FAILED:%', v_matching_count;
  end if;
end $$;

delete from relife.clinic_feature_flags f
using relife.organizations o, relife.clinics c
where o.id = f.organization_id
  and c.organization_id = o.id and c.id = f.clinic_id
  and o.slug = 'relife' and c.slug = 'amtali-main'
  and f.enabled = false
  and f.enabled_by = 'controlled_canonicalization'
  and f.notes = 'i1-basic-pilot:2026-08-28'
  and f.feature_key = any(array[
    'optional.live_chamber','optional.room_bed_runtime','optional.machines',
    'optional.gamification','optional.rewards','optional.finance_advanced',
    'optional.salary','optional.live_chat'
  ]::text[]);

commit;
