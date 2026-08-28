import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/data/supabaseAdmin";
import { replaceStoredStaffProvisioning } from "@/lib/data/staffProvisioning";
import { writeClinicProfile } from "@/lib/data/clinicConfiguration";
import {
  buildProvisioningPayload,
  CORE_FEATURE_KEYS,
  requireReleaseSha,
  trialEndsAt,
  type ClinicType,
  type NormalizedPlatformClinicProvisioningInput,
  type PlatformPlanCode,
} from "@/lib/domain/platform/platformOwnerMvp";
import { requireTenantScope, type TenantScope } from "@/lib/domain/tenancy/policy";

export type PlatformReadinessStatus = "ACTIVE" | "SUSPENDED" | "READY_FOR_VERIFICATION" | "SETUP_REQUIRED";

export interface PlatformFeatureCatalogRow {
  featureKey: string;
  label: string;
  moduleGroup: string;
  domain: string;
}

export interface PlatformClinicSummary extends TenantScope {
  organizationName: string;
  organizationSlug: string;
  clinicName: string;
  clinicSlug: string;
  clinicStatus: string;
  timezone: string;
  clinicType: ClinicType | null;
  ownerStaffIds: string[];
  enabledFeatures: string[];
  planCode: string | null;
  trialEndsAt: string | null;
  verifiedReleaseSha: string | null;
  readinessStatus: PlatformReadinessStatus;
  missingReadiness: string[];
}

export interface PlatformOwnerSnapshot {
  clinics: PlatformClinicSummary[];
  featureCatalog: PlatformFeatureCatalogRow[];
}

function ensure(error: { message?: string } | null, operation: string): void {
  if (error) throw new Error(`PLATFORM_${operation}_FAILED:${error.message || "unknown"}`);
}

function asRows<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export async function listPlatformOwnerSnapshot(client: SupabaseClient = createSupabaseAdminClient()): Promise<PlatformOwnerSnapshot> {
  const relife = client.schema("relife");
  const [organizations, clinics, settings, hours, services, bookings, flags, entitlements, bindings, roles, evidence, catalog] = await Promise.all([
    relife.from("organizations").select("id,slug,name,status").order("name"),
    relife.from("clinics").select("id,organization_id,slug,name,timezone,status").order("name"),
    relife.from("clinic_settings").select("organization_id,clinic_id,clinic_type"),
    relife.from("clinic_operating_hours").select("organization_id,clinic_id,day_of_week"),
    relife.from("clinic_services").select("organization_id,clinic_id,is_active"),
    relife.from("clinic_booking_config").select("organization_id,clinic_id"),
    relife.from("clinic_feature_flags").select("organization_id,clinic_id,feature_key,enabled"),
    relife.from("clinic_entitlements").select("organization_id,clinic_id,feature_key,status,plan_code,effective_until,created_at").order("created_at", { ascending: false }),
    relife.from("staff_tenant_bindings").select("id,organization_id,clinic_id,staff_id,status"),
    relife.from("staff_tenant_roles").select("binding_id,role_code"),
    relife.from("clinic_provisioning_evidence").select("organization_id,clinic_id,release_sha,status,created_at").eq("status", "verified").order("created_at", { ascending: false }),
    relife.from("feature_catalog").select("feature_key,label,module_group,domain,status").eq("status", "active").order("module_group").order("feature_key"),
  ]);
  for (const [result, name] of [
    [organizations, "ORGANIZATIONS_READ"], [clinics, "CLINICS_READ"], [settings, "SETTINGS_READ"], [hours, "HOURS_READ"],
    [services, "SERVICES_READ"], [bookings, "BOOKING_READ"], [flags, "FLAGS_READ"], [entitlements, "ENTITLEMENTS_READ"],
    [bindings, "BINDINGS_READ"], [roles, "ROLES_READ"], [evidence, "READINESS_READ"], [catalog, "CATALOG_READ"],
  ] as const) ensure(result.error, name);

  const orgRows = asRows<{ id: string; slug: string; name: string; status: string }>(organizations.data);
  const clinicRows = asRows<{ id: string; organization_id: string; slug: string; name: string; timezone: string; status: string }>(clinics.data);
  const settingRows = asRows<{ organization_id: string; clinic_id: string; clinic_type: ClinicType }>(settings.data);
  const hourRows = asRows<{ organization_id: string; clinic_id: string; day_of_week: number }>(hours.data);
  const serviceRows = asRows<{ organization_id: string; clinic_id: string; is_active: boolean }>(services.data);
  const bookingRows = asRows<{ organization_id: string; clinic_id: string }>(bookings.data);
  const flagRows = asRows<{ organization_id: string; clinic_id: string; feature_key: string; enabled: boolean }>(flags.data);
  const entitlementRows = asRows<{ organization_id: string; clinic_id: string; feature_key: string; status: string; plan_code: string; effective_until: string | null; created_at: string }>(entitlements.data);
  const bindingRows = asRows<{ id: string; organization_id: string; clinic_id: string; staff_id: string; status: string }>(bindings.data);
  const roleRows = asRows<{ binding_id: string; role_code: string }>(roles.data);
  const evidenceRows = asRows<{ organization_id: string; clinic_id: string; release_sha: string; status: string; created_at: string }>(evidence.data);

  const summaries = clinicRows.map((clinic): PlatformClinicSummary => {
    const organization = orgRows.find((row) => row.id === clinic.organization_id);
    const scopeMatch = (row: { organization_id: string; clinic_id: string }) => row.organization_id === clinic.organization_id && row.clinic_id === clinic.id;
    const setting = settingRows.find(scopeMatch);
    const clinicBindings = bindingRows.filter((row) => scopeMatch(row) && row.status === "active");
    const ownerStaffIds = clinicBindings.filter((binding) => roleRows.some((role) => role.binding_id === binding.id && role.role_code === "owner")).map((binding) => binding.staff_id);
    const enabledFeatures = flagRows.filter((row) => scopeMatch(row) && row.enabled).map((row) => row.feature_key);
    const activeEntitlements = entitlementRows.filter((row) => scopeMatch(row) && row.status === "active");
    const latestGrant = activeEntitlements[0] || null;
    const verified = evidenceRows.find(scopeMatch) || null;
    const missing: string[] = [];
    if (!setting) missing.push("clinic profile");
    if (hourRows.filter(scopeMatch).length !== 7) missing.push("7-day operating hours");
    if (!serviceRows.some((row) => scopeMatch(row) && row.is_active)) missing.push("active service");
    if (!bookingRows.some(scopeMatch)) missing.push("booking configuration");
    if (ownerStaffIds.length === 0) missing.push("owner assignment");
    const financeEnabled = enabledFeatures.includes("core.finance_basic") && activeEntitlements.some((row) => row.feature_key === "core.finance_basic");
    if (!financeEnabled) missing.push("core finance entitlement");
    const readinessStatus: PlatformReadinessStatus = clinic.status === "active"
      ? "ACTIVE"
      : clinic.status === "suspended"
        ? "SUSPENDED"
        : missing.length === 0
          ? "READY_FOR_VERIFICATION"
          : "SETUP_REQUIRED";
    return {
      organizationId: clinic.organization_id,
      clinicId: clinic.id,
      organizationName: organization?.name || "Unknown organization",
      organizationSlug: organization?.slug || "",
      clinicName: clinic.name,
      clinicSlug: clinic.slug,
      clinicStatus: clinic.status,
      timezone: clinic.timezone,
      clinicType: setting?.clinic_type || null,
      ownerStaffIds,
      enabledFeatures,
      planCode: latestGrant?.plan_code || null,
      trialEndsAt: latestGrant?.effective_until || null,
      verifiedReleaseSha: verified?.release_sha || null,
      readinessStatus,
      missingReadiness: missing,
    };
  });

  return {
    clinics: summaries,
    featureCatalog: asRows<{ feature_key: string; label: string; module_group: string; domain: string }>(catalog.data).map((row) => ({
      featureKey: row.feature_key,
      label: row.label,
      moduleGroup: row.module_group,
      domain: row.domain,
    })),
  };
}

export async function setPlatformClinicCommercial(
  scope: TenantScope,
  input: { planCode: PlatformPlanCode; trialDays: number; featureKeys: string[] },
  actorStaffId: string,
  client: SupabaseClient = createSupabaseAdminClient(),
): Promise<void> {
  const tenant = requireTenantScope(scope);
  const selected = [...new Set([...CORE_FEATURE_KEYS, ...input.featureKeys.map((key) => key.trim()).filter(Boolean)])];
  const trialDays = Number(input.trialDays);
  if (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > 90) throw new Error("PLATFORM_TRIAL_DAYS_INVALID");
  const relife = client.schema("relife");
  const catalog = await relife.from("feature_catalog").select("feature_key").eq("status", "active");
  ensure(catalog.error, "CATALOG_READ");
  const known = new Set(asRows<{ feature_key: string }>(catalog.data).map((row) => row.feature_key));
  if (selected.some((key) => !known.has(key))) throw new Error("PLATFORM_FEATURE_UNKNOWN");
  const expiresAt = trialEndsAt(new Date(), trialDays).toISOString();
  const flags = [...known].map((featureKey) => ({
    organization_id: tenant.organizationId,
    clinic_id: tenant.clinicId,
    feature_key: featureKey,
    enabled: selected.includes(featureKey),
    enabled_by: `platform:${actorStaffId}`,
    notes: selected.includes(featureKey) ? `${input.planCode} trial selected` : `${input.planCode} trial not selected`,
  }));
  const flagWrite = await relife.from("clinic_feature_flags").upsert(flags, { onConflict: "organization_id,clinic_id,feature_key" });
  ensure(flagWrite.error, "FLAGS_WRITE");

  const current = await relife.from("clinic_entitlements").select("id,feature_key,status")
    .eq("organization_id", tenant.organizationId).eq("clinic_id", tenant.clinicId).eq("status", "active");
  ensure(current.error, "ENTITLEMENTS_READ");
  const activeByFeature = new Map(asRows<{ id: string; feature_key: string }>(current.data).map((row) => [row.feature_key, row.id]));
  const staleIds = [...activeByFeature.entries()].filter(([key]) => !selected.includes(key)).map(([, id]) => id);
  if (staleIds.length) {
    const revoke = await relife.from("clinic_entitlements").update({ status: "revoked", updated_at: new Date().toISOString() }).in("id", staleIds);
    ensure(revoke.error, "ENTITLEMENTS_REVOKE");
  }
  for (const featureKey of selected) {
    const id = activeByFeature.get(featureKey);
    const values = {
      source: "trial",
      plan_code: input.planCode,
      effective_until: expiresAt,
      grant_reason: "Platform Owner MVP trial assignment",
      granted_by: `platform:${actorStaffId}`,
      updated_at: new Date().toISOString(),
    };
    if (id) {
      const update = await relife.from("clinic_entitlements").update(values).eq("id", id);
      ensure(update.error, "ENTITLEMENT_UPDATE");
    } else {
      const insert = await relife.from("clinic_entitlements").insert({
        organization_id: tenant.organizationId,
        clinic_id: tenant.clinicId,
        feature_key: featureKey,
        status: "active",
        effective_from: new Date().toISOString(),
        ...values,
      });
      ensure(insert.error, "ENTITLEMENT_INSERT");
    }
  }
}

export async function provisionPlatformClinic(
  input: NormalizedPlatformClinicProvisioningInput,
  actorStaffId: string,
  client: SupabaseClient = createSupabaseAdminClient(),
): Promise<TenantScope> {
  const payload = buildProvisioningPayload(input);
  const result = await client.schema("relife").rpc("provision_clinic_v1", { p_payload: payload });
  ensure(result.error, "PROVISION");
  const data = (result.data || {}) as { organizationId?: string; clinicId?: string };
  const scope = requireTenantScope({ organizationId: data.organizationId, clinicId: data.clinicId });
  await setPlatformClinicCommercial(scope, { planCode: input.planCode, trialDays: input.trialDays, featureKeys: input.featureKeys }, actorStaffId, client);
  return scope;
}

export async function updatePlatformClinicProfile(
  scope: TenantScope,
  profile: { clinicName: string; clinicType: ClinicType; branchName: string; address: string; phone: string; email: string; logoUrl?: string; currency: string; locale: string; timezone: string },
  actorStaffId: string,
  client: SupabaseClient = createSupabaseAdminClient(),
): Promise<void> {
  await writeClinicProfile(requireTenantScope(scope), {
    clinicName: profile.clinicName.trim(),
    clinicType: profile.clinicType,
    branchName: profile.branchName.trim(),
    address: profile.address.trim(),
    phone: profile.phone.trim(),
    email: profile.email.trim(),
    logoUrl: String(profile.logoUrl || "").trim(),
    currency: profile.currency.trim() || "BDT",
    locale: profile.locale.trim() || "en",
    timezone: profile.timezone.trim() || "Asia/Dhaka",
  }, `platform:${actorStaffId}`, client);
}

export async function assignPlatformClinicOwner(
  scope: TenantScope,
  ownerStaffId: string,
  actorStaffId: string,
  client: SupabaseClient = createSupabaseAdminClient(),
): Promise<void> {
  const staffId = ownerStaffId.trim();
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(staffId)) throw new Error("PLATFORM_OWNER_STAFF_ID_INVALID");
  await replaceStoredStaffProvisioning(requireTenantScope(scope), {
    staffId,
    roleCodes: ["owner"],
    departmentIds: ["All"],
    status: "active",
    isDefault: false,
  }, client);
  void actorStaffId;
}

export async function suspendPlatformClinic(
  scope: TenantScope,
  actorStaffId: string,
  client: SupabaseClient = createSupabaseAdminClient(),
): Promise<void> {
  const tenant = requireTenantScope(scope);
  const result = await client.schema("relife").from("clinics")
    .update({ status: "suspended", updated_at: new Date().toISOString() })
    .eq("organization_id", tenant.organizationId).eq("id", tenant.clinicId).select("id").maybeSingle();
  ensure(result.error, "SUSPEND");
  if (!result.data) throw new Error("PLATFORM_CLINIC_NOT_FOUND");
  void actorStaffId;
}

export async function activatePlatformClinic(
  scope: TenantScope,
  releaseSha: string,
  actorStaffId: string,
  client: SupabaseClient = createSupabaseAdminClient(),
): Promise<void> {
  const tenant = requireTenantScope(scope);
  const sha = requireReleaseSha(releaseSha);
  const result = await client.schema("relife").rpc("activate_clinic_v1", {
    p_organization_id: tenant.organizationId,
    p_clinic_id: tenant.clinicId,
    p_release_sha: sha,
  });
  ensure(result.error, "ACTIVATE");
  void actorStaffId;
}
