import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantScope } from "@/lib/domain/tenancy/policy";

export interface StaffMembership {
  staffId: string;
  organizationId: string;
  clinicId: string;
  roleCodes: string[];
  departmentIds: string[];
  status: "active" | "inactive";
  isDefault: boolean;
}

/**
 * Load staff membership and authorization info.
 * Fails closed: returns null if staff has no active binding or missing required data.
 */
export async function loadStaffMembership(
  client: SupabaseClient,
  scope: TenantScope,
  staffId: string
): Promise<StaffMembership | null> {
  try {
    // Get staff binding
    const { data: bindings, error: bindingError } = await client
      .from("staff_tenant_bindings")
      .select("*")
      .eq("organization_id", scope.organizationId)
      .eq("clinic_id", scope.clinicId)
      .eq("staff_id", staffId)
      .eq("status", "active")
      .single();

    if (bindingError || !bindings) {
      // No active binding found
      return null;
    }

    // Get staff roles
    const { data: roles, error: rolesError } = await client
      .from("staff_tenant_roles")
      .select("role_code")
      .eq("organization_id", scope.organizationId)
      .eq("clinic_id", scope.clinicId)
      .eq("staff_id", staffId);

    if (rolesError) {
      console.error("Failed to load staff roles:", rolesError);
      return null; // Fail closed
    }

    // Get staff departments
    const { data: departments, error: deptsError } = await client
      .from("staff_tenant_departments")
      .select("department_id")
      .eq("organization_id", scope.organizationId)
      .eq("clinic_id", scope.clinicId)
      .eq("staff_id", staffId);

    if (deptsError) {
      console.error("Failed to load staff departments:", deptsError);
      return null; // Fail closed
    }

    return {
      staffId,
      organizationId: scope.organizationId,
      clinicId: scope.clinicId,
      roleCodes: roles.map((r) => r.role_code),
      departmentIds: departments.map((d) => d.department_id),
      status: bindings.status,
      isDefault: bindings.is_default,
    };
  } catch (error) {
    console.error("Error loading staff membership:", error);
    return null; // Fail closed
  }
}

/**
 * Verify staff has required role.
 * Fails closed: returns false if membership not found or role not assigned.
 */
export async function staffHasRole(
  client: SupabaseClient,
  scope: TenantScope,
  staffId: string,
  roleCode: string
): Promise<boolean> {
  const membership = await loadStaffMembership(client, scope, staffId);
  if (!membership) return false;
  return membership.roleCodes.includes(roleCode);
}

/**
 * Verify staff has required department access.
 * Fails closed: returns false if membership not found or department not assigned.
 */
export async function staffHasDepartmentAccess(
  client: SupabaseClient,
  scope: TenantScope,
  staffId: string,
  departmentId: string
): Promise<boolean> {
  const membership = await loadStaffMembership(client, scope, staffId);
  if (!membership) return false;
  return membership.departmentIds.includes(departmentId);
}

/**
 * Verify staff can access any department.
 * Fails closed: returns false if membership not found or no departments assigned.
 */
export async function staffHasAnyDepartment(
  client: SupabaseClient,
  scope: TenantScope,
  staffId: string
): Promise<boolean> {
  const membership = await loadStaffMembership(client, scope, staffId);
  if (!membership) return false;
  return membership.departmentIds.length > 0;
}

/**
 * Require staff membership, fail closed.
 * Throws error if staff has no active membership or missing role/department.
 */
export async function requireStaffMembership(
  client: SupabaseClient,
  scope: TenantScope,
  staffId: string,
  options?: {
    requireRole?: string;
    requireDepartment?: string;
  }
): Promise<StaffMembership> {
  const membership = await loadStaffMembership(client, scope, staffId);
  if (!membership) {
    throw new Error("STAFF_MEMBERSHIP_NOT_FOUND");
  }

  if (options?.requireRole && !membership.roleCodes.includes(options.requireRole)) {
    throw new Error("STAFF_ROLE_NOT_ASSIGNED");
  }

  if (options?.requireDepartment && !membership.departmentIds.includes(options.requireDepartment)) {
    throw new Error("STAFF_DEPARTMENT_NOT_ASSIGNED");
  }

  return membership;
}

/**
 * Cross-department denial: verify both staff and patient belong to same department.
 * Fails closed: denies access if either has no department or departments don't intersect.
 */
export function checkCrossDepartmentAccess(
  staffDepartments: string[],
  patientDepartments: string[]
): boolean {
  if (staffDepartments.length === 0 || patientDepartments.length === 0) {
    return false; // Fail closed
  }
  // Check if there's any intersection
  const staffDeptSet = new Set(staffDepartments);
  return patientDepartments.some((dept) => staffDeptSet.has(dept));
}
