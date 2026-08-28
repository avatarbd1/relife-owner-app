-- I-1 Relife Basic pilot: production apply template.
-- DO NOT RUN until the Owner explicitly approves the exact production change ID.
-- The executor must replace REPLACE_WITH_OWNER_APPROVED_CHANGE_ID only after approval.

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
  v_catalog_count integer;
  v_flag_count integer;
  v_entitlement_count integer;
begin
  if v_change_id is null or v_change_id = ''
     or v_change_id = 'REPLACE_WITH_OWNER_APPROVED_CHANGE_ID' then
    raise exception 'I1_BASIC_PILOT_OWNER_APPROVAL_REQUIRED';
  end if;

  select count(*) into v_tenant_count
  from relife.organizations o
  join relife.clinics c on c.organization_id = o.id
  where o.slug = 'relife' and c.slug = 'amtali-main';
  if v_tenant_count <> 1 then
    raise exception 'I1_BASIC_PILOT_TENANT_PRECONDITION_FAILED:%', v_tenant_count;
  end if;

  select count(*) into v_catalog_count
  from relife.feature_catalog
  where status = 'active' and feature_key = any(array[
    'optional.live_chamber','optional.room_bed_runtime','optional.machines',
    'optional.gamification','optional.rewards','optional.finance_advanced',
    'optional.salary','optional.live_chat'
  ]::text[]);
  if v_catalog_count <> 8 then
    raise exception 'I1_BASIC_PILOT_CATALOG_PRECONDITION_FAILED:%', v_catalog_count;
  end if;

  select count(*) into v_flag_count
  from relife.clinic_feature_flags f
  join relife.organizations o on o.id = f.organization_id
  join relife.clinics c on c.organization_id = o.id and c.id = f.clinic_id
  where o.slug = 'relife' and c.slug = 'amtali-main'
    and f.feature_key = any(array[
      'optional.live_chamber','optional.room_bed_runtime','optional.machines',
      'optional.gamification','optional.rewards','optional.finance_advanced',
      'optional.salary','optional.live_chat'
    ]::text[]);
  if v_flag_count <> 0 then
    raise exception 'I1_BASIC_PILOT_FLAG_BASELINE_CHANGED:%', v_flag_count;
  end if;

  select count(*) into v_entitlement_count
  from relife.clinic_entitlements e
  join relife.organizations o on o.id = e.organization_id
  join relife.clinics c on c.organization_id = o.id and c.id = e.clinic_id
  where o.slug = 'relife' and c.slug = 'amtali-main'
    and e.feature_key = any(array[
      'optional.live_chamber','optional.room_bed_runtime','optional.machines',
      'optional.gamification','optional.rewards','optional.finance_advanced',
      'optional.salary','optional.live_chat'
    ]::text[]);
  if v_entitlement_count <> 0 then
    raise exception 'I1_BASIC_PILOT_ENTITLEMENT_BASELINE_CHANGED:%', v_entitlement_count;
  end if;
end $$;

with tenant as (
  select o.id organization_id, c.id clinic_id
  from relife.organizations o
  join relife.clinics c on c.organization_id = o.id
  where o.slug = 'relife' and c.slug = 'amtali-main'
), keys(feature_key) as (values
  ('optional.live_chamber'),('optional.room_bed_runtime'),('optional.machines'),
  ('optional.gamification'),('optional.rewards'),('optional.finance_advanced'),
  ('optional.salary'),('optional.live_chat')
)
insert into relife.clinic_feature_flags(
  organization_id, clinic_id, feature_key, enabled, enabled_by, notes
)
select t.organization_id, t.clinic_id, k.feature_key, false,
       'controlled_canonicalization', 'i1-basic-pilot:2026-08-28'
from tenant t cross join keys k;

do $$
declare
  v_applied_count integer;
begin
  select count(*) into v_applied_count
  from relife.clinic_feature_flags f
  join relife.organizations o on o.id = f.organization_id
  join relife.clinics c on c.organization_id = o.id and c.id = f.clinic_id
  where o.slug = 'relife' and c.slug = 'amtali-main'
    and f.enabled = false
    and f.enabled_by = 'controlled_canonicalization'
    and f.notes = 'i1-basic-pilot:2026-08-28';
  if v_applied_count <> 8 then
    raise exception 'I1_BASIC_PILOT_APPLY_VERIFICATION_FAILED:%', v_applied_count;
  end if;
end $$;

commit;
