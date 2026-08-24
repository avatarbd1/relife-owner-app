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

interface StaffBindingRow {
  id: string;
  status: "active" | "inactive";
  is_default: boolean;
}

interface StaffRoleRow {
  role_code: string;
}

interface StaffDepartmentRow {
  department_id: string;
}

/**
 * Loads the active staff binding for one exact organization + clinic scope.
 * Any missing/ambiguous/error state fails closed.
 */
export async function loadStaffMembership(
  client: SupabaseClient,
  scope: TenantScope,
  staffId: string,
): Promise<StaffMembership | null> {
  const normalizedStaffId = staffId.trim();
  if (!normalizedStaffId) return null;

  try {
    const relife = client.schema("relife");
    const { data: binding, error: bindingError } = await relife
      .from("staff_tenant_bindings")
      .select("id,status,is_default")
      .eq("organization_id", scope.organizationId)
      .eq("clinic_id", scope.clinicId)
      .eq("staff_id", normalizedStaffId)
      .eq("status", "active")
      .maybeSingle<StaffBindingRow>();

    if (bindingError || !binding) return null;

    const [{ data: roles, error: rolesError }, { data: departments, error: departmentsError }] = await Promise.all([
      relife.from("staff_tenant_roles").select("role_code").eq("binding_id", binding.id),
      relife.from("staff_tenant_departments").select("department_id").eq("binding_id", binding.id),
    ]);

    if (rolesError || departmentsError || !roles || !departments) return null;

    return {
      staffId: normalizedStaffId,
      organizationId: scope.organizationId,
      clinicId: scope.clinicId,
      roleCodes: (roles as StaffRoleRow[]).map((row) => row.role_code),
      departmentIds: (departments as StaffDepartmentRow[]).map((row) => row.department_id),
      status: binding.status,
      isDefault: binding.is_default,
    };
  } catch {
    return null;
  }
}

export async function staffHasRole(
  client: SupabaseClient,
  scope: TenantScope,
  staffId: string,
  roleCode: string,
): Promise<boolean> {
  const membership = await loadStaffMembership(client, scope, staffId);
  return membership?.roleCodes.includes(roleCode) ?? false;
}

export async function staffHasDepartmentAccess(
  client: SupabaseClient,
  scope: TenantScope,
  staffId: string,
  departmentId: string,
): Promise<boolean> {
  const membership = await loadStaffMembership(client, scope, staffId);
  return membership?.departmentIds.includes(departmentId) ?? false;
}

export async function staffHasAnyDepartment(
  client: SupabaseClient,
  scope: TenantScope,
  staffId: string,
): Promise<boolean> {
  const membership = await loadStaffMembership(client, scope, staffId);
  return (membership?.departmentIds.length ?? 0) > 0;
}

export async function requireStaffMembership(
  client: SupabaseClient,
  scope: TenantScope,
  staffId: string,
  options?: { requireRole?: string; requireDepartment?: string },
): Promise<StaffMembership> {
  const membership = await loadStaffMembership(client, scope, staffId);
  if (!membership) throw new Error("STAFF_MEMBERSHIP_NOT_FOUND");
  if (options?.requireRole && !membership.roleCodes.includes(options.requireRole)) {
    throw new Error("STAFF_ROLE_NOT_ASSIGNED");
  }
  if (options?.requireDepartment && !membership.departmentIds.includes(options.requireDepartment)) {
    throw new Error("STAFF_DEPARTMENT_NOT_ASSIGNED");
  }
  return membership;
}

/** Department access is denied unless both sides have at least one matching department. */
export function checkCrossDepartmentAccess(staffDepartments: string[], patientDepartments: string[]): boolean {
  if (staffDepartments.length === 0 || patientDepartments.length === 0) return false;
  const staffDepartmentSet = new Set(staffDepartments);
  return patientDepartments.some((department) => staffDepartmentSet.has(department));
}
