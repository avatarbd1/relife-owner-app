import "server-only";

import { createSupabaseAdminClient } from "@/lib/data/supabaseAdmin";
import type { Department } from "@/lib/types";
import type { WebRole } from "@/lib/webos/access";
import type { WebStaffIdentity } from "@/lib/webos/staffDirectory";

/**
 * Tenant-backed staff identity.
 *
 * The legacy staff directory (`getWebStaffDirectory`) reads one fixed Google
 * Sheet — Relife's Physio `08_Staff` / `Staff_Department_Access`. A clinic
 * provisioned through `relife.provision_clinic_v1` has its owner only in
 * `relife.staff_tenant_bindings`, so that staff member does not exist as far
 * as the Sheets directory is concerned: device enrollment and passkey login
 * both fail with STAFF_ENROLLMENT_ACCESS_DENIED / no identity.
 *
 * This module resolves a staff identity from canonical tenant membership
 * instead, so every provisioned clinic can authenticate without registering
 * its people in Relife's spreadsheet. It is a read-only identity source: the
 * Sheets directory stays authoritative wherever it has a row, and this is
 * consulted only when it does not.
 */

const ROLE_BY_CODE: Readonly<Record<string, WebRole>> = {
  owner: "Owner",
  manager: "Manager",
  receptionist: "Receptionist",
  therapist: "Therapist",
  dentist: "Dentist",
  dental_assistant: "Dental_Assistant",
  auditor: "Auditor",
  system_admin: "System Admin",
};

const DEPARTMENT_BY_ID: Readonly<Record<string, Department>> = {
  all: "All",
  physio: "Physio",
  dental: "Dental",
};

function parseRoles(values: unknown): WebRole[] {
  const roles = (Array.isArray(values) ? values : []).flatMap((value) => {
    const role = ROLE_BY_CODE[String(value ?? "").trim().toLowerCase()];
    return role ? [role] : [];
  });
  return [...new Set(roles)];
}

function parseDepartments(values: unknown): Department[] {
  const departments = (Array.isArray(values) ? values : []).flatMap((value) => {
    const department = DEPARTMENT_BY_ID[String(value ?? "").trim().toLowerCase()];
    return department ? [department] : [];
  });
  return [...new Set(departments)];
}

/**
 * `All` is an explicit grant in the tenant model, so it is preserved rather
 * than expanded — `toAccessContext` requires a non-null primary department and
 * a non-empty access list, and inferring a narrower department here would
 * silently reduce an owner's scope.
 */
function primaryDepartmentFor(departments: Department[]): Department | null {
  if (departments.includes("All")) return "All";
  return departments[0] ?? null;
}

export async function getTenantStaffIdentity(
  rawStaffId: string,
  client = createSupabaseAdminClient()
): Promise<WebStaffIdentity | null> {
  const staffId = String(rawStaffId ?? "").trim();
  if (!staffId) return null;

  const result = await client
    .schema("relife")
    .from("staff_tenant_bindings")
    .select("staff_id,status,is_default,staff_tenant_roles(role_code),staff_tenant_departments(department_id)")
    .eq("staff_id", staffId)
    .eq("status", "active")
    .eq("is_default", true)
    .maybeSingle();

  if (result.error) {
    throw new Error(`TENANT_STAFF_IDENTITY_READ_FAILED:${result.error.message}`);
  }
  const row = result.data as Record<string, unknown> | null;
  if (!row) return null;

  const roles = parseRoles(
    (row.staff_tenant_roles as Record<string, unknown>[] | null)?.map((entry) => entry.role_code)
  );
  const departments = parseDepartments(
    (row.staff_tenant_departments as Record<string, unknown>[] | null)?.map((entry) => entry.department_id)
  );
  const primaryDepartment = primaryDepartmentFor(departments);
  if (roles.length === 0 || !primaryDepartment) return null;

  return {
    staffId: String(row.staff_id),
    // The tenant model stores membership, not a personal profile. Showing the
    // staff ID is honest; inventing a display name is not.
    fullName: String(row.staff_id),
    phone: "",
    telegramId: "",
    status: "Active",
    primaryDepartment,
    roles,
    departmentAccess: departments,
    // Sheets-only policy flags. Left blank so no tenant-backed identity
    // inherits a Relife-specific clinical or financial exception.
    clinicalWriteScope: "",
    financialAccess: "",
  };
}
