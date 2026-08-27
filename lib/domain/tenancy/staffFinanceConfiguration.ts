import { featureDecision, type ClinicConfigurationSnapshot, type ConfigurationResult } from "./configurationCore.ts";
import { normalizeTenantRole, requireTenantScope, type TenantRoleCode, type TenantScope } from "./policy.ts";

export interface StaffProvisioningConfiguration extends TenantScope {
  staffId: string;
  roleCodes: string[];
  departmentIds: string[];
  status: "active" | "inactive";
  salaryAmount: number | null;
  appointmentProvider: boolean;
  loginEnabled: boolean;
}

export interface FinanceConfigurationDecision {
  basicFinance: boolean;
  salary: boolean;
  advancedFinance: boolean;
}

const DEPARTMENTS = new Set(["Physio", "Dental", "All"]);

function sameScope(scope: TenantScope, row: TenantScope): boolean {
  return scope.organizationId === row.organizationId && scope.clinicId === row.clinicId;
}

export function resolveStaffProvisioning(
  scope: Partial<TenantScope>,
  row: StaffProvisioningConfiguration | null,
): ConfigurationResult<StaffProvisioningConfiguration> {
  let tenant: TenantScope;
  try {
    tenant = requireTenantScope(scope);
  } catch {
    return { ok: false, reason: "not_authorized", details: ["TENANT_SCOPE_REQUIRED"] };
  }
  if (!row) return { ok: false, reason: "not_configured", details: ["staff provisioning missing"] };
  if (!sameScope(tenant, row)) {
    return { ok: false, reason: "not_authorized", details: ["STAFF_TENANT_SCOPE_MISMATCH"] };
  }

  const details: string[] = [];
  const staffId = row.staffId.trim();
  const roles = [...new Set(row.roleCodes.map(normalizeTenantRole).filter((role): role is TenantRoleCode => role !== null))];
  const departments = [...new Set(row.departmentIds.map((value) => value.trim()).filter((value) => DEPARTMENTS.has(value)))];
  if (!staffId) details.push("staff identity missing");
  if (roles.length !== row.roleCodes.length || roles.length === 0) details.push("role assignment invalid");
  if (departments.length !== row.departmentIds.length || departments.length === 0) details.push("department assignment invalid");
  if (departments.includes("All") && departments.length > 1) details.push("All department cannot be combined");
  if (row.status !== "active") details.push("staff provisioning inactive");
  if (row.salaryAmount !== null && (!Number.isFinite(row.salaryAmount) || row.salaryAmount < 0)) details.push("salary configuration invalid");
  if (row.appointmentProvider && !roles.some((role) => role === "therapist" || role === "dentist")) {
    details.push("appointment provider role invalid");
  }
  return details.length
    ? { ok: false, reason: "invalid", details }
    : { ok: true, value: { ...row, staffId, roleCodes: roles, departmentIds: departments } };
}

export function resolveFinanceConfiguration(
  scope: Partial<TenantScope>,
  snapshot: ClinicConfigurationSnapshot,
  at = new Date(),
): ConfigurationResult<FinanceConfigurationDecision> {
  let tenant: TenantScope;
  try {
    tenant = requireTenantScope(scope);
  } catch {
    return { ok: false, reason: "not_authorized", details: ["TENANT_SCOPE_REQUIRED"] };
  }
  if (!sameScope(tenant, snapshot.scope)) {
    return { ok: false, reason: "not_authorized", details: ["TENANT_SCOPE_MISMATCH"] };
  }
  const basic = featureDecision(snapshot, "core.finance_basic", at);
  if (!basic.ok) return { ok: false, reason: basic.reason, details: basic.details };
  return {
    ok: true,
    value: {
      basicFinance: true,
      salary: featureDecision(snapshot, "optional.salary", at).ok,
      advancedFinance: featureDecision(snapshot, "optional.finance_advanced", at).ok,
    },
  };
}

export function staffFinanceReadiness(
  scope: Partial<TenantScope>,
  snapshot: ClinicConfigurationSnapshot,
  staff: readonly StaffProvisioningConfiguration[],
  at = new Date(),
) {
  const reasons: string[] = [];
  const finance = resolveFinanceConfiguration(scope, snapshot, at);
  if (!finance.ok) reasons.push(`basic finance: ${finance.reason}`);
  const resolvedStaff = staff.map((row) => resolveStaffProvisioning(scope, row));
  resolvedStaff.forEach((result, index) => {
    if (!result.ok) reasons.push(...result.details.map((detail) => `staff ${index + 1}: ${detail}`));
  });
  if (!resolvedStaff.some((result) => result.ok && result.value.roleCodes.includes("owner"))) {
    reasons.push("active owner provisioning missing");
  }
  if (finance.ok && finance.value.salary) {
    const activeSalary = resolvedStaff.some((result) => result.ok && result.value.salaryAmount !== null);
    if (!activeSalary) reasons.push("salary feature requires staff salary configuration");
  }
  return { readyForPhaseDScope: reasons.length === 0, reasons };
}
