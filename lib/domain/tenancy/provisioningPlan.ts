import type { ClinicConfigurationSnapshot } from "./configurationCore.ts";
import { requireTenantScope, type TenantScope } from "./policy.ts";

export interface ProvisioningPlanStep {
  key: string;
  operation: string;
  mutates: boolean;
  compensation: string | null;
}

export interface ProvisioningDryRun {
  scope: TenantScope;
  dryRun: true;
  reversible: boolean;
  steps: ProvisioningPlanStep[];
  evidence: string[];
}

export function buildProvisioningDryRun(
  scope: Partial<TenantScope>,
  snapshot: ClinicConfigurationSnapshot,
): ProvisioningDryRun {
  const tenant = requireTenantScope(scope);
  if (snapshot.scope.organizationId !== tenant.organizationId || snapshot.scope.clinicId !== tenant.clinicId) {
    throw new Error("TENANT_SCOPE_MISMATCH");
  }

  const rows = [
    ...snapshot.operatingHours,
    ...snapshot.flags,
    ...snapshot.entitlements,
    ...snapshot.services,
    ...(snapshot.rooms || []),
    ...(snapshot.resources || []),
    ...(snapshot.booking ? [snapshot.booking] : []),
  ];
  if (rows.some((row) => row.organizationId !== tenant.organizationId || row.clinicId !== tenant.clinicId)) {
    throw new Error("CROSS_TENANT_CONFIGURATION_ROW");
  }

  const steps: ProvisioningPlanStep[] = [
    { key: "profile", operation: "validate clinic profile and lifecycle", mutates: false, compensation: null },
    { key: "hours", operation: `validate ${snapshot.operatingHours.length} operating-hour rows`, mutates: false, compensation: null },
    { key: "services", operation: `validate ${snapshot.services.length} service rows`, mutates: false, compensation: null },
    { key: "facility", operation: `validate ${(snapshot.rooms || []).length} rooms and ${(snapshot.resources || []).length} resources`, mutates: false, compensation: null },
    { key: "booking", operation: "validate booking configuration", mutates: false, compensation: null },
    {
      key: "activation",
      operation: "transition clinic lifecycle from ready to active only after readiness PASS",
      mutates: true,
      compensation: "transition clinic lifecycle back to ready; no tenant business rows are deleted",
    },
  ];

  const reversible = steps.filter((step) => step.mutates).every((step) => Boolean(step.compensation));
  return {
    scope: tenant,
    dryRun: true,
    reversible,
    steps,
    evidence: [
      "dry-run performs no writes",
      "activation is the only planned mutating step in this bounded Phase F plan",
      "activation has an explicit lifecycle compensation to ready",
      "suspension/rollback does not delete tenant business data",
    ],
  };
}
