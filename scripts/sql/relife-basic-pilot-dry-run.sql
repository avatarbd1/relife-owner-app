-- I-1 Relife Basic pilot: read-only production preflight.
-- This file contains SELECT/DO validation only and performs no writes.

begin transaction read only;

do $$
declare
  v_tenant_count integer;
  v_catalog_count integer;
  v_flag_count integer;
  v_entitlement_count integer;
begin
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
select t.organization_id, t.clinic_id, k.feature_key, false enabled,
       'controlled_canonicalization' enabled_by,
       'i1-basic-pilot:2026-08-28' notes
from tenant t cross join keys k
order by k.feature_key;

rollback;
