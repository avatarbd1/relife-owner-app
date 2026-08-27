begin;

create or replace function relife.provision_clinic_v1(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = relife, pg_catalog
as $$
declare
  v_org_id uuid;
  v_clinic_id uuid;
  v_binding_id uuid;
  v_org_slug text := btrim(coalesce(p_payload #>> '{organization,slug}', ''));
  v_org_name text := btrim(coalesce(p_payload #>> '{organization,name}', ''));
  v_clinic_slug text := btrim(coalesce(p_payload #>> '{clinic,slug}', ''));
  v_clinic_name text := btrim(coalesce(p_payload #>> '{clinic,name}', ''));
  v_timezone text := btrim(coalesce(p_payload #>> '{clinic,timezone}', 'Asia/Dhaka'));
  v_staff_id text := btrim(coalesce(p_payload #>> '{owner,staffId}', ''));
  v_plan_code text := btrim(coalesce(nullif(p_payload #>> '{commercial,planCode}', ''), 'manual'));
  v_hours jsonb := coalesce(p_payload->'operatingHours', '[]'::jsonb);
  v_features jsonb := coalesce(p_payload->'features', '[]'::jsonb);
  v_services jsonb := coalesce(p_payload->'services', '[]'::jsonb);
  v_rooms jsonb := coalesce(p_payload->'rooms', '[]'::jsonb);
  v_resources jsonb := coalesce(p_payload->'resources', '[]'::jsonb);
  v_booking jsonb := coalesce(p_payload->'booking', '{}'::jsonb);
  r jsonb;
begin
  if v_org_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' or v_clinic_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    raise exception 'PROVISIONING_INVALID_SLUG';
  end if;
  if v_org_name = '' or v_clinic_name = '' or v_staff_id !~ '^[A-Za-z0-9_-]{2,64}$' then
    raise exception 'PROVISIONING_REQUIRED_FIELDS_MISSING';
  end if;
  if jsonb_typeof(v_hours) <> 'array'
     or jsonb_typeof(v_features) <> 'array'
     or jsonb_typeof(v_services) <> 'array'
     or jsonb_typeof(v_rooms) <> 'array'
     or jsonb_typeof(v_resources) <> 'array'
     or jsonb_typeof(v_booking) <> 'object' then
    raise exception 'PROVISIONING_INVALID_PAYLOAD_SHAPE';
  end if;
  if jsonb_array_length(v_hours) <> 7
     or (select count(distinct (x->>'dayOfWeek')::int) from jsonb_array_elements(v_hours) x) <> 7 then
    raise exception 'PROVISIONING_OPERATING_HOURS_INCOMPLETE';
  end if;
  if exists(
    select 1 from jsonb_array_elements(v_hours) x
    where coalesce((x->>'dayOfWeek')::int, 0) not between 1 and 7
  ) then
    raise exception 'PROVISIONING_OPERATING_HOURS_INVALID';
  end if;

  insert into relife.organizations(slug, name, status)
  values(v_org_slug, v_org_name, 'active')
  on conflict(slug) do nothing;
  select id into v_org_id from relife.organizations where slug = v_org_slug;
  if v_org_id is null then raise exception 'PROVISIONING_ORGANIZATION_UNAVAILABLE'; end if;

  insert into relife.clinics(organization_id, slug, name, timezone, status)
  values(v_org_id, v_clinic_slug, v_clinic_name, v_timezone, 'setup')
  on conflict(organization_id, slug) do update set
    name = excluded.name,
    timezone = excluded.timezone,
    updated_at = now();
  select id into v_clinic_id
  from relife.clinics
  where organization_id = v_org_id and slug = v_clinic_slug;
  if v_clinic_id is null then raise exception 'PROVISIONING_CLINIC_UNAVAILABLE'; end if;

  insert into relife.clinic_settings(
    organization_id, clinic_id, clinic_type, branch_name, address, phone, email,
    logo_url, currency, locale, updated_by
  ) values(
    v_org_id, v_clinic_id,
    coalesce(nullif(p_payload#>>'{clinic,type}', ''), 'other'),
    coalesce(p_payload#>>'{clinic,branchName}', ''),
    coalesce(p_payload#>>'{clinic,address}', ''),
    coalesce(p_payload#>>'{clinic,phone}', ''),
    coalesce(p_payload#>>'{clinic,email}', ''),
    coalesce(p_payload#>>'{clinic,logoUrl}', ''),
    coalesce(nullif(p_payload#>>'{clinic,currency}', ''), 'BDT'),
    coalesce(nullif(p_payload#>>'{clinic,locale}', ''), 'en'),
    'provision_clinic_v1'
  )
  on conflict(organization_id, clinic_id) do update set
    clinic_type = excluded.clinic_type,
    branch_name = excluded.branch_name,
    address = excluded.address,
    phone = excluded.phone,
    email = excluded.email,
    logo_url = excluded.logo_url,
    currency = excluded.currency,
    locale = excluded.locale,
    updated_by = excluded.updated_by,
    updated_at = now();

  for r in select value from jsonb_array_elements(v_hours) loop
    insert into relife.clinic_operating_hours(
      organization_id, clinic_id, day_of_week, is_open, opens_at, closes_at
    ) values(
      v_org_id, v_clinic_id, (r->>'dayOfWeek')::smallint,
      coalesce((r->>'isOpen')::boolean, false),
      case when coalesce((r->>'isOpen')::boolean, false) then (r->>'opensAt')::time else null end,
      case when coalesce((r->>'isOpen')::boolean, false) then (r->>'closesAt')::time else null end
    )
    on conflict(organization_id, clinic_id, day_of_week) do update set
      is_open = excluded.is_open,
      opens_at = excluded.opens_at,
      closes_at = excluded.closes_at,
      updated_at = now();
  end loop;

  insert into relife.staff_tenant_bindings(staff_id, organization_id, clinic_id, status, is_default)
  values(v_staff_id, v_org_id, v_clinic_id, 'active', false)
  on conflict(staff_id, organization_id, clinic_id) do update set
    status = 'active', updated_at = now()
  returning id into v_binding_id;
  if v_binding_id is null then
    select id into v_binding_id
    from relife.staff_tenant_bindings
    where staff_id = v_staff_id and organization_id = v_org_id and clinic_id = v_clinic_id;
  end if;
  insert into relife.staff_tenant_roles(binding_id, role_code)
  values(v_binding_id, 'owner')
  on conflict(binding_id, role_code) do nothing;
  insert into relife.staff_tenant_departments(binding_id, department_id)
  values(v_binding_id, 'All')
  on conflict(binding_id, department_id) do nothing;

  for r in select value from jsonb_array_elements(v_features) loop
    if jsonb_typeof(r) <> 'string' or btrim(r#>>'{}') = '' then
      raise exception 'PROVISIONING_INVALID_FEATURE';
    end if;
    if not exists(
      select 1 from relife.feature_catalog
      where feature_key = r#>>'{}' and status = 'active'
    ) then
      raise exception 'PROVISIONING_UNKNOWN_FEATURE:%', r#>>'{}';
    end if;
    insert into relife.clinic_feature_flags(
      organization_id, clinic_id, feature_key, enabled, enabled_by
    ) values(v_org_id, v_clinic_id, r#>>'{}', true, 'provision_clinic_v1')
    on conflict(organization_id, clinic_id, feature_key) do update set
      enabled = true, enabled_by = excluded.enabled_by, updated_at = now();
    insert into relife.clinic_entitlements(
      organization_id, clinic_id, feature_key, status, source, plan_code,
      grant_reason, granted_by
    ) values(
      v_org_id, v_clinic_id, r#>>'{}', 'active', 'manual', v_plan_code,
      'canonical provisioning', 'provision_clinic_v1'
    )
    on conflict(organization_id, clinic_id, feature_key) where status = 'active' do update set
      plan_code = excluded.plan_code,
      grant_reason = excluded.grant_reason,
      granted_by = excluded.granted_by,
      updated_at = now();
  end loop;

  for r in select value from jsonb_array_elements(v_rooms) loop
    if btrim(coalesce(r->>'roomCode', '')) = '' or btrim(coalesce(r->>'displayName', '')) = '' then
      raise exception 'PROVISIONING_INVALID_ROOM';
    end if;
    insert into relife.clinic_rooms(
      organization_id, clinic_id, room_code, display_name, is_active, sort_order, notes
    ) values(
      v_org_id, v_clinic_id,
      btrim(r->>'roomCode'), btrim(r->>'displayName'),
      coalesce((r->>'isActive')::boolean, true),
      coalesce((r->>'sortOrder')::int, 0),
      coalesce(r->>'notes', '')
    )
    on conflict(organization_id, clinic_id, room_code) do update set
      display_name = excluded.display_name,
      is_active = excluded.is_active,
      sort_order = excluded.sort_order,
      notes = excluded.notes,
      updated_at = now();
  end loop;

  for r in select value from jsonb_array_elements(v_resources) loop
    if btrim(coalesce(r->>'resourceCode', '')) = ''
       or btrim(coalesce(r->>'displayName', '')) = ''
       or btrim(coalesce(r->>'resourceType', '')) = '' then
      raise exception 'PROVISIONING_INVALID_RESOURCE';
    end if;
    insert into relife.clinic_resources(
      organization_id, clinic_id, resource_code, display_name, resource_type,
      room_code, capacity, gender_restriction, is_bookable, is_runtime_only,
      is_active, sort_order, notes
    ) values(
      v_org_id, v_clinic_id,
      btrim(r->>'resourceCode'), btrim(r->>'displayName'), btrim(r->>'resourceType'),
      nullif(btrim(coalesce(r->>'roomCode', '')), ''),
      coalesce((r->>'capacity')::int, 1),
      nullif(btrim(coalesce(r->>'genderRestriction', '')), ''),
      coalesce((r->>'isBookable')::boolean, false),
      coalesce((r->>'isRuntimeOnly')::boolean, false),
      coalesce((r->>'isActive')::boolean, true),
      coalesce((r->>'sortOrder')::int, 0),
      coalesce(r->>'notes', '')
    )
    on conflict(organization_id, clinic_id, resource_code) do update set
      display_name = excluded.display_name,
      resource_type = excluded.resource_type,
      room_code = excluded.room_code,
      capacity = excluded.capacity,
      gender_restriction = excluded.gender_restriction,
      is_bookable = excluded.is_bookable,
      is_runtime_only = excluded.is_runtime_only,
      is_active = excluded.is_active,
      sort_order = excluded.sort_order,
      notes = excluded.notes,
      updated_at = now();
  end loop;

  for r in select value from jsonb_array_elements(v_services) loop
    if btrim(coalesce(r->>'serviceCode', '')) = '' or btrim(coalesce(r->>'displayName', '')) = '' then
      raise exception 'PROVISIONING_INVALID_SERVICE';
    end if;
    insert into relife.clinic_services(
      organization_id, clinic_id, service_code, display_name, department, price,
      duration_min, requires_booking, requires_provider, requires_resource,
      discount_applicable, tax_applicable, package_eligible, is_active
    ) values(
      v_org_id, v_clinic_id,
      btrim(r->>'serviceCode'), btrim(r->>'displayName'),
      coalesce(nullif(r->>'department', ''), 'All'),
      coalesce((r->>'price')::numeric, 0),
      coalesce((r->>'durationMin')::int, 30),
      coalesce((r->>'requiresBooking')::boolean, true),
      coalesce((r->>'requiresProvider')::boolean, true),
      coalesce((r->>'requiresResource')::boolean, false),
      coalesce((r->>'discountApplicable')::boolean, true),
      coalesce((r->>'taxApplicable')::boolean, false),
      coalesce((r->>'packageEligible')::boolean, false),
      coalesce((r->>'isActive')::boolean, true)
    )
    on conflict(organization_id, clinic_id, service_code) do update set
      display_name = excluded.display_name,
      department = excluded.department,
      price = excluded.price,
      duration_min = excluded.duration_min,
      requires_booking = excluded.requires_booking,
      requires_provider = excluded.requires_provider,
      requires_resource = excluded.requires_resource,
      discount_applicable = excluded.discount_applicable,
      tax_applicable = excluded.tax_applicable,
      package_eligible = excluded.package_eligible,
      is_active = excluded.is_active,
      updated_at = now();
  end loop;

  insert into relife.clinic_booking_config(
    organization_id, clinic_id, booking_mode, default_duration_min, slot_interval_min,
    max_simultaneous, provider_required, resource_required,
    block_duplicate_patient_overlap, allow_walk_in, cancellation_notice_min,
    late_arrival_grace_min, capacity_rules
  ) values(
    v_org_id, v_clinic_id,
    coalesce(nullif(v_booking->>'mode', ''), 'simple'),
    coalesce((v_booking->>'defaultDurationMin')::int, 30),
    coalesce((v_booking->>'slotIntervalMin')::int, 30),
    case when v_booking ? 'maxSimultaneous' then (v_booking->>'maxSimultaneous')::int else null end,
    coalesce((v_booking->>'providerRequired')::boolean, true),
    coalesce((v_booking->>'resourceRequired')::boolean, false),
    coalesce((v_booking->>'blockDuplicatePatientOverlap')::boolean, true),
    coalesce((v_booking->>'allowWalkIn')::boolean, true),
    coalesce((v_booking->>'cancellationNoticeMin')::int, 0),
    coalesce((v_booking->>'lateArrivalGraceMin')::int, 0),
    coalesce(v_booking->'capacityRules', '{}'::jsonb)
  )
  on conflict(organization_id, clinic_id) do update set
    booking_mode = excluded.booking_mode,
    default_duration_min = excluded.default_duration_min,
    slot_interval_min = excluded.slot_interval_min,
    max_simultaneous = excluded.max_simultaneous,
    provider_required = excluded.provider_required,
    resource_required = excluded.resource_required,
    block_duplicate_patient_overlap = excluded.block_duplicate_patient_overlap,
    allow_walk_in = excluded.allow_walk_in,
    cancellation_notice_min = excluded.cancellation_notice_min,
    late_arrival_grace_min = excluded.late_arrival_grace_min,
    capacity_rules = excluded.capacity_rules,
    updated_at = now();

  return jsonb_build_object(
    'organizationId', v_org_id,
    'clinicId', v_clinic_id,
    'status', (select status from relife.clinics where id = v_clinic_id),
    'ownerStaffId', v_staff_id,
    'roomCount', jsonb_array_length(v_rooms),
    'resourceCount', jsonb_array_length(v_resources),
    'serviceCount', jsonb_array_length(v_services),
    'featureCount', jsonb_array_length(v_features),
    'planCode', v_plan_code
  );
end;
$$;

revoke all on function relife.provision_clinic_v1(jsonb) from public, anon, authenticated;
grant execute on function relife.provision_clinic_v1(jsonb) to service_role;

commit;
