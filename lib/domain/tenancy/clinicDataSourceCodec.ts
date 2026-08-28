import type { Workbook } from "@/lib/data/googleSheets";
import type { Department } from "@/lib/types";

/**
 * Pure encode/decode for the `sheets_workbook`/`patients` source_ref stored
 * in relife.clinic_data_sources. Kept dependency-free (like
 * lib/domain/tenancy/configurationCore.ts) so it is directly unit-testable
 * without a Supabase client or module-alias resolution.
 */
export interface SheetsPatientSource {
  organizationId: string;
  clinicId: string;
  workbook: Workbook;
  department: Department;
  legacyOrganizationId: string;
  legacyClinicId: string;
}

export interface SheetsPatientSourceRef {
  workbook: Workbook;
  department: "Physio" | "Dental";
  legacyOrganizationId: string;
  legacyClinicId: string;
}

export function encodeSheetsPatientSourceRef(ref: SheetsPatientSourceRef): string {
  return JSON.stringify(ref);
}

export function parseSheetsPatientSourceRef(
  organizationId: string,
  clinicId: string,
  ref: unknown
): SheetsPatientSource | null {
  let parsed: {
    workbook?: unknown;
    department?: unknown;
    legacyOrganizationId?: unknown;
    legacyClinicId?: unknown;
  };
  try {
    parsed = JSON.parse(String(ref));
  } catch {
    return null;
  }
  const workbook = parsed.workbook;
  const department = parsed.department;
  const legacyOrganizationId = String(parsed.legacyOrganizationId ?? "").trim();
  const legacyClinicId = String(parsed.legacyClinicId ?? "").trim();
  if (
    (workbook !== "physio" && workbook !== "dental") ||
    (department !== "Physio" && department !== "Dental") ||
    !legacyOrganizationId ||
    !legacyClinicId
  ) {
    return null;
  }
  return { organizationId, clinicId, workbook, department, legacyOrganizationId, legacyClinicId };
}
