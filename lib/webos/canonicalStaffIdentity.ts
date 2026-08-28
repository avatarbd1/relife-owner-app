import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/data/supabaseAdmin";
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
    return await resolveCanonicalIdentity(client, normalizedStaffId, tenant, false);
  } catch (error) {
    console.error("Canonical active staff identity lookup failed", safeLookupError(error));
    return null;
  }
}

type CanonicalIdentityRow = {
  staff_id: string;
  role_codes: string[];
  department_ids: string[];
};

function safeLookupError(error: unknown): Record<string, string> {
  if (!error || typeof error !== "object") return { message: String(error) };
  const value = error as Record<string, unknown>;
  return Object.fromEntries(
    ["code", "message", "details", "hint"]
      .filter((key) => typeof value[key] === "string")
      .map((key) => [key, String(value[key])]),
  );
}

async function resolveCanonicalIdentity(
  client: SupabaseClient,
  staffId: string,
  tenant: StaffTenantContext | null,
  allowSetup: boolean,
): Promise<WebStaffIdentity | null> {
  const { data, error } = await client.rpc("resolve_canonical_staff_identity_v1", {
    p_staff_id: staffId,
    p_organization_id: tenant?.organizationId ?? null,
    p_clinic_id: tenant?.clinicId ?? null,
    p_allow_setup: allowSetup,
  });
  if (error) throw error;
  const rows = (data ?? []) as CanonicalIdentityRow[];
  if (rows.length !== 1) return null;
  return identityFromMembership({
    staffId: rows[0].staff_id,
    roleCodes: rows[0].role_codes,
    departmentIds: rows[0].department_ids,
  });
}

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
  try {
    return await resolveCanonicalIdentity(client, normalizedStaffId, null, true);
  } catch (error) {
    console.error("Canonical enrollment staff identity lookup failed", safeLookupError(error));
    return null;
  }
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
