import "server-only";

import type { AccessContext } from "@/lib/webos/access";
import type { StaffTenantContext } from "./staffTenantContext";

/**
 * Validate that the authenticated access context and canonical tenant context
 * belong to the same staff identity. The tenant context itself is resolved
 * server-side from the staff session and fails closed on missing/ambiguous
 * bindings, so there is no legacy/client-supplied tenant fallback here.
 */
export function validateTenantScope(
  access: AccessContext,
  tenant: StaffTenantContext,
  operation: string
): void {
  const accessStaffId = access.staffId.trim();
  const tenantStaffId = tenant.staffId.trim();

  if (!accessStaffId || !tenantStaffId || accessStaffId !== tenantStaffId) {
    throw new Error(`TENANT_SCOPE_DENIED:${operation}`);
  }

  if (!tenant.organizationId?.trim() || !tenant.clinicId?.trim()) {
    throw new Error(`TENANT_SCOPE_DENIED:${operation}`);
  }
}

/**
 * Validate department-based access using the existing server-derived
 * AccessContext. Owner/All scope remains compatible with the current RBAC
 * model; other staff must have the requested department explicitly assigned.
 */
export function canAccessDepartment(
  access: AccessContext,
  department: "Physio" | "Dental"
): boolean {
  if (access.roles.includes("Owner")) return true;

  const departmentAccess = access.departmentAccess || [];
  return departmentAccess.includes(department) || departmentAccess.includes("All");
}

/** Fail closed when the requested department is not in the staff scope. */
export function validateDepartmentAccess(
  access: AccessContext,
  department: "Physio" | "Dental"
): void {
  if (!canAccessDepartment(access, department)) {
    throw new Error("DEPARTMENT_ACCESS_DENIED");
  }
}
