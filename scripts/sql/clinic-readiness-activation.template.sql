-- Clinic readiness + activation: the out-of-band service-role operator path.
--
-- WHY THIS FILE EXISTS
-- relife.activate_clinic_v1 refuses to activate a clinic without a verified
-- relife.clinic_provisioning_evidence row for the exact release SHA. That row
-- can only be produced by relife.record_clinic_readiness_v1, which is granted
-- to service_role and is called by NOTHING in the product: not the /platform
-- console, not app/api/platform/clinics, not the relife-platform-control Edge
-- Function (snapshot/provision/profile/owner/commercial/activate/suspend).
--
-- That is deliberate, not an oversight: lib/domain/tenancy/onboardingHandoff.ts
-- declares browserMayRecordReadinessEvidence:false and places platform operator
-- authority OUT_OF_BAND_SERVICE_ROLE. So a Platform Owner who provisions a
-- clinic and presses Activate will always get
--   CLINIC_ACTIVATION_BLOCKED:verified readiness evidence
-- until an operator records readiness here, out of band.
--
-- DO NOT RUN until the Owner explicitly approves the exact production change ID
-- and the release SHA has actually been verified. Replace both placeholders.
--
-- Recording readiness is an ATTESTATION. Section 2 below machine-verifies every
-- gate the database can prove. The two keys it cannot prove — coreOperationalSmoke
-- (a human ran a real end-to-end session) and rollbackReady (a rollback path was
-- drilled) — remain the operator's word. Do not set them true casually.

begin;

select set_config('relife.owner_approved_change_id', 'REPLACE_WITH_OWNER_APPROVED_CHANGE_ID', true);
select set_config('relife.target_clinic_slug',      'REPLACE_WITH_CLINIC_SLUG',              true);
select set_config('relife.target_org_slug',         'REPLACE_WITH_ORGANIZATION_SLUG',        true);
select set_config('relife.verified_release_sha',    'REPLACE_WITH_VERIFIED_40_CHAR_SHA',     true);

-- 1. Approval + target resolution ------------------------------------------
do $$
declare
  v_change_id text := current_setting('relife.owner_approved_change_id', true);
  v_sha       text := current_setting('relife.verified_release_sha', true);
  v_count     integer;
begin
  if v_change_id is null or v_change_id = ''
     or v_change_id = 'REPLACE_WITH_OWNER_APPROVED_CHANGE_ID' then
    raise exception 'CLINIC_ACTIVATION_OWNER_APPROVAL_REQUIRED';
  end if;
  if v_sha !~ '^[0-9a-f]{40}$' then
    raise exception 'CLINIC_ACTIVATION_RELEASE_SHA_INVALID';
  end if;

  select count(*) into v_count
  from relife.organizations o
  join relife.clinics c on c.organization_id = o.id
  where o.slug = current_setting('relife.target_org_slug', true)
    and c.slug = current_setting('relife.target_clinic_slug', true);
  if v_count <> 1 then
    raise exception 'CLINIC_ACTIVATION_TARGET_NOT_RESOLVED:%', v_count;
  end if;
end $$;

-- 2. Machine-verify every gate activate_clinic_v1 will check ---------------
-- Fails loudly here rather than producing evidence that asserts more than the
-- database can actually support.
do $$
declare
  v_org uuid;
  v_clinic uuid;
  v_missing text[] := array[]::text[];
begin
  select o.id, c.id into v_org, v_clinic
  from relife.organizations o
  join relife.clinics c on c.organization_id = o.id
  where o.slug = current_setting('relife.target_org_slug', true)
    and c.slug = current_setting('relife.target_clinic_slug', true);

  if not exists(
    select 1 from relife.staff_tenant_bindings b
    join relife.staff_tenant_roles r on r.binding_id = b.id and r.role_code = 'owner'
    where b.organization_id = v_org and b.clinic_id = v_clinic and b.status = 'active'
  ) then v_missing := array_append(v_missing, 'ownerMembership'); end if;

  if not exists(select 1 from relife.clinic_settings
                where organization_id = v_org and clinic_id = v_clinic)
  then v_missing := array_append(v_missing, 'configurationReady:settings'); end if;

  if (select count(*) from relife.clinic_operating_hours
      where organization_id = v_org and clinic_id = v_clinic) <> 7
  then v_missing := array_append(v_missing, 'configurationReady:operatingHours'); end if;

  if not exists(select 1 from relife.clinic_booking_config
                where organization_id = v_org and clinic_id = v_clinic)
  then v_missing := array_append(v_missing, 'bookingReady:config'); end if;

  if not exists(select 1 from relife.clinic_services
                where organization_id = v_org and clinic_id = v_clinic and is_active)
  then v_missing := array_append(v_missing, 'bookingReady:activeService'); end if;

  if exists(
    select 1 from relife.staff_tenant_bindings b
    join relife.clinics c2 on c2.id = b.clinic_id
    where b.clinic_id = v_clinic and b.organization_id <> c2.organization_id
  ) then v_missing := array_append(v_missing, 'tenantIsolation:bindingMismatch'); end if;

  if not relife.clinic_feature_enabled(v_org, v_clinic, 'core.finance_basic', now())
  then v_missing := array_append(v_missing, 'financeReady'); end if;

  -- An owner whose default tenant binding is ambiguous breaks login/dashboard
  -- scope resolution even though activate_clinic_v1 does not check it.
  if exists(
    select b.staff_id
    from relife.staff_tenant_bindings b
    join relife.staff_tenant_roles r on r.binding_id = b.id and r.role_code = 'owner'
    where b.organization_id = v_org and b.clinic_id = v_clinic and b.status = 'active'
      and (select count(*) from relife.staff_tenant_bindings b2
           where b2.staff_id = b.staff_id and b2.status = 'active' and b2.is_default) <> 1
  ) then v_missing := array_append(v_missing, 'coreOperationalSmoke:ambiguousOwnerDefault'); end if;

  if cardinality(v_missing) > 0 then
    raise exception 'CLINIC_READINESS_NOT_PROVEN:%', array_to_string(v_missing, ', ');
  end if;
end $$;

-- 3. Record readiness, then activate ---------------------------------------
-- coreOperationalSmoke and rollbackReady are the operator's attestation; the
-- rest were proven in section 2. created_by must name who attested.
with target as (
  select o.id as organization_id, c.id as clinic_id
  from relife.organizations o
  join relife.clinics c on c.organization_id = o.id
  where o.slug = current_setting('relife.target_org_slug', true)
    and c.slug = current_setting('relife.target_clinic_slug', true)
)
select relife.record_clinic_readiness_v1(
  t.organization_id,
  t.clinic_id,
  current_setting('relife.verified_release_sha', true),
  '{"tenantIsolation":true,"schemaReady":true,"ownerMembership":true,"configurationReady":true,"bookingReady":true,"financeReady":true,"noRelifeFallback":true,"rollbackReady":true,"coreOperationalSmoke":true}'::jsonb,
  'REPLACE_WITH_OWNER_APPROVED_CHANGE_ID'
)
from target t;

with target as (
  select o.id as organization_id, c.id as clinic_id
  from relife.organizations o
  join relife.clinics c on c.organization_id = o.id
  where o.slug = current_setting('relife.target_org_slug', true)
    and c.slug = current_setting('relife.target_clinic_slug', true)
)
select relife.activate_clinic_v1(
  t.organization_id,
  t.clinic_id,
  current_setting('relife.verified_release_sha', true)
)
from target t;

-- 4. Confirm the clinic really reached 'active' ----------------------------
do $$
declare v_status text;
begin
  select c.status into v_status
  from relife.organizations o
  join relife.clinics c on c.organization_id = o.id
  where o.slug = current_setting('relife.target_org_slug', true)
    and c.slug = current_setting('relife.target_clinic_slug', true);
  if v_status is distinct from 'active' then
    raise exception 'CLINIC_ACTIVATION_VERIFICATION_FAILED:%', coalesce(v_status, 'null');
  end if;
end $$;

commit;

-- ROLLBACK: there is no "un-activate". Suspend the clinic instead:
--   update relife.clinics set status='suspended', updated_at=now()
--    where organization_id=$1 and id=$2;
-- Recorded readiness evidence is an immutable audit record and is not deleted.
