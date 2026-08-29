import "server-only";

import { readClinicConfiguration } from "@/lib/data/clinicConfiguration";
import { listStoredStaffProvisioning } from "@/lib/data/staffProvisioning";
import { clinicRuntimeDepartments } from "@/lib/domain/tenancy/clinicRuntime";
import {
  requireTenantScope,
  type TenantRoleCode,
  type TenantScope,
} from "@/lib/domain/tenancy/policy";
import type { Department } from "@/lib/types";
import type { WebRole } from "@/lib/webos/access";
import type { WebStaffIdentity } from "@/lib/webos/staffDirectory";

const ROLE_MAP: Readonly<Record<TenantRoleCode, WebRole>> = {
  owner: "Owner",
  manager: "Manager",
  receptionist: "Receptionist",
  therapist: "Therapist",
  dentist: "Dentist",
  dental_assistant: "Dental_Assistant",
  auditor: "Auditor",
  system_admin: "System Admin",
};

const DEPARTMENTS = new Set<Department>(["Physio", "Dental", "All"]);

function tenantDepartments(values: string[]): Department[] {
  return [...new Set(values.filter((value): value is Department => DEPARTMENTS.has(value as Department)))];
}

function tenantRoles(values: TenantRoleCode[]): WebRole[] {
  return [...new Set(values.map((value) => ROLE_MAP[value]).filter(Boolean))];
}

function canonicalPrimaryDepartment(departments: Department[]): Department | null {
  if (departments.includes("All")) return "All";
  return departments[0] || null;
}

function clampIdentityToClinic(
  identity: WebStaffIdentity,
  departments: readonly ("Physio" | "Dental")[],
): WebStaffIdentity | null {
  if (departments.length !== 1) return null;
  const department = departments[0];
  if (
    (department === "Physio" && identity.roles.some((role) => role === "Dentist" || role === "Dental_Assistant")) ||
    (department === "Dental" && identity.roles.includes("Therapist"))
  ) {
    return null;
  }
  return {
    ...identity,
    primaryDepartment: department,
    departmentAccess: [department],
  };
}

/**
 * Resolve staff authorization exclusively from the exact Supabase tenant
 * binding plus its canonical role and department children. Legacy Relife
 * Sheets data is never an authorization or identity fallback here.
 *
 * Incomplete canonical provisioning fails closed. The clinic configuration
 * then narrows the resolved identity to the one live department allowed by
 * that clinic type before any caller receives it.
 */
export async function getTenantScopedWebStaffIdentity(
  rawStaffId: string,
  scope: TenantScope,
): Promise<WebStaffIdentity | null> {
  const tenant = requireTenantScope(scope);
  const staffId = rawStaffId.trim();
  if (!staffId) return null;

  const provisioning = await listStoredStaffProvisioning(tenant);
  const binding = provisioning.find(
    (row) => row.staffId === staffId && row.status === "active",
  );
  if (!binding) return null;

  const hasTenantRoles = binding.roleCodes.length > 0;
  const hasTenantDepartments = binding.departmentIds.length > 0;
  if (!hasTenantRoles || !hasTenantDepartments) return null;

  const roles = tenantRoles(binding.roleCodes);
  const departmentAccess = tenantDepartments(binding.departmentIds);
  if (
    roles.length !== new Set(binding.roleCodes).size ||
    departmentAccess.length !== new Set(binding.departmentIds).size ||
    roles.length === 0 ||
    departmentAccess.length === 0
  ) {
    return null;
  }

  const primary = canonicalPrimaryDepartment(departmentAccess);
  if (!primary) return null;

  const identity: WebStaffIdentity = {
    staffId,
    fullName: staffId,
    phone: "",
    telegramId: "",
    status: "Active",
    primaryDepartment: primary,
    roles,
    departmentAccess,
    clinicalWriteScope: "",
    financialAccess: "",
  };

  const configuration = await readClinicConfiguration(tenant);
  return clampIdentityToClinic(
    identity,
    clinicRuntimeDepartments(configuration.profile?.clinicType),
  );
}

/** List only canonically provisioned staff in the exact requested tenant. */
export async function listTenantScopedWebStaffDirectory(
  scope: TenantScope,
): Promise<WebStaffIdentity[]> {
  const tenant = requireTenantScope(scope);
  const provisioning = await listStoredStaffProvisioning(tenant);
  const staffIds = [...new Set(
    provisioning
      .filter((row) => row.status === "active" && row.staffId.trim())
      .map((row) => row.staffId.trim()),
  )];
  const identities = await Promise.all(
    staffIds.map((staffId) => getTenantScopedWebStaffIdentity(staffId, tenant)),
  );
  return identities.filter((identity): identity is WebStaffIdentity => Boolean(identity));
}
