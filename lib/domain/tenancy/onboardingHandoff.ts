import { requireTenantScope, type TenantScope } from "./policy.ts";

export type ImportHandoffStatus = "READY_FOR_PLATFORM_IMPORT_REVIEW" | "BLOCKED_INVALID_IMPORT";
export type ActivationHandoffStatus = "READY_FOR_PLATFORM_VERIFICATION" | "BLOCKED_OWNER_CONFIGURATION";

export interface ImportHandoffReceipt {
  scope: TenantScope;
  status: ImportHandoffStatus;
  authority: "PLATFORM_IMPORT_REVIEW";
  entityType: "patients" | "appointments" | "services" | "staff";
  totalRows: number;
  validRows: number;
  invalidRows: number;
  sourceDigestSha256: string;
  mutationPerformed: false;
  clinicOwnerMayExecuteImport: false;
  nextStep: string;
}

export interface ActivationHandoffReceipt {
  scope: TenantScope;
  status: ActivationHandoffStatus;
  clinicOwnerAuthority: "TENANT_CONFIGURATION_ONLY";
  platformOperatorAuthority: "OUT_OF_BAND_SERVICE_ROLE";
  platformOperatorIsBrowserRole: false;
  systemAdminIsPlatformOperator: false;
  browserMayRecordReadinessEvidence: false;
  browserMayActivate: false;
  browserMayAssignEntitlements: false;
  requiresExactReleaseShaEvidence: true;
  readinessRecordRpc: "relife.record_clinic_readiness_v1";
  activationRpc: "relife.activate_clinic_v1";
  mutationPerformed: false;
  nextStep: string;
}

export function buildImportHandoff(
  scope: Partial<TenantScope>,
  input: {
    entityType: ImportHandoffReceipt["entityType"];
    totalRows: number;
    validRows: number;
    invalidRows: number;
    canProceed: boolean;
    sourceDigestSha256: string;
  },
): ImportHandoffReceipt {
  const tenant = requireTenantScope(scope);
  if (!/^[0-9a-f]{64}$/.test(input.sourceDigestSha256)) throw new Error("IMPORT_HANDOFF_DIGEST_INVALID");
  const canProceed = input.canProceed && input.invalidRows === 0 && input.totalRows > 0 && input.validRows === input.totalRows;
  return {
    scope: tenant,
    status: canProceed ? "READY_FOR_PLATFORM_IMPORT_REVIEW" : "BLOCKED_INVALID_IMPORT",
    authority: "PLATFORM_IMPORT_REVIEW",
    entityType: input.entityType,
    totalRows: input.totalRows,
    validRows: input.validRows,
    invalidRows: input.invalidRows,
    sourceDigestSha256: input.sourceDigestSha256,
    mutationPerformed: false,
    clinicOwnerMayExecuteImport: false,
    nextStep: canProceed
      ? "Platform operator reviews the tenant-bound validation receipt before any separately reviewed canonical import executor is allowed to mutate data."
      : "Clinic Owner must correct every invalid row and validate again before platform import review.",
  };
}

export function buildActivationHandoff(
  scope: Partial<TenantScope>,
  readinessStatus: string,
): ActivationHandoffReceipt {
  const tenant = requireTenantScope(scope);
  const ready = readinessStatus === "READY_FOR_ACTIVATION";
  return {
    scope: tenant,
    status: ready ? "READY_FOR_PLATFORM_VERIFICATION" : "BLOCKED_OWNER_CONFIGURATION",
    clinicOwnerAuthority: "TENANT_CONFIGURATION_ONLY",
    platformOperatorAuthority: "OUT_OF_BAND_SERVICE_ROLE",
    platformOperatorIsBrowserRole: false,
    systemAdminIsPlatformOperator: false,
    browserMayRecordReadinessEvidence: false,
    browserMayActivate: false,
    browserMayAssignEntitlements: false,
    requiresExactReleaseShaEvidence: true,
    readinessRecordRpc: "relife.record_clinic_readiness_v1",
    activationRpc: "relife.activate_clinic_v1",
    mutationPerformed: false,
    nextStep: ready
      ? "Platform operator must independently verify the release, persist verified readiness evidence for the exact release SHA, then execute the service-role-only activation gate."
      : "Clinic Owner must resolve failed or unverified tenant-configuration checks before platform verification can begin.",
  };
}
