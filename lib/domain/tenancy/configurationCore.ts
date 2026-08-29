import { clinicMayServe, resolveFeature, validateBookingConfig, type ClinicBookingConfig, type ClinicEntitlement, type ClinicFeatureFlag, type ClinicResource, type FeatureCatalogEntry } from "./clinicConfiguration.ts";
import type { OperationalStore } from "./operationalStore.ts";
import { requireTenantScope, type TenantScope } from "./policy.ts";

export type ConfigurationFailure =
  | "not_authorized"
  | "not_configured"
  | "disabled"
  | "not_entitled"
  | "invalid";

export type ConfigurationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: ConfigurationFailure; details: string[] };

export interface ClinicProfileConfiguration extends TenantScope {
  clinicName: string;
  clinicType: "physiotherapy" | "dental" | "doctor_chamber" | "other";
  /**
   * Which store is authoritative for this clinic's operational record. Exactly
   * one authority per clinic: legacy Relife stays on `sheets`, every new clinic
   * uses the tenant-native `supabase` core. Never both for one action.
   */
  operationalStore: OperationalStore;
  branchName: string;
  address: string;
  phone: string;
  email: string;
  logoUrl: string;
  currency: string;
  locale: string;
  timezone: string;
  lifecycle: string;
}

export interface OperatingHourConfiguration extends TenantScope {
  dayOfWeek: number;
  isOpen: boolean;
  opensAt: string | null;
  closesAt: string | null;
}

export interface ClinicServiceConfiguration extends TenantScope {
  serviceCode: string;
  displayName: string;
  department: "Physio" | "Dental" | "All";
  price: number;
  durationMin: number;
  requiresBooking: boolean;
  requiresProvider: boolean;
  requiresResource: boolean;
  discountApplicable: boolean;
  taxApplicable: boolean;
  packageEligible: boolean;
  isActive: boolean;
}

export interface ClinicConfigurationSnapshot {
  scope: TenantScope;
  profile: ClinicProfileConfiguration | null;
  operatingHours: OperatingHourConfiguration[];
  catalog: FeatureCatalogEntry[];
  flags: ClinicFeatureFlag[];
  entitlements: ClinicEntitlement[];
  services: ClinicServiceConfiguration[];
  rooms?: ClinicRoomConfiguration[];
  resources?: ClinicResource[];
  booking?: ClinicBookingConfig | null;
}

export interface ClinicRoomConfiguration extends TenantScope {
  roomCode: string;
  displayName: string;
  isActive: boolean;
  sortOrder: number;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return Boolean(value.trim());
  } catch {
    return false;
  }
}

export function validateOperatingHours(rows: readonly OperatingHourConfiguration[]): string[] {
  const problems: string[] = [];
  const days = new Set<number>();
  for (const row of rows) {
    if (!Number.isInteger(row.dayOfWeek) || row.dayOfWeek < 1 || row.dayOfWeek > 7) {
      problems.push(`invalid day ${row.dayOfWeek}`);
      continue;
    }
    if (days.has(row.dayOfWeek)) problems.push(`duplicate day ${row.dayOfWeek}`);
    days.add(row.dayOfWeek);
    if (row.isOpen) {
      if (!row.opensAt || !row.closesAt || !TIME.test(row.opensAt) || !TIME.test(row.closesAt)) {
        problems.push(`day ${row.dayOfWeek} has invalid hours`);
      } else if (row.opensAt >= row.closesAt) {
        problems.push(`day ${row.dayOfWeek} closes before opening`);
      }
    } else if (row.opensAt !== null || row.closesAt !== null) {
      problems.push(`closed day ${row.dayOfWeek} must not carry hours`);
    }
  }
  if (days.size !== 7) problems.push("all seven weekdays must be configured");
  if (!rows.some((row) => row.isOpen)) problems.push("at least one day must be open");
  return problems;
}

export function resolveClinicConfiguration(
  scope: Partial<TenantScope>,
  snapshot: ClinicConfigurationSnapshot,
): ConfigurationResult<ClinicConfigurationSnapshot> {
  let tenant: TenantScope;
  try {
    tenant = requireTenantScope(scope);
  } catch {
    return { ok: false, reason: "not_authorized", details: ["TENANT_SCOPE_REQUIRED"] };
  }
  if (snapshot.scope.organizationId !== tenant.organizationId || snapshot.scope.clinicId !== tenant.clinicId) {
    return { ok: false, reason: "not_authorized", details: ["TENANT_SCOPE_MISMATCH"] };
  }
  const tenantRows = [
    ...(snapshot.profile ? [snapshot.profile] : []),
    ...snapshot.operatingHours,
    ...snapshot.flags,
    ...snapshot.entitlements,
    ...snapshot.services,
    ...(snapshot.rooms || []),
    ...(snapshot.resources || []),
    ...(snapshot.booking ? [snapshot.booking] : []),
  ];
  if (tenantRows.some((row) => row.organizationId !== tenant.organizationId || row.clinicId !== tenant.clinicId)) {
    return { ok: false, reason: "not_authorized", details: ["CROSS_TENANT_CONFIGURATION_ROW"] };
  }
  if (!snapshot.profile) return { ok: false, reason: "not_configured", details: ["clinic profile missing"] };
  const problems = [
    ...(!snapshot.profile.clinicName.trim() ? ["clinic name missing"] : []),
    ...(!isValidTimezone(snapshot.profile.timezone) ? ["timezone invalid"] : []),
    ...validateOperatingHours(snapshot.operatingHours),
  ];
  return problems.length
    ? { ok: false, reason: "invalid", details: problems }
    : { ok: true, value: snapshot };
}

export function featureDecision(
  snapshot: ClinicConfigurationSnapshot,
  featureKey: string,
  at = new Date(),
): ConfigurationResult<true> {
  const entry = snapshot.catalog.find((row) => row.featureKey === featureKey);
  if (!entry || entry.status !== "active") return { ok: false, reason: "disabled", details: ["feature unavailable"] };
  const flag = snapshot.flags.find((row) => row.organizationId === snapshot.scope.organizationId && row.clinicId === snapshot.scope.clinicId && row.featureKey === featureKey);
  if (!flag?.enabled) return { ok: false, reason: "disabled", details: ["feature disabled"] };
  const grant = snapshot.entitlements.find((row) => row.organizationId === snapshot.scope.organizationId && row.clinicId === snapshot.scope.clinicId && row.featureKey === featureKey && row.status === "active" && row.effectiveFrom <= at && (!row.effectiveUntil || row.effectiveUntil > at));
  if (!grant) return { ok: false, reason: "not_entitled", details: ["valid entitlement missing"] };
  if (!clinicMayServe(snapshot.profile?.lifecycle)) return { ok: false, reason: "disabled", details: ["clinic lifecycle cannot serve"] };
  return resolveFeature(snapshot.scope, featureKey, snapshot, at)
    ? { ok: true, value: true }
    : { ok: false, reason: "disabled", details: ["feature resolution failed closed"] };
}

export function configurationReadiness(snapshot: ClinicConfigurationSnapshot, authorized: boolean) {
  const reasons: string[] = [];
  if (!authorized) reasons.push("authorized membership missing");
  const resolved = resolveClinicConfiguration(snapshot.scope, snapshot);
  if (!resolved.ok) reasons.push(...resolved.details);
  if (!snapshot.profile || !clinicMayServe(snapshot.profile.lifecycle)) reasons.push("clinic lifecycle is not active");
  const featureKeys = new Set(snapshot.flags.map((row) => row.featureKey));
  for (const key of featureKeys) {
    if (snapshot.flags.find((row) => row.featureKey === key)?.enabled && !featureDecision(snapshot, key).ok) {
      reasons.push(`feature ${key} is enabled without a valid entitlement`);
    }
  }
  const serviceWorkflow = featureDecision(snapshot, "core.services");
  if (serviceWorkflow.ok && !snapshot.services.some((service) => service.isActive)) {
    reasons.push("enabled services workflow requires an active service");
  }
  return { readyForPhaseBScope: reasons.length === 0, reasons };
}

export function facilityBookingReadiness(snapshot: ClinicConfigurationSnapshot) {
  const reasons: string[] = [];
  if (!snapshot.booking) reasons.push("booking configuration missing");
  else {
    reasons.push(...validateBookingConfig(snapshot.booking).problems.map((problem) => `booking configuration: ${problem}`));
    if (snapshot.booking.bookingMode === "specific_resource" && !(snapshot.resources || []).some((resource) => resource.isActive && resource.isBookable && !resource.isRuntimeOnly)) reasons.push("specific-resource booking requires an active bookable resource");
  }
  return { readyForPhaseCScope: reasons.length === 0, reasons };
}
