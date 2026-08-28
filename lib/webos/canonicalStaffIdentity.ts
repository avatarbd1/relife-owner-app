import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/data/supabaseAdmin";
import { loadStaffMembership } from "@/lib/domain/tenancy/staffAuthorization";
import {
  resolveStaffTenantContext,
  type StaffTenantContext,
} from "@/lib/domain/tenancy/staffTenantContext";
import type { TenantScope } from "@/lib/domain/tenancy/policy";
import type { Department } from "@/lib/types";
import type { WebRole } from "@/lib/webos/access";
import type { WebStaffIdentity } from "@/lib/webos/staffDirectory";

const ROLE_MAP: Record<string, WebRole> = {
  owner: "Owner",
  manager: "Manager",
  receptionist: "Receptionist",
  therapist: "Therapist",
  physiotherapist: "Therapist",
  dentist: "Dentist",
  dental_assistant: "Dental_Assistant",
  "dental assistant": "Dental_Assistant",
  auditor: "Auditor",
  system_admin: "System Admin",
  "system admin": "System Admin",
};

const DEPARTMENT_MAP: Record<string, Department> = {
  physio: "Physio",
  dental: "Dental",
  all: "All",
};

function normalizeRole(value: unknown): WebRole | null {
  return ROLE_MAP[String(value ?? "").trim().toLowerCase()] || null;
}

function normalizeDepartment(value: unknown): Department | null {
  return DEPARTMENT_MAP[String(value ?? "").trim().toLowerCase()] || null;
}

function identityFromMembership(input: {
  staffId: string;
  roleCodes: string[];
  departmentIds: string[];
}): WebStaffIdentity | null {
  const roles = [...new Set(input.roleCodes.map(normalizeRole).filter((role): role is WebRole => Boolean(role)))];
  const departmentAccess = [
    ...new Set(
      input.departmentIds
        .map(normalizeDepartment)
        .filter((department): department is Department => Boolean(department)),
    ),
  ];
  if (roles.length === 0 || departmentAccess.length === 0) return null;
  const primaryDepartment = departmentAccess.includes("All")
    ? "All"
    : departmentAccess[0];
  return {
    staffId: input.staffId.trim(),
    fullName: input.staffId.trim(),
    phone: "",
    telegramId: "",
    status: "Active",
    primaryDepartment,
    roles,
    departmentAccess,
    clinicalWriteScope: "",
    financialAccess: "",
  };
}

export async function getCanonicalActiveWebStaffById(
  staffId: string,
  requestedScope?: TenantScope | null,
  client: SupabaseClient = createSupabaseAdminClient(),
): Promise<WebStaffIdentity | null> {
  const normalizedStaffId = staffId.trim();
  if (!normalizedStaffId) return null;
  try {
    const tenant = await resolveStaffTenantContext(normalizedStaffId, requestedScope);
    const membership = await loadStaffMembership(client, tenant, normalizedStaffId);
    if (!membership || membership.status !== "active") return null;
    return identityFromMembership(membership);
  } catch {
    return null;
  }
}

type EnrollmentBinding = {
  id: string;
  organization_id: string;
  clinic_id: string;
  staff_id: string;
  status: string;
};

type RoleRow = { binding_id: string; role_code: string };
type DepartmentRow = { binding_id: string; department_id: string };
type ClinicRow = { id: string; organization_id: string; status: string };

/**
 * Enrollment is intentionally broader than operational access: a newly
 * provisioned clinic owner may register a device while the clinic is still in
 * setup. Suspended clinics remain denied. Operational access continues to use
 * the active-only tenant resolver.
 */
export async function getCanonicalEnrollmentWebStaffById(
  staffId: string,
  client: SupabaseClient = createSupabaseAdminClient(),
): Promise<WebStaffIdentity | null> {
  const normalizedStaffId = staffId.trim();
  if (!normalizedStaffId) return null;
  const relife = client.schema("relife");
  const { data: bindings, error: bindingError } = await relife
    .from("staff_tenant_bindings")
    .select("id,organization_id,clinic_id,staff_id,status")
    .eq("staff_id", normalizedStaffId)
    .eq("status", "active");
  if (bindingError || !bindings || bindings.length === 0) return null;

  const bindingRows = bindings as EnrollmentBinding[];
  const bindingIds = bindingRows.map((row) => row.id);
  const clinicIds = [...new Set(bindingRows.map((row) => row.clinic_id))];
  const [{ data: roles, error: roleError }, { data: departments, error: departmentError }, { data: clinics, error: clinicError }] = await Promise.all([
    relife.from("staff_tenant_roles").select("binding_id,role_code").in("binding_id", bindingIds),
    relife.from("staff_tenant_departments").select("binding_id,department_id").in("binding_id", bindingIds),
    relife.from("clinics").select("id,organization_id,status").in("id", clinicIds),
  ]);
  if (roleError || departmentError || clinicError || !roles || !departments || !clinics) return null;

  const roleRows = roles as RoleRow[];
  const departmentRows = departments as DepartmentRow[];
  const clinicRows = clinics as ClinicRow[];
  const eligible = bindingRows.filter((binding) => {
    const clinic = clinicRows.find(
      (row) => row.id === binding.clinic_id && row.organization_id === binding.organization_id,
    );
    if (!clinic || !["setup", "active"].includes(clinic.status)) return false;
    return roleRows.some((row) => row.binding_id === binding.id) &&
      departmentRows.some((row) => row.binding_id === binding.id);
  });
  if (eligible.length !== 1) return null;

  const binding = eligible[0];
  return identityFromMembership({
    staffId: normalizedStaffId,
    roleCodes: roleRows.filter((row) => row.binding_id === binding.id).map((row) => row.role_code),
    departmentIds: departmentRows.filter((row) => row.binding_id === binding.id).map((row) => row.department_id),
  });
}

export async function canonicalActiveTenantForStaff(
  staffId: string,
  requestedScope?: TenantScope | null,
): Promise<StaffTenantContext | null> {
  try {
    return await resolveStaffTenantContext(staffId.trim(), requestedScope);
  } catch {
    return null;
  }
}
