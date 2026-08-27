import type { TenantScope } from "./policy.ts";
import { requireTenantScope } from "./policy.ts";
import { validateOperatingHours, facilityBookingReadiness, type ClinicConfigurationSnapshot } from "./configurationCore.ts";

export type ReadinessCheckStatus = "PASS" | "FAIL" | "UNVERIFIED";

export interface ReadinessCheckResult {
  status: ReadinessCheckStatus;
  evidence: string[];
  details: string;
}

export interface TrustedReadinessEvidence {
  organizationExists?: ReadinessCheckResult;
  clinicExists?: ReadinessCheckResult;
  clinicBelongsToOrganization?: ReadinessCheckResult;
  databaseSchemaReady?: ReadinessCheckResult;
  noRelifeDefaultsInActivePath?: ReadinessCheckResult;
  crossTenantIsolationVerified?: ReadinessCheckResult;
  provisioningRollbackEvidencePresent?: ReadinessCheckResult;
}

export interface ClinicReadinessReport {
  organizationId: string;
  clinicId: string;
  overallStatus: "READY_FOR_ACTIVATION" | "NOT_READY";
  timestamp: Date;
  checks: {
    tenantContextResolvable: ReadinessCheckResult;
    organizationExists: ReadinessCheckResult;
    clinicExists: ReadinessCheckResult;
    clinicBelongsToOrganization: ReadinessCheckResult;
    clinicStatusAllowsActivation: ReadinessCheckResult;
    ownerHasClinicMembership: ReadinessCheckResult;
    ownerRoleProvisioned: ReadinessCheckResult;
    clinicProfileComplete: ReadinessCheckResult;
    operatingHoursConfigured: ReadinessCheckResult;
    featureFlagsConsistent: ReadinessCheckResult;
    servicesConfigured: ReadinessCheckResult;
    tenantSafeConfigurationLookup: ReadinessCheckResult;
    bookingConfigurationValid: ReadinessCheckResult;
    facilityResourcesConfigured: ReadinessCheckResult;
    staffProvisioningValid: ReadinessCheckResult;
    financeConfigurationValid: ReadinessCheckResult;
    databaseSchemaReady: ReadinessCheckResult;
    noRelifeDefaultsInActivePath: ReadinessCheckResult;
    crossTenantIsolationVerified: ReadinessCheckResult;
    provisioningRollbackEvidencePresent: ReadinessCheckResult;
  };
}

export function readinessPass(evidence: string[]): ReadinessCheckResult {
  return { status: "PASS", evidence, details: evidence.join("; ") };
}

export function readinessFail(reasons: string[]): ReadinessCheckResult {
  return { status: "FAIL", evidence: reasons, details: reasons.join("; ") };
}

export function readinessUnverified(reason: string): ReadinessCheckResult {
  return { status: "UNVERIFIED", evidence: [reason], details: reason };
}

function entitlementValid(snapshot: ClinicConfigurationSnapshot, featureKey: string, at = new Date()): boolean {
  const catalog = snapshot.catalog.find((row) => row.featureKey === featureKey && row.status === "active");
  const flag = snapshot.flags.find((row) => row.featureKey === featureKey && row.enabled);
  const entitlement = snapshot.entitlements.find(
    (row) => row.featureKey === featureKey && row.status === "active" && row.effectiveFrom <= at && (!row.effectiveUntil || row.effectiveUntil > at),
  );
  return Boolean(catalog && flag && entitlement);
}

export async function evaluateClinicReadiness(
  scope: Partial<TenantScope>,
  configuration: ClinicConfigurationSnapshot,
  staffProvisioning: Array<{ organizationId: string; clinicId: string; staffId: string; roleCodes: string[] }>,
  ownerStaffId: string | null,
  evidence: TrustedReadinessEvidence = {},
): Promise<ClinicReadinessReport> {
  let tenant: TenantScope;
  try {
    tenant = requireTenantScope(scope);
  } catch {
    const blocked = readinessUnverified("tenant context unresolvable");
    return {
      organizationId: String(scope.organizationId || ""),
      clinicId: String(scope.clinicId || ""),
      overallStatus: "NOT_READY",
      timestamp: new Date(),
      checks: {
        tenantContextResolvable: readinessFail(["tenant context cannot be resolved"]),
        organizationExists: blocked,
        clinicExists: blocked,
        clinicBelongsToOrganization: blocked,
        clinicStatusAllowsActivation: blocked,
        ownerHasClinicMembership: blocked,
        ownerRoleProvisioned: blocked,
        clinicProfileComplete: blocked,
        operatingHoursConfigured: blocked,
        featureFlagsConsistent: blocked,
        servicesConfigured: blocked,
        tenantSafeConfigurationLookup: blocked,
        bookingConfigurationValid: blocked,
        facilityResourcesConfigured: blocked,
        staffProvisioningValid: blocked,
        financeConfigurationValid: blocked,
        databaseSchemaReady: blocked,
        noRelifeDefaultsInActivePath: blocked,
        crossTenantIsolationVerified: blocked,
        provisioningRollbackEvidencePresent: blocked,
      },
    };
  }

  const tenantContextResolvable = readinessPass([`organizationId: ${tenant.organizationId}`, `clinicId: ${tenant.clinicId}`]);
  const organizationExists = evidence.organizationExists ?? readinessUnverified("organization existence was not probed by a trusted collector");
  const clinicExists = evidence.clinicExists ?? readinessUnverified("clinic existence was not probed by a trusted collector");
  const clinicBelongsToOrganization = evidence.clinicBelongsToOrganization ?? readinessUnverified("clinic ownership was not probed by a trusted collector");

  const scopeMismatch = configuration.scope.organizationId !== tenant.organizationId || configuration.scope.clinicId !== tenant.clinicId;
  const lifecycle = configuration.profile?.lifecycle || "";
  const clinicStatusAllowsActivation = ["draft", "setup", "ready"].includes(lifecycle)
    ? readinessPass([`clinic status ${lifecycle} allows readiness evaluation`])
    : lifecycle === "active"
      ? readinessPass(["clinic already active"])
      : readinessFail([`clinic status ${lifecycle || "missing"} cannot activate`]);

  const scopedStaff = staffProvisioning.filter((row) => row.organizationId === tenant.organizationId && row.clinicId === tenant.clinicId);
  const crossScopedStaff = staffProvisioning.length !== scopedStaff.length;
  const ownerMembership = scopedStaff.find((row) => row.roleCodes.includes("owner") && row.staffId === ownerStaffId);
  const ownerHasClinicMembership = ownerMembership
    ? readinessPass(["authenticated owner membership matches exact organization + clinic"])
    : readinessFail(["authenticated owner membership missing for exact organization + clinic"]);
  const ownerRoleProvisioned = ownerMembership?.roleCodes.includes("owner")
    ? readinessPass(["owner role explicitly provisioned"])
    : readinessFail(["owner role not provisioned"]);

  const profile = configuration.profile;
  const clinicProfileComplete = profile && !scopeMismatch && profile.clinicName.trim() && profile.clinicType && profile.timezone && profile.currency
    ? readinessPass(["clinic name, type, timezone and currency configured"])
    : readinessFail(["clinic profile incomplete or tenant scope mismatch"]);

  const hourProblems = validateOperatingHours(configuration.operatingHours);
  const operatingHoursConfigured = hourProblems.length === 0
    ? readinessPass(["all seven weekdays configured and validated"])
    : readinessFail(hourProblems);

  const enabledFlags = configuration.flags.filter((flag) => flag.enabled);
  const invalidFlags = enabledFlags.filter((flag) => !entitlementValid(configuration, flag.featureKey));
  const featureFlagsConsistent = invalidFlags.length === 0
    ? readinessPass([`${enabledFlags.length} enabled feature flags have active catalog entries and entitlements`])
    : readinessFail(invalidFlags.map((flag) => `feature ${flag.featureKey} lacks active entitlement/catalog support`));

  const servicesConfigured = configuration.services.some((service) => service.isActive)
    ? readinessPass([`${configuration.services.filter((service) => service.isActive).length} active services configured`])
    : readinessFail(["no active services configured"]);

  const configRows = [
    ...configuration.operatingHours,
    ...configuration.flags,
    ...configuration.entitlements,
    ...configuration.services,
    ...(configuration.rooms || []),
    ...(configuration.resources || []),
    ...(configuration.booking ? [configuration.booking] : []),
  ];
  const allRowsTenantSafe = !scopeMismatch && configRows.every((row) => row.organizationId === tenant.organizationId && row.clinicId === tenant.clinicId);
  const tenantSafeConfigurationLookup = allRowsTenantSafe && !crossScopedStaff
    ? readinessPass(["configuration and staff provisioning rows match exact composite tenant scope"])
    : readinessFail(["cross-tenant or mismatched configuration/staff row detected"]);

  const phaseC = facilityBookingReadiness(configuration);
  const bookingConfigurationValid = phaseC.readyForPhaseCScope
    ? readinessPass(["booking configuration valid"])
    : readinessFail(phaseC.reasons);

  const facilityResourcesConfigured = (configuration.resources || []).length > 0 || configuration.booking?.bookingMode === "simple"
    ? readinessPass([`${(configuration.resources || []).length} resources; booking mode ${configuration.booking?.bookingMode || "unconfigured"}`])
    : readinessFail(["resource-requiring booking mode has no configured resources"]);

  const staffProvisioningValid = scopedStaff.some((row) => row.roleCodes.includes("owner")) && !crossScopedStaff
    ? readinessPass(["tenant-scoped owner provisioning present"])
    : readinessFail(["tenant-scoped owner provisioning missing or cross-tenant staff row supplied"]);

  const financeConfigurationValid = entitlementValid(configuration, "core.finance_basic")
    ? readinessPass(["core.finance_basic is enabled and actively entitled"])
    : readinessFail(["core.finance_basic must be enabled and actively entitled before activation"]);

  const databaseSchemaReady = evidence.databaseSchemaReady ?? readinessUnverified("database schema probe evidence missing");
  const noRelifeDefaultsInActivePath = evidence.noRelifeDefaultsInActivePath ?? readinessUnverified("runtime no-fallback attestation missing");
  const crossTenantIsolationVerified = evidence.crossTenantIsolationVerified ?? readinessUnverified("cross-tenant isolation probe evidence missing");
  const provisioningRollbackEvidencePresent = evidence.provisioningRollbackEvidencePresent ?? readinessUnverified("provisioning dry-run/compensation evidence missing");

  const checks = {
    tenantContextResolvable,
    organizationExists,
    clinicExists,
    clinicBelongsToOrganization,
    clinicStatusAllowsActivation,
    ownerHasClinicMembership,
    ownerRoleProvisioned,
    clinicProfileComplete,
    operatingHoursConfigured,
    featureFlagsConsistent,
    servicesConfigured,
    tenantSafeConfigurationLookup,
    bookingConfigurationValid,
    facilityResourcesConfigured,
    staffProvisioningValid,
    financeConfigurationValid,
    databaseSchemaReady,
    noRelifeDefaultsInActivePath,
    crossTenantIsolationVerified,
    provisioningRollbackEvidencePresent,
  };
  const allPassed = Object.values(checks).every((check) => check.status === "PASS");
  return {
    organizationId: tenant.organizationId,
    clinicId: tenant.clinicId,
    overallStatus: allPassed ? "READY_FOR_ACTIVATION" : "NOT_READY",
    timestamp: new Date(),
    checks,
  };
}
