import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
if (!dbUrl) throw new Error("SUPABASE_DB_URL missing");
const sql = postgres(dbUrl, { prepare: false, max: 3, idle_timeout: 20 });

// Same server-to-server rotation hashes used by relife-tenant-context.
// Raw secrets remain only in trusted server environments.
const SERVER_KEY_HASHES = new Set([
  "efbaa7cde590048b656a566db1e0a8b09c8ad4d3b251c62116949de8eabf3027",
  "dc57fe48d7ab3b3f9bb93ac6b1559baf3c29dc71ffee728c2b9c45160c748281",
]);

const CORE_FEATURE_KEYS = [
  "core.dashboard",
  "core.patients",
  "core.appointments",
  "core.staff",
  "core.services",
  "core.finance_basic",
  "core.reports",
  "core.settings",
];
const PLAN_CODES = new Set(["starter", "standard", "premium"]);
const CLINIC_TYPES = new Set(["physiotherapy", "dental", "doctor_chamber", "other"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAFF_ID = /^[A-Za-z0-9_-]{2,64}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const SHA = /^[0-9a-f]{40}$/i;
type RecordAny = Record<string, unknown>;

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function bool(value: unknown): boolean {
  return value === true || String(value).toLowerCase() === "true";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function slugifyPlatformName(value: unknown): string {
  const base = text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  if (base.length >= 2) return base;
  if (base.length === 1) return `${base}-clinic`;
  return "clinic";
}

function suffixedSlug(base: string, serial: number): string {
  if (serial <= 1) return base;
  const suffix = `-${serial}`;
  const stem = base.slice(0, Math.max(2, 63 - suffix.length)).replace(/-+$/g, "");
  return `${stem}${suffix}`;
}

function clinicStaffCode(clinicName: string): string {
  const firstWord = text(clinicName).toUpperCase().match(/[A-Z0-9]+/)?.[0] || "CLINIC";
  if (firstWord.length <= 3) return firstWord.padEnd(3, "X");
  const consonants = firstWord.replace(/[AEIOU]/g, "");
  let code = consonants.slice(0, 3);
  if (code.length < 3) {
    for (const character of firstWord) {
      if (code.length >= 3) break;
      if (!code.includes(character)) code += character;
    }
  }
  return code.padEnd(3, "X").slice(0, 3);
}

function clinicTypeStaffCode(clinicType: string): string {
  if (clinicType === "physiotherapy") return "PT";
  if (clinicType === "dental") return "DT";
  if (clinicType === "doctor_chamber") return "DC";
  return "OT";
}

function generateOwnerStaffId(clinicName: string, clinicType: string): string {
  return `${clinicStaffCode(clinicName)}-${clinicTypeStaffCode(clinicType)}-001`;
}

function ownerStaffIdWithSerial(base: string, serial: number): string {
  const prefix = base.replace(/\d{3}$/, "");
  return `${prefix}${String(serial).padStart(3, "0")}`;
}

function templateForClinicType(clinicType: string) {
  if (clinicType === "physiotherapy") {
    return {
      serviceName: "Physiotherapy Consultation",
      serviceDepartment: "Physio",
      rooms: [
        {
          roomCode: "ROOM-01",
          displayName: "Treatment Room 1",
          isActive: true,
          sortOrder: 1,
          notes: "Editable starter template",
        },
      ],
      resources: [
        {
          resourceCode: "BED-01",
          displayName: "Treatment Bed 1",
          resourceType: "BED",
          roomCode: "ROOM-01",
          capacity: 1,
          genderRestriction: null,
          isBookable: false,
          isRuntimeOnly: true,
          isActive: true,
          sortOrder: 1,
          notes: "Editable starter template",
        },
      ],
      bookingMode: "simple",
      resourceRequired: false,
      maxSimultaneous: null,
    };
  }
  if (clinicType === "dental") {
    return {
      serviceName: "Dental Consultation",
      serviceDepartment: "Dental",
      rooms: [
        {
          roomCode: "ROOM-01",
          displayName: "Dental Room 1",
          isActive: true,
          sortOrder: 1,
          notes: "Editable starter template",
        },
      ],
      resources: [
        {
          resourceCode: "CHAIR-01",
          displayName: "Dental Chair 1",
          resourceType: "DENTAL_CHAIR",
          roomCode: "ROOM-01",
          capacity: 1,
          genderRestriction: null,
          isBookable: true,
          isRuntimeOnly: false,
          isActive: true,
          sortOrder: 1,
          notes: "Editable starter template",
        },
      ],
      bookingMode: "specific_resource",
      resourceRequired: true,
      maxSimultaneous: null,
    };
  }
  if (clinicType === "doctor_chamber") {
    return {
      serviceName: "Doctor Consultation",
      serviceDepartment: "All",
      rooms: [
        {
          roomCode: "ROOM-01",
          displayName: "Consultation Room 1",
          isActive: true,
          sortOrder: 1,
          notes: "Editable starter template",
        },
      ],
      resources: [],
      bookingMode: "simple",
      resourceRequired: false,
      maxSimultaneous: null,
    };
  }
  return {
    serviceName: "Consultation",
    serviceDepartment: "All",
    rooms: [],
    resources: [],
    bookingMode: "simple",
    resourceRequired: false,
    maxSimultaneous: null,
  };
}

function scopeFrom(body: RecordAny) {
  const organizationId = text(body.organizationId).toLowerCase();
  const clinicId = text(body.clinicId).toLowerCase();
  if (!UUID.test(organizationId) || !UUID.test(clinicId)) {
    throw new Error("TENANT_SCOPE_REQUIRED");
  }
  return { organizationId, clinicId };
}

async function authorized(request: Request): Promise<boolean> {
  const key = request.headers.get("x-relife-lock-key")?.trim() || "";
  if (!key) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hex = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return SERVER_KEY_HASHES.has(hex);
}

async function uniqueOrganizationSlug(base: string): Promise<string> {
  for (let serial = 1; serial <= 999; serial += 1) {
    const candidate = suffixedSlug(base, serial);
    const rows = await sql`select 1 from relife.organizations where slug=${candidate} limit 1`;
    if (!rows[0]) return candidate;
  }
  throw new Error("PLATFORM_ORGANIZATION_SLUG_EXHAUSTED");
}

async function uniqueClinicSlug(organizationSlug: string, base: string): Promise<string> {
  const organizations = await sql`select id::text as id from relife.organizations where slug=${organizationSlug} limit 1`;
  const organizationId = text(organizations[0]?.id);
  if (!organizationId) return base;
  for (let serial = 1; serial <= 999; serial += 1) {
    const candidate = suffixedSlug(base, serial);
    const rows = await sql`select 1 from relife.clinics where organization_id=${organizationId}::uuid and slug=${candidate} limit 1`;
    if (!rows[0]) return candidate;
  }
  throw new Error("PLATFORM_CLINIC_SLUG_EXHAUSTED");
}

async function uniqueOwnerStaffId(base: string): Promise<string> {
  const prefix = base.replace(/\d{3}$/, "");
  const rows = await sql`select distinct staff_id from relife.staff_tenant_bindings where staff_id like ${`${prefix}%`}`;
  const used = new Set(
    rows
      .map((row) => text(row.staff_id))
      .filter((staffId) => staffId.startsWith(prefix) && /^\d{3}$/.test(staffId.slice(prefix.length)))
      .map((staffId) => Number(staffId.slice(prefix.length))),
  );
  for (let serial = 1; serial <= 999; serial += 1) {
    if (!used.has(serial)) return ownerStaffIdWithSerial(base, serial);
  }
  throw new Error("PLATFORM_OWNER_STAFF_ID_EXHAUSTED");
}

async function snapshot() {
  const clinicRows = await sql`
    select c.organization_id::text as organization_id,o.name as organization_name,o.slug as organization_slug,
      c.id::text as clinic_id,c.name as clinic_name,c.slug as clinic_slug,c.status as clinic_status,c.timezone,s.clinic_type,
      coalesce((select jsonb_agg(distinct b.staff_id order by b.staff_id) from relife.staff_tenant_bindings b join relife.staff_tenant_roles r on r.binding_id=b.id and r.role_code='owner' where b.organization_id=c.organization_id and b.clinic_id=c.id and b.status='active'),'[]'::jsonb) as owner_staff_ids,
      coalesce((select jsonb_agg(f.feature_key order by f.feature_key) from relife.clinic_feature_flags f where f.organization_id=c.organization_id and f.clinic_id=c.id and f.enabled=true),'[]'::jsonb) as enabled_features,
      (select e.plan_code from relife.clinic_entitlements e where e.organization_id=c.organization_id and e.clinic_id=c.id and e.status='active' order by e.created_at desc limit 1) as plan_code,
      (select e.effective_until from relife.clinic_entitlements e where e.organization_id=c.organization_id and e.clinic_id=c.id and e.status='active' order by e.created_at desc limit 1) as trial_ends_at,
      (select p.release_sha from relife.clinic_provisioning_evidence p where p.organization_id=c.organization_id and p.clinic_id=c.id and p.status='verified' order by p.created_at desc limit 1) as verified_release_sha,
      (select count(*)::int from relife.clinic_operating_hours h where h.organization_id=c.organization_id and h.clinic_id=c.id) as hours_count,
      exists(select 1 from relife.clinic_services sv where sv.organization_id=c.organization_id and sv.clinic_id=c.id and sv.is_active=true) as has_active_service,
      exists(select 1 from relife.clinic_booking_config bc where bc.organization_id=c.organization_id and bc.clinic_id=c.id) as has_booking,
      exists(select 1 from relife.clinic_feature_flags f join relife.clinic_entitlements e on e.organization_id=f.organization_id and e.clinic_id=f.clinic_id and e.feature_key=f.feature_key and e.status='active' where f.organization_id=c.organization_id and f.clinic_id=c.id and f.feature_key='core.finance_basic' and f.enabled=true) as finance_enabled
    from relife.clinics c join relife.organizations o on o.id=c.organization_id
    left join relife.clinic_settings s on s.organization_id=c.organization_id and s.clinic_id=c.id order by o.name,c.name`;
  const catalog = await sql`select feature_key,label,module_group,domain from relife.feature_catalog where status='active' order by module_group,feature_key`;
  const clinics = clinicRows.map((row) => {
    const missing: string[] = [];
    if (!text(row.clinic_type)) missing.push("clinic profile");
    if (Number(row.hours_count || 0) !== 7) missing.push("7-day operating hours");
    if (!bool(row.has_active_service)) missing.push("active service");
    if (!bool(row.has_booking)) missing.push("booking configuration");
    const owners = Array.isArray(row.owner_staff_ids) ? row.owner_staff_ids.map(text).filter(Boolean) : [];
    if (owners.length === 0) missing.push("owner assignment");
    if (!bool(row.finance_enabled)) missing.push("core finance entitlement");
    const clinicStatus = text(row.clinic_status);
    const readinessStatus = clinicStatus === "active"
      ? "ACTIVE"
      : clinicStatus === "suspended"
        ? "SUSPENDED"
        : missing.length === 0
          ? "READY_FOR_VERIFICATION"
          : "SETUP_REQUIRED";
    return {
      organizationId: text(row.organization_id),
      clinicId: text(row.clinic_id),
      organizationName: text(row.organization_name),
      organizationSlug: text(row.organization_slug),
      clinicName: text(row.clinic_name),
      clinicSlug: text(row.clinic_slug),
      clinicStatus,
      timezone: text(row.timezone),
      clinicType: text(row.clinic_type) || null,
      ownerStaffIds: owners,
      enabledFeatures: Array.isArray(row.enabled_features) ? row.enabled_features.map(text).filter(Boolean) : [],
      planCode: text(row.plan_code) || null,
      trialEndsAt: row.trial_ends_at ? new Date(String(row.trial_ends_at)).toISOString() : null,
      verifiedReleaseSha: text(row.verified_release_sha) || null,
      readinessStatus,
      missingReadiness: missing,
    };
  });
  return {
    clinics,
    featureCatalog: catalog.map((row) => ({
      featureKey: text(row.feature_key),
      label: text(row.label),
      moduleGroup: text(row.module_group),
      domain: text(row.domain),
    })),
  };
}

function normalizeProvisionInput(raw: RecordAny, actorStaffId: string) {
  const clinicName = text(raw.clinicName);
  const clinicType = text(raw.clinicType || "other");
  if (!clinicName) throw new Error("PLATFORM_CLINIC_NAME_REQUIRED");
  if (!CLINIC_TYPES.has(clinicType)) throw new Error("PLATFORM_CLINIC_TYPE_INVALID");
  const template = templateForClinicType(clinicType);
  const organizationName = text(raw.organizationName) || clinicName;
  const organizationSlug = slugifyPlatformName(text(raw.organizationSlug) || organizationName);
  const clinicSlug = slugifyPlatformName(text(raw.clinicSlug) || clinicName);
  const ownerStaffId = text(raw.ownerStaffId) || generateOwnerStaffId(clinicName, clinicType);
  const planCode = PLAN_CODES.has(text(raw.planCode)) ? text(raw.planCode) : "starter";
  const timezone = text(raw.timezone || "Asia/Dhaka");
  const trialDays = Number(raw.trialDays ?? 30);
  if (!SLUG.test(organizationSlug) || !SLUG.test(clinicSlug)) {
    throw new Error("PLATFORM_CLINIC_SLUG_INVALID");
  }
  if (!STAFF_ID.test(ownerStaffId)) throw new Error("PLATFORM_OWNER_STAFF_ID_INVALID");
  if (ownerStaffId === actorStaffId) throw new Error("PLATFORM_OWNER_CANNOT_BE_CLINIC_OWNER");
  if (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > 90) {
    throw new Error("PLATFORM_TRIAL_DAYS_INVALID");
  }
  const opensAt = text(raw.opensAt || "09:00");
  const closesAt = text(raw.closesAt || "18:00");
  if (!TIME.test(opensAt) || !TIME.test(closesAt) || opensAt >= closesAt) {
    throw new Error("PLATFORM_HOURS_INVALID");
  }
  const openDays = [
    ...new Set(
      (Array.isArray(raw.openDays) && raw.openDays.length ? raw.openDays : [1, 2, 3, 4, 5, 6])
        .map(Number),
    ),
  ].sort((a, b) => a - b);
  if (openDays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
    throw new Error("PLATFORM_OPEN_DAYS_INVALID");
  }
  const featureKeys = [...new Set([...CORE_FEATURE_KEYS, ...asStringArray(raw.featureKeys)])];
  const firstServiceName = text(raw.firstServiceName) || template.serviceName;
  const firstServiceCode = text(raw.firstServiceCode)
    || firstServiceName.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48)
    || "SERVICE_1";
  const firstServicePrice = Number(raw.firstServicePrice ?? 0);
  const firstServiceDurationMin = Number(raw.firstServiceDurationMin ?? 30);
  if (!Number.isFinite(firstServicePrice) || firstServicePrice < 0) {
    throw new Error("PLATFORM_SERVICE_PRICE_INVALID");
  }
  if (!Number.isInteger(firstServiceDurationMin) || firstServiceDurationMin < 5 || firstServiceDurationMin > 480) {
    throw new Error("PLATFORM_SERVICE_DURATION_INVALID");
  }
  return {
    organizationName,
    organizationSlug,
    clinicName,
    clinicSlug,
    ownerStaffId,
    planCode,
    trialDays,
    timezone,
    clinicType,
    template,
    branchName: text(raw.branchName) || clinicName,
    address: text(raw.address),
    phone: text(raw.phone),
    email: text(raw.email),
    currency: text(raw.currency || "BDT") || "BDT",
    locale: text(raw.locale || "en") || "en",
    featureKeys,
    openDays,
    opensAt,
    closesAt,
    firstServiceName,
    firstServiceCode,
    firstServicePrice,
    firstServiceDurationMin,
  };
}

async function setCommercial(
  organizationId: string,
  clinicId: string,
  planCode: string,
  trialDays: number,
  requestedFeatures: string[],
  actorStaffId: string,
) {
  if (!PLAN_CODES.has(planCode)) throw new Error("PLATFORM_PLAN_INVALID");
  if (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > 90) {
    throw new Error("PLATFORM_TRIAL_DAYS_INVALID");
  }
  const catalogRows = await sql`select feature_key from relife.feature_catalog where status='active' order by feature_key`;
  const known = catalogRows.map((row) => text(row.feature_key));
  const knownSet = new Set(known);
  const selected = [...new Set([...CORE_FEATURE_KEYS, ...requestedFeatures.map(text).filter(Boolean)])];
  if (selected.some((key) => !knownSet.has(key))) throw new Error("PLATFORM_FEATURE_UNKNOWN");
  const expiresAt = new Date(Date.now() + trialDays * 86400000).toISOString();
  await sql.begin(async (tx) => {
    for (const featureKey of known) {
      const enabled = selected.includes(featureKey);
      await tx`insert into relife.clinic_feature_flags(organization_id,clinic_id,feature_key,enabled,enabled_by,notes) values(${organizationId}::uuid,${clinicId}::uuid,${featureKey},${enabled},${`platform:${actorStaffId}`},${enabled ? `${planCode} trial selected` : `${planCode} trial not selected`}) on conflict(organization_id,clinic_id,feature_key) do update set enabled=excluded.enabled,enabled_by=excluded.enabled_by,notes=excluded.notes,updated_at=now()`;
    }
    await tx`update relife.clinic_entitlements set status='revoked',updated_at=now() where organization_id=${organizationId}::uuid and clinic_id=${clinicId}::uuid and status='active' and not (feature_key = any(${selected}::text[]))`;
    for (const featureKey of selected) {
      await tx`insert into relife.clinic_entitlements(organization_id,clinic_id,feature_key,status,effective_from,effective_until,source,plan_code,grant_reason,granted_by) values(${organizationId}::uuid,${clinicId}::uuid,${featureKey},'active',now(),${expiresAt}::timestamptz,'trial',${planCode},'Platform Owner trial assignment',${`platform:${actorStaffId}`}) on conflict(organization_id,clinic_id,feature_key) where status='active' do update set source='trial',plan_code=excluded.plan_code,effective_until=excluded.effective_until,grant_reason=excluded.grant_reason,granted_by=excluded.granted_by,updated_at=now()`;
    }
  });
}

async function provision(inputRaw: RecordAny, actorStaffId: string) {
  const requestedOrganizationSlug = text(inputRaw.organizationSlug);
  const requestedClinicSlug = text(inputRaw.clinicSlug);
  const requestedOwnerStaffId = text(inputRaw.ownerStaffId);
  const input = normalizeProvisionInput(inputRaw, actorStaffId);

  if (!requestedOrganizationSlug) {
    input.organizationSlug = await uniqueOrganizationSlug(input.organizationSlug);
  }
  if (!requestedClinicSlug) {
    input.clinicSlug = await uniqueClinicSlug(input.organizationSlug, input.clinicSlug);
  }
  if (!requestedOwnerStaffId) {
    input.ownerStaffId = await uniqueOwnerStaffId(input.ownerStaffId);
  }

  if (input.ownerStaffId === actorStaffId) {
    throw new Error("PLATFORM_OWNER_CANNOT_BE_CLINIC_OWNER");
  }

  const existing = await sql`select c.status from relife.organizations o join relife.clinics c on c.organization_id=o.id where o.slug=${input.organizationSlug} and c.slug=${input.clinicSlug} limit 1`;
  if (existing[0] && text(existing[0].status) !== "archived") {
    throw new Error("PLATFORM_CLINIC_ALREADY_MANAGED");
  }

  const open = new Set(input.openDays);
  const payload = {
    organization: { slug: input.organizationSlug, name: input.organizationName },
    clinic: {
      slug: input.clinicSlug,
      name: input.clinicName,
      type: input.clinicType,
      timezone: input.timezone,
      branchName: input.branchName,
      address: input.address,
      phone: input.phone,
      email: input.email,
      currency: input.currency,
      locale: input.locale,
    },
    owner: { staffId: input.ownerStaffId },
    commercial: { planCode: input.planCode },
    operatingHours: Array.from({ length: 7 }, (_, index) => {
      const dayOfWeek = index + 1;
      const isOpen = open.has(dayOfWeek);
      return {
        dayOfWeek,
        isOpen,
        opensAt: isOpen ? input.opensAt : null,
        closesAt: isOpen ? input.closesAt : null,
      };
    }),
    features: input.featureKeys,
    services: [
      {
        serviceCode: input.firstServiceCode,
        displayName: input.firstServiceName,
        department: input.template.serviceDepartment,
        price: input.firstServicePrice,
        durationMin: input.firstServiceDurationMin,
        requiresBooking: true,
        requiresProvider: true,
        requiresResource: input.template.resourceRequired,
        discountApplicable: true,
        taxApplicable: false,
        packageEligible: false,
        isActive: true,
      },
    ],
    rooms: input.template.rooms,
    resources: input.template.resources,
    booking: {
      mode: input.template.bookingMode,
      defaultDurationMin: input.firstServiceDurationMin,
      slotIntervalMin: input.firstServiceDurationMin,
      maxSimultaneous: input.template.maxSimultaneous,
      providerRequired: true,
      resourceRequired: input.template.resourceRequired,
      blockDuplicatePatientOverlap: true,
      allowWalkIn: true,
      cancellationNoticeMin: 0,
      lateArrivalGraceMin: 0,
      capacityRules: {},
    },
  };

  // sql.json preserves the nested payload as JSON; the explicit cast only fixes
  // PostgreSQL function overload/type resolution and does not stringify it twice.
  const rows = await sql`select relife.provision_clinic_v1(${sql.json(payload)}::jsonb) as result`;
  const result = (rows[0]?.result || {}) as RecordAny;
  const organizationId = text(result.organizationId);
  const clinicId = text(result.clinicId);
  if (!UUID.test(organizationId) || !UUID.test(clinicId)) {
    throw new Error("PLATFORM_PROVISION_FAILED");
  }
  await setCommercial(
    organizationId,
    clinicId,
    input.planCode,
    input.trialDays,
    input.featureKeys,
    actorStaffId,
  );
  return {
    organizationId,
    clinicId,
    organizationSlug: input.organizationSlug,
    clinicSlug: input.clinicSlug,
    ownerStaffId: input.ownerStaffId,
  };
}

async function patchProfile(body: RecordAny, actorStaffId: string) {
  const { organizationId, clinicId } = scopeFrom(body);
  const patch = (
    body.profile && typeof body.profile === "object" && !Array.isArray(body.profile)
      ? body.profile
      : {}
  ) as RecordAny;
  const current = await sql`select c.name as clinic_name,c.timezone,s.clinic_type,s.branch_name,s.address,s.phone,s.email,s.logo_url,s.currency,s.locale from relife.clinics c left join relife.clinic_settings s on s.organization_id=c.organization_id and s.clinic_id=c.id where c.organization_id=${organizationId}::uuid and c.id=${clinicId}::uuid limit 1`;
  if (!current[0] || !text(current[0].clinic_type)) {
    throw new Error("PLATFORM_CLINIC_PROFILE_NOT_FOUND");
  }
  const row = current[0];
  const clinicName = text(patch.clinicName) || text(row.clinic_name);
  const clinicType = text(patch.clinicType) || text(row.clinic_type);
  if (!clinicName) throw new Error("PLATFORM_CLINIC_NAME_REQUIRED");
  if (!CLINIC_TYPES.has(clinicType)) throw new Error("PLATFORM_CLINIC_TYPE_INVALID");
  const branchName = text(patch.branchName) || text(row.branch_name) || clinicName;
  const timezone = text(patch.timezone) || text(row.timezone) || "Asia/Dhaka";
  await sql.begin(async (tx) => {
    await tx`update relife.clinics set name=${clinicName},timezone=${timezone},updated_at=now() where organization_id=${organizationId}::uuid and id=${clinicId}::uuid`;
    await tx`insert into relife.clinic_settings(organization_id,clinic_id,clinic_type,branch_name,address,phone,email,logo_url,currency,locale,updated_by) values(${organizationId}::uuid,${clinicId}::uuid,${clinicType},${branchName},${text(patch.address) || text(row.address)},${text(patch.phone) || text(row.phone)},${text(patch.email) || text(row.email)},${text(patch.logoUrl) || text(row.logo_url)},${text(patch.currency) || text(row.currency) || "BDT"},${text(patch.locale) || text(row.locale) || "en"},${`platform:${actorStaffId}`}) on conflict(organization_id,clinic_id) do update set clinic_type=excluded.clinic_type,branch_name=excluded.branch_name,address=excluded.address,phone=excluded.phone,email=excluded.email,logo_url=excluded.logo_url,currency=excluded.currency,locale=excluded.locale,updated_by=excluded.updated_by,updated_at=now()`;
  });
}

async function assignOwner(body: RecordAny, actorStaffId: string) {
  const { organizationId, clinicId } = scopeFrom(body);
  const ownerStaffId = text(body.ownerStaffId);
  if (!STAFF_ID.test(ownerStaffId)) throw new Error("PLATFORM_OWNER_STAFF_ID_INVALID");
  if (ownerStaffId === actorStaffId) throw new Error("PLATFORM_OWNER_CANNOT_BE_CLINIC_OWNER");
  await sql.begin(async (tx) => {
    const rows = await tx`insert into relife.staff_tenant_bindings(staff_id,organization_id,clinic_id,status,is_default,updated_at) values(${ownerStaffId},${organizationId}::uuid,${clinicId}::uuid,'active',false,now()) on conflict(staff_id,organization_id,clinic_id) do update set status='active',is_default=false,updated_at=now() returning id::text as id`;
    const bindingId = text(rows[0]?.id);
    if (!UUID.test(bindingId)) throw new Error("PLATFORM_OWNER_BINDING_FAILED");
    await tx`delete from relife.staff_tenant_roles where binding_id=${bindingId}::uuid`;
    await tx`delete from relife.staff_tenant_departments where binding_id=${bindingId}::uuid`;
    await tx`insert into relife.staff_tenant_roles(binding_id,role_code) values(${bindingId}::uuid,'owner')`;
    await tx`insert into relife.staff_tenant_departments(binding_id,department_id) values(${bindingId}::uuid,'All')`;
  });
}

async function activate(body: RecordAny) {
  const { organizationId, clinicId } = scopeFrom(body);
  const releaseSha = text(body.releaseSha).toLowerCase();
  if (!SHA.test(releaseSha)) throw new Error("PLATFORM_RELEASE_SHA_INVALID");
  await sql`select relife.activate_clinic_v1(${organizationId}::uuid,${clinicId}::uuid,${releaseSha})`;
}

async function suspend(body: RecordAny) {
  const { organizationId, clinicId } = scopeFrom(body);
  const rows = await sql`update relife.clinics set status='suspended',updated_at=now() where organization_id=${organizationId}::uuid and id=${clinicId}::uuid returning id`;
  if (!rows[0]) throw new Error("PLATFORM_CLINIC_NOT_FOUND");
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }
  if (!(await authorized(request))) {
    return response({ ok: false, error: "ACCESS_DENIED" }, 401);
  }
  try {
    const body = (await request.json().catch(() => ({}))) as RecordAny;
    const action = text(body.action || "snapshot");
    const actorStaffId = text(body.actorStaffId);
    if (!STAFF_ID.test(actorStaffId)) throw new Error("PLATFORM_ACTOR_INVALID");

    if (action === "snapshot") {
      return response({ ok: true, snapshot: await snapshot() });
    }
    if (action === "provision") {
      const input = (
        body.input && typeof body.input === "object" && !Array.isArray(body.input)
          ? body.input
          : {}
      ) as RecordAny;
      const scope = await provision(input, actorStaffId);
      return response({ ok: true, scope, snapshot: await snapshot() });
    }
    if (action === "profile") await patchProfile(body, actorStaffId);
    else if (action === "owner") await assignOwner(body, actorStaffId);
    else if (action === "commercial") {
      const { organizationId, clinicId } = scopeFrom(body);
      await setCommercial(
        organizationId,
        clinicId,
        text(body.planCode),
        Number(body.trialDays || 30),
        asStringArray(body.featureKeys),
        actorStaffId,
      );
    } else if (action === "activate") await activate(body);
    else if (action === "suspend") await suspend(body);
    else throw new Error("PLATFORM_ACTION_INVALID");

    return response({ ok: true, snapshot: await snapshot() });
  } catch (error) {
    console.error("relife-platform-control", error);
    const message = error instanceof Error ? error.message : "PLATFORM_OPERATION_FAILED";
    const status = /ACCESS_DENIED|NOT_AUTHORIZED/.test(message)
      ? 403
      : /ALREADY_MANAGED/.test(message)
        ? 409
        : /INVALID|REQUIRED|UNKNOWN|SLUG|TRIAL|FEATURE|SHA|CANNOT_BE|EXHAUSTED/.test(message)
          ? 400
          : /NOT_FOUND/.test(message)
            ? 404
            : 500;
    return response({ ok: false, error: message }, status);
  }
});