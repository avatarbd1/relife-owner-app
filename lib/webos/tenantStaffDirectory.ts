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

async function legacyIdentity(staffId: string): Promise<WebStaffIdentity | null> {
  try {
    return await getActiveWebStaffById(staffId);
  } catch {
    return null;
  }
}

/**
 * Resolve authorization only after an exact active tenant binding exists.
 *
 * Fully provisioned SaaS staff take role/department authority exclusively from
 * Supabase tenant bindings. During the bounded Relife cutover, an exact-bound
 * legacy staff row whose role AND department children have not been migrated
 * yet may temporarily reuse its Sheet authorization. That compatibility path
 * can never grant an unbound staff member access to a tenant.
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
  if (hasTenantRoles !== hasTenantDepartments) return null;

  const legacy = await legacyIdentity(staffId);

  if (!hasTenantRoles && !hasTenantDepartments) {
    // Transitional Relife compatibility is permitted only behind the exact
    // active binding found above. No global Sheet-only tenant fallback exists.
    return legacy;
  }

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
    // Legacy policy flags are not tenant-keyed, so they cannot widen a fully
    // migrated tenant membership. Transitional Relife rows return the legacy
    // identity above until their tenant children are populated.
    clinicalWriteScope: "",
    financialAccess: "",
  };
}
