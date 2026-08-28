import "server-only";

import { createSupabaseAdminClient } from "@/lib/data/supabaseAdmin";
import { listStoredStaffProvisioning } from "@/lib/data/staffProvisioning";
import type { TenantScope } from "@/lib/domain/tenancy/policy";
import { canPerform, type AccessContext } from "@/lib/webos/access";
import { getWebStaffDirectory } from "@/lib/webos/staffDirectory";

export type ClinicDepartment = "Physio" | "Dental";

export interface TenantClinicianOption {
  staffId: string;
  fullName: string;
  department: ClinicDepartment;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeDepartment(value: unknown): ClinicDepartment | null {
  const text = normalize(value).toLowerCase();
  if (text === "physio" || text === "physiotherapy") return "Physio";
  if (text === "dental") return "Dental";
  return null;
}

function templateDepartments(clinicType: string): ClinicDepartment[] {
  if (clinicType === "physiotherapy") return ["Physio"];
  if (clinicType === "dental") return ["Dental"];
  return [];
}

/**
 * Canonical department set for one clinic. Explicit tenant department rows win.
 * A newly provisioned clinic that has not yet materialized department rows falls
 * back only to the system clinic-type template; it never inherits Relife data.
 */
export async function getTenantClinicDepartments(
  scope: TenantScope,
): Promise<ClinicDepartment[]> {
  const admin = createSupabaseAdminClient();
  const relife = admin.schema("relife");
  const departments = await relife
    .from("departments")
    .select("code,name")
    .eq("organization_id", scope.organizationId)
    .eq("clinic_id", scope.clinicId)
    .eq("status", "active");

  if (departments.error) {
    throw new Error(`TENANT_DEPARTMENTS_READ_FAILED:${departments.error.message}`);
  }

  const explicit = [...new Set(
    ((departments.data || []) as Array<{ code: string; name: string }>)
      .map((row) => normalizeDepartment(row.code) || normalizeDepartment(row.name))
      .filter((value): value is ClinicDepartment => Boolean(value)),
  )];
  if (explicit.length > 0) return explicit;

  const settings = await relife
    .from("clinic_settings")
    .select("clinic_type")
    .eq("organization_id", scope.organizationId)
    .eq("clinic_id", scope.clinicId)
    .maybeSingle();
  if (settings.error) {
    throw new Error(`TENANT_CLINIC_SETTINGS_READ_FAILED:${settings.error.message}`);
  }
  return templateDepartments(normalize((settings.data as { clinic_type?: string } | null)?.clinic_type));
}

export async function getTenantPatientCreateDepartments(
  context: AccessContext,
  scope: TenantScope,
): Promise<ClinicDepartment[]> {
  const enabled = await getTenantClinicDepartments(scope);
  return enabled.filter((department) => canPerform(context, "patient.create", department));
}

export async function assertTenantDepartmentEnabled(
  scope: TenantScope,
  department: ClinicDepartment,
): Promise<void> {
  const enabled = await getTenantClinicDepartments(scope);
  if (!enabled.includes(department)) throw new Error("TENANT_DEPARTMENT_DISABLED");
}

function bindingAllowsDepartment(departmentIds: string[], department: ClinicDepartment): boolean {
  const normalized = departmentIds.map((value) => normalize(value).toLowerCase());
  return normalized.includes("all") || normalized.includes(department.toLowerCase());
}

/**
 * Clinician authority comes from tenant-scoped Supabase bindings. The legacy
 * staff sheet is used only to enrich a bound staff id with its display name.
 */
export async function getTenantClinicianOptions(
  context: AccessContext,
  scope: TenantScope,
): Promise<TenantClinicianOption[]> {
  const [enabledDepartments, bindings, directory] = await Promise.all([
    getTenantClinicDepartments(scope),
    listStoredStaffProvisioning(scope),
    getWebStaffDirectory().catch(() => []),
  ]);
  const directoryById = new Map(
    directory
      .filter((staff) => staff.status === "Active")
      .map((staff) => [staff.staffId.toLowerCase(), staff] as const),
  );
  const options: TenantClinicianOption[] = [];

  for (const binding of bindings) {
    if (binding.status !== "active") continue;
    const identity = directoryById.get(binding.staffId.toLowerCase());
    const fullName = normalize(identity?.fullName) || binding.staffId;

    if (
      binding.roleCodes.includes("therapist") &&
      enabledDepartments.includes("Physio") &&
      bindingAllowsDepartment(binding.departmentIds, "Physio") &&
      canPerform(context, "appointment.create", "Physio")
    ) {
      options.push({ staffId: binding.staffId, fullName, department: "Physio" });
    }
    if (
      binding.roleCodes.includes("dentist") &&
      enabledDepartments.includes("Dental") &&
      bindingAllowsDepartment(binding.departmentIds, "Dental") &&
      canPerform(context, "appointment.create", "Dental")
    ) {
      options.push({ staffId: binding.staffId, fullName, department: "Dental" });
    }
  }

  return options.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function resolveTenantClinicianAssignment(
  context: AccessContext,
  scope: TenantScope,
  department: ClinicDepartment,
  reference: unknown,
  options: { required?: boolean } = {},
): Promise<string> {
  const requested = normalize(reference);
  if (!requested) {
    if (options.required) throw new Error("INVALID_THERAPIST");
    return "";
  }

  const clinicians = await getTenantClinicianOptions(context, scope);
  const needle = requested.toLowerCase();
  const match = clinicians.find(
    (clinician) =>
      clinician.department === department &&
      (clinician.staffId.toLowerCase() === needle || clinician.fullName.toLowerCase() === needle),
  );
  if (!match) throw new Error("INVALID_THERAPIST");
  return match.fullName;
}
