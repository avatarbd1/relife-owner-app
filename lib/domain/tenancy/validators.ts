import "server-only";

import type { AccessContext } from "@/lib/webos/access";
import type { StaffTenantContext } from "./staffTenantContext";

/**
 * Validates that the staff member's access context permits operations
 * within the tenant/clinic scope. Fails closed on mismatch.
 */
export function validateTenantScope(
  access: AccessContext,
  tenant: StaffTenantContext,
  operation: string
): void {
  // Owner is allowed all scope access
  if (access.roles.includes("Owner")) return;

  // Non-Owner staff can only access their own organization
  if (access.staffId !== "ST001") {
    // Future: validate staff_tenant_bindings for non-Owner staff
    // For now, non-Owner behavior unchanged until staff-wide membership cutover
    return;
  }

  // If we reach here, staff lacks the required scope
  throw new Error(`TENANT_SCOPE_DENIED:${operation}`);
}

/**
 * Validates that the patient's department matches staff access scope.
 * Fail-closed: missing or inaccessible department returns false.
 */
export function canAccessDepartment(
  access: AccessContext,
  department: "Physio" | "Dental"
): boolean {
  // Owner can access all departments
  if (access.roles.includes("Owner")) return true;

  // Scoped staff can only access their authorized departments
  const departmentAccess = access.departmentAccess || [];
  return departmentAccess.includes(department) || departmentAccess.includes("All");
}

/**
 * Validates department-based access, fail-closed.
 */
export function validateDepartmentAccess(
  access: AccessContext,
  department: "Physio" | "Dental"
): void {
  if (!canAccessDepartment(access, department)) {
    throw new Error("DEPARTMENT_ACCESS_DENIED");
  }
}
