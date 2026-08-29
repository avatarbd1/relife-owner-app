import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/data/supabaseAdmin";
import type { TenantScope } from "@/lib/domain/tenancy/policy";
import { requireTenantScope } from "@/lib/domain/tenancy/policy";
import type { ClinicBookingConfig, ClinicResource } from "@/lib/domain/tenancy/clinicConfiguration";
import { resolveOperationalStore } from "@/lib/domain/tenancy/operationalStore";
import type { ClinicConfigurationSnapshot, ClinicProfileConfiguration, ClinicRoomConfiguration, ClinicServiceConfiguration, OperatingHourConfiguration } from "@/lib/domain/tenancy/configurationCore";

function adminClient(): SupabaseClient {
  try {
    return createSupabaseAdminClient();
  } catch {
    throw new Error("CONFIGURATION_STORE_UNAVAILABLE");
  }
}

function dbScope(scope: TenantScope) {
  const tenant = requireTenantScope(scope);
  return { organization_id: tenant.organizationId, clinic_id: tenant.clinicId };
}

function ensure(error: { message?: string } | null, operation: string): void {
  if (error) throw new Error(`CONFIGURATION_${operation}_FAILED:${error.message || "unknown"}`);
}

/**
 * Targeted read of the clinic's operational-store routing switch.
 *
 * Every tenant-owned read and write consults this, so it deliberately does not
 * go through `readClinicConfiguration`, which fans out ten queries to assemble
 * a full snapshot nobody needs here.
 */
export async function readOperationalStore(scope: TenantScope, client = adminClient()): Promise<unknown> {
  const tenant = requireTenantScope(scope);
  const result = await client
    .schema("relife")
    .from("clinic_settings")
    .select("operational_store")
    .match(dbScope(tenant))
    .maybeSingle();
  ensure(result.error, "OPERATIONAL_STORE_READ");
  return (result.data as { operational_store?: unknown } | null)?.operational_store;
}

export async function readClinicConfiguration(scope: TenantScope, client = adminClient()): Promise<ClinicConfigurationSnapshot> {
  const tenant = requireTenantScope(scope);
  const relife = client.schema("relife");
  const scoped = dbScope(tenant);
  const [clinic, settings, hours, catalog, flags, grants, services, rooms, resources, booking] = await Promise.all([
    relife.from("clinics").select("id,name,timezone,status").eq("organization_id", scoped.organization_id).eq("id", scoped.clinic_id).maybeSingle(),
    relife.from("clinic_settings").select("*").match(scoped).maybeSingle(),
    relife.from("clinic_operating_hours").select("*").match(scoped).order("day_of_week"),
    relife.from("feature_catalog").select("feature_key,status"),
    relife.from("clinic_feature_flags").select("feature_key,enabled,organization_id,clinic_id").match(scoped),
    relife.from("clinic_entitlements").select("feature_key,status,effective_from,effective_until,organization_id,clinic_id").match(scoped),
    relife.from("clinic_services").select("*").match(scoped).order("display_name"),
    relife.from("clinic_rooms").select("*").match(scoped).order("sort_order"),
    relife.from("clinic_resources").select("*").match(scoped).order("sort_order"),
    relife.from("clinic_booking_config").select("*").match(scoped).maybeSingle(),
  ]);
  for (const [result, name] of [[clinic,"CLINIC_READ"],[settings,"SETTINGS_READ"],[hours,"HOURS_READ"],[catalog,"CATALOG_READ"],[flags,"FLAGS_READ"],[grants,"ENTITLEMENTS_READ"],[services,"SERVICES_READ"],[rooms,"ROOMS_READ"],[resources,"RESOURCES_READ"],[booking,"BOOKING_READ"]] as const) ensure(result.error, name);
  const c = clinic.data as Record<string, unknown> | null;
  const s = settings.data as Record<string, unknown> | null;
  const profile: ClinicProfileConfiguration | null = c && s ? {
    ...tenant, clinicName: String(c.name || ""), clinicType: s.clinic_type as ClinicProfileConfiguration["clinicType"], operationalStore: resolveOperationalStore(s.operational_store), branchName: String(s.branch_name || ""), address: String(s.address || ""), phone: String(s.phone || ""), email: String(s.email || ""), logoUrl: String(s.logo_url || ""), currency: String(s.currency || ""), locale: String(s.locale || ""), timezone: String(c.timezone || ""), lifecycle: String(c.status || ""),
  } : null;
  return {
    scope: tenant,
    profile,
    operatingHours: ((hours.data || []) as Record<string, unknown>[]).map((r): OperatingHourConfiguration => ({ ...tenant, dayOfWeek: Number(r.day_of_week), isOpen: Boolean(r.is_open), opensAt: r.opens_at ? String(r.opens_at) : null, closesAt: r.closes_at ? String(r.closes_at) : null })),
    catalog: ((catalog.data || []) as Record<string, unknown>[]).map((r) => ({ featureKey: String(r.feature_key), status: r.status as "active" | "retired" })),
    flags: ((flags.data || []) as Record<string, unknown>[]).map((r) => ({ ...tenant, featureKey: String(r.feature_key), enabled: Boolean(r.enabled) })),
    entitlements: ((grants.data || []) as Record<string, unknown>[]).map((r) => ({ ...tenant, featureKey: String(r.feature_key), status: r.status as "active" | "suspended" | "revoked", effectiveFrom: new Date(String(r.effective_from)), effectiveUntil: r.effective_until ? new Date(String(r.effective_until)) : null })),
    services: ((services.data || []) as Record<string, unknown>[]).map((r): ClinicServiceConfiguration => ({ ...tenant, serviceCode: String(r.service_code), displayName: String(r.display_name), department: r.department as ClinicServiceConfiguration["department"], price: Number(r.price), durationMin: Number(r.duration_min), requiresBooking: Boolean(r.requires_booking), requiresProvider: Boolean(r.requires_provider), requiresResource: Boolean(r.requires_resource), discountApplicable: Boolean(r.discount_applicable), taxApplicable: Boolean(r.tax_applicable), packageEligible: Boolean(r.package_eligible), isActive: Boolean(r.is_active) })),
    rooms: ((rooms.data || []) as Record<string, unknown>[]).map((r): ClinicRoomConfiguration => ({ ...tenant, roomCode: String(r.room_code), displayName: String(r.display_name), isActive: Boolean(r.is_active), sortOrder: Number(r.sort_order) })),
    resources: ((resources.data || []) as Record<string, unknown>[]).map((r): ClinicResource => ({ ...tenant, resourceCode: String(r.resource_code), displayName: String(r.display_name), resourceType: r.resource_type as ClinicResource["resourceType"], roomCode: r.room_code ? String(r.room_code) : null, capacity: Number(r.capacity), genderRestriction: (r.gender_restriction || null) as ClinicResource["genderRestriction"], isBookable: Boolean(r.is_bookable), isRuntimeOnly: Boolean(r.is_runtime_only), isActive: Boolean(r.is_active) })),
    booking: booking.data ? mapBooking(tenant, booking.data as Record<string, unknown>) : null,
  };
}

function mapBooking(scope: TenantScope, r: Record<string, unknown>): ClinicBookingConfig {
  return { ...scope, bookingMode: r.booking_mode as ClinicBookingConfig["bookingMode"], defaultDurationMin: Number(r.default_duration_min), slotIntervalMin: Number(r.slot_interval_min), maxSimultaneous: r.max_simultaneous === null ? null : Number(r.max_simultaneous), providerRequired: Boolean(r.provider_required), resourceRequired: Boolean(r.resource_required), blockDuplicatePatientOverlap: Boolean(r.block_duplicate_patient_overlap), allowWalkIn: Boolean(r.allow_walk_in), cancellationNoticeMin: Number(r.cancellation_notice_min), lateArrivalGraceMin: Number(r.late_arrival_grace_min), capacityRules: (r.capacity_rules && typeof r.capacity_rules === "object" ? r.capacity_rules : {}) as Record<string, unknown> };
}

export async function writeFacilityConfiguration(scope: TenantScope, input: { rooms: Omit<ClinicRoomConfiguration, keyof TenantScope>[]; resources: Omit<ClinicResource, keyof TenantScope>[]; booking: Omit<ClinicBookingConfig, keyof TenantScope> }, client = adminClient()) {
  const tenant = requireTenantScope(scope); const scoped = dbScope(tenant); const relife = client.schema("relife");
  const roomRows = input.rooms.map((r) => ({ ...scoped, room_code: r.roomCode, display_name: r.displayName, is_active: r.isActive, sort_order: r.sortOrder }));
  if (roomRows.length) ensure((await relife.from("clinic_rooms").upsert(roomRows, { onConflict: "organization_id,clinic_id,room_code" })).error, "ROOMS_WRITE");
  const resourceRows = input.resources.map((r) => ({ ...scoped, resource_code: r.resourceCode, display_name: r.displayName, resource_type: r.resourceType, room_code: r.roomCode, capacity: r.capacity, gender_restriction: r.genderRestriction, is_bookable: r.isBookable, is_runtime_only: r.isRuntimeOnly, is_active: r.isActive }));
  if (resourceRows.length) ensure((await relife.from("clinic_resources").upsert(resourceRows, { onConflict: "organization_id,clinic_id,resource_code" })).error, "RESOURCES_WRITE");
  const b = input.booking;
  ensure((await relife.from("clinic_booking_config").upsert({ ...scoped, booking_mode: b.bookingMode, default_duration_min: b.defaultDurationMin, slot_interval_min: b.slotIntervalMin, max_simultaneous: b.maxSimultaneous, provider_required: b.providerRequired, resource_required: b.resourceRequired, block_duplicate_patient_overlap: b.blockDuplicatePatientOverlap, allow_walk_in: b.allowWalkIn, cancellation_notice_min: b.cancellationNoticeMin, late_arrival_grace_min: b.lateArrivalGraceMin, capacity_rules: b.capacityRules }, { onConflict: "organization_id,clinic_id" })).error, "BOOKING_WRITE");
}

/**
 * `operationalStore` is deliberately absent from the writable profile. Which
 * store owns a clinic's operational record is a platform/migration decision
 * made under evidence, never something a clinic's own settings edit may flip —
 * a clinic silently repointed at an empty store would look like total data loss
 * to the people using it.
 */
export async function writeClinicProfile(scope: TenantScope, profile: Omit<ClinicProfileConfiguration, keyof TenantScope | "lifecycle" | "operationalStore">, actor: string, client = adminClient()) {
  const tenant = requireTenantScope(scope); const relife = client.schema("relife"); const scoped = dbScope(tenant);
  const clinicUpdate = await relife.from("clinics").update({ name: profile.clinicName, timezone: profile.timezone }).match({ organization_id: scoped.organization_id, id: scoped.clinic_id }).select("id").maybeSingle();
  ensure(clinicUpdate.error, "PROFILE_WRITE"); if (!clinicUpdate.data) throw new Error("CONFIGURATION_NOT_AUTHORIZED");
  const result = await relife.from("clinic_settings").upsert({ ...scoped, clinic_type: profile.clinicType, branch_name: profile.branchName, address: profile.address, phone: profile.phone, email: profile.email, logo_url: profile.logoUrl, currency: profile.currency, locale: profile.locale, updated_by: actor }, { onConflict: "organization_id,clinic_id" }).select("clinic_id").single();
  ensure(result.error, "PROFILE_WRITE"); return result.data;
}

export async function writeOperatingHours(scope: TenantScope, rows: OperatingHourConfiguration[], client = adminClient()) {
  const tenant = requireTenantScope(scope); const scoped = dbScope(tenant);
  const payload = rows.map((r) => ({ ...scoped, day_of_week: r.dayOfWeek, is_open: r.isOpen, opens_at: r.isOpen ? r.opensAt : null, closes_at: r.isOpen ? r.closesAt : null }));
  const result = await client.schema("relife").from("clinic_operating_hours").upsert(payload, { onConflict: "organization_id,clinic_id,day_of_week" }).select("day_of_week");
  ensure(result.error, "HOURS_WRITE"); return result.data;
}

export async function writeClinicService(scope: TenantScope, service: Omit<ClinicServiceConfiguration, keyof TenantScope>, client = adminClient()) {
  const scoped = dbScope(requireTenantScope(scope));
  const result = await client.schema("relife").from("clinic_services").upsert({ ...scoped, service_code: service.serviceCode, display_name: service.displayName, department: service.department, price: service.price, duration_min: service.durationMin, requires_booking: service.requiresBooking, requires_provider: service.requiresProvider, requires_resource: service.requiresResource, discount_applicable: service.discountApplicable, tax_applicable: service.taxApplicable, package_eligible: service.packageEligible, is_active: service.isActive }, { onConflict: "organization_id,clinic_id,service_code" }).select("service_code").single();
  ensure(result.error, "SERVICE_WRITE"); return result.data;
}
