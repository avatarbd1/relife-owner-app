import "server-only";

import { listStoredStaffProvisioning } from "@/lib/data/staffProvisioning";
import {
  requireTenantScope,
  type TenantRoleCode,
  type TenantScope,
} from "@/lib/domain/tenancy/policy";
import type { Department } from "@/lib/types";
import type { WebRole } from "@/lib/webos/access";
import {
  getActiveWebStaffById,
  type WebStaffIdentity,
} from "@/lib/webos/staffDirectory";

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

function primaryDepartment(
  legacy: WebStaffIdentity | null,
  departments: Department[],
): Department | null {
  if (
    legacy?.primaryDepartment &&
    (departments.includes("All") || departments.includes(legacy.primaryDepartment))
  ) {
    return legacy.primaryDepartment;
  }
  if (departments.includes("All")) return "All";
  return departments[0] || null;
}

/**
 * Resolve authorization from the exact tenant binding. The legacy Sheet is
 * consulted only for non-authoritative display metadata while Relife remains
 * in bounded dual-write migration.
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

  const roles = tenantRoles(binding.roleCodes);
  const departmentAccess = tenantDepartments(binding.departmentIds);
  if (roles.length === 0 || departmentAccess.length === 0) return null;

  let legacy: WebStaffIdentity | null = null;
  try {
    legacy = await getActiveWebStaffById(staffId);
  } catch {
    // Tenant authorization must not depend on the Relife Sheet being present.
    legacy = null;
  }

  const primary = primaryDepartment(legacy, departmentAccess);
  if (!primary) return null;

  return {
    staffId,
    fullName: legacy?.fullName || staffId,
    phone: legacy?.phone || "",
    telegramId: legacy?.telegramId || "",
    status: "Active",
    primaryDepartment: primary,
    roles,
    departmentAccess,
    // These legacy flags are not tenant-keyed. Do not widen tenant authority
    // from them; tenant role + department bindings remain authoritative.
    clinicalWriteScope: "",
    financialAccess: "",
  };
}
