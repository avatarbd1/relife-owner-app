import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { TenantScope } from "@/lib/domain/tenancy/policy";
import { requireTenantScope } from "@/lib/domain/tenancy/policy";
import type { ClinicConfigurationSnapshot, ClinicProfileConfiguration, ClinicServiceConfiguration, OperatingHourConfiguration } from "@/lib/domain/tenancy/configurationCore";

function adminClient(): SupabaseClient {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw new Error("CONFIGURATION_STORE_UNAVAILABLE");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function dbScope(scope: TenantScope) {
  const tenant = requireTenantScope(scope);
  return { organization_id: tenant.organizationId, clinic_id: tenant.clinicId };
}

function ensure(error: { message?: string } | null, operation: string): void {
  if (error) throw new Error(`CONFIGURATION_${operation}_FAILED:${error.message || "unknown"}`);
}

export async function readClinicConfiguration(scope: TenantScope, client = adminClient()): Promise<ClinicConfigurationSnapshot> {
  const tenant = requireTenantScope(scope);
  const relife = client.schema("relife");
  const scoped = dbScope(tenant);
  const [clinic, settings, hours, catalog, flags, grants, services] = await Promise.all([
    relife.from("clinics").select("id,name,timezone,status").eq("organization_id", scoped.organization_id).eq("id", scoped.clinic_id).maybeSingle(),
    relife.from("clinic_settings").select("*").match(scoped).maybeSingle(),
    relife.from("clinic_operating_hours").select("*").match(scoped).order("day_of_week"),
    relife.from("feature_catalog").select("feature_key,status"),
    relife.from("clinic_feature_flags").select("feature_key,enabled,organization_id,clinic_id").match(scoped),
    relife.from("clinic_entitlements").select("feature_key,status,effective_from,effective_until,organization_id,clinic_id").match(scoped),
    relife.from("clinic_services").select("*").match(scoped).order("display_name"),
  ]);
  for (const [result, name] of [[clinic,"CLINIC_READ"],[settings,"SETTINGS_READ"],[hours,"HOURS_READ"],[catalog,"CATALOG_READ"],[flags,"FLAGS_READ"],[grants,"ENTITLEMENTS_READ"],[services,"SERVICES_READ"]] as const) ensure(result.error, name);
  const c = clinic.data as Record<string, unknown> | null;
  const s = settings.data as Record<string, unknown> | null;
  const profile: ClinicProfileConfiguration | null = c && s ? {
    ...tenant, clinicName: String(c.name || ""), clinicType: s.clinic_type as ClinicProfileConfiguration["clinicType"], branchName: String(s.branch_name || ""), address: String(s.address || ""), phone: String(s.phone || ""), email: String(s.email || ""), logoUrl: String(s.logo_url || ""), currency: String(s.currency || ""), locale: String(s.locale || ""), timezone: String(c.timezone || ""), lifecycle: String(c.status || ""),
  } : null;
  return {
    scope: tenant,
    profile,
    operatingHours: ((hours.data || []) as Record<string, unknown>[]).map((r): OperatingHourConfiguration => ({ ...tenant, dayOfWeek: Number(r.day_of_week), isOpen: Boolean(r.is_open), opensAt: r.opens_at ? String(r.opens_at) : null, closesAt: r.closes_at ? String(r.closes_at) : null })),
    catalog: ((catalog.data || []) as Record<string, unknown>[]).map((r) => ({ featureKey: String(r.feature_key), status: r.status as "active" | "retired" })),
    flags: ((flags.data || []) as Record<string, unknown>[]).map((r) => ({ ...tenant, featureKey: String(r.feature_key), enabled: Boolean(r.enabled) })),
    entitlements: ((grants.data || []) as Record<string, unknown>[]).map((r) => ({ ...tenant, featureKey: String(r.feature_key), status: r.status as "active" | "suspended" | "revoked", effectiveFrom: new Date(String(r.effective_from)), effectiveUntil: r.effective_until ? new Date(String(r.effective_until)) : null })),
    services: ((services.data || []) as Record<string, unknown>[]).map((r): ClinicServiceConfiguration => ({ ...tenant, serviceCode: String(r.service_code), displayName: String(r.display_name), department: r.department as ClinicServiceConfiguration["department"], price: Number(r.price), durationMin: Number(r.duration_min), requiresBooking: Boolean(r.requires_booking), requiresProvider: Boolean(r.requires_provider), requiresResource: Boolean(r.requires_resource), discountApplicable: Boolean(r.discount_applicable), taxApplicable: Boolean(r.tax_applicable), packageEligible: Boolean(r.package_eligible), isActive: Boolean(r.is_active) })),
  };
}

export async function writeClinicProfile(scope: TenantScope, profile: Omit<ClinicProfileConfiguration, keyof TenantScope | "lifecycle">, actor: string, client = adminClient()) {
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
