import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/data/supabaseAdmin";
import {
  parseSheetsPatientSourceRef,
  type SheetsPatientSource,
} from "@/lib/domain/tenancy/clinicDataSourceCodec";
import type { Department } from "@/lib/types";

/**
 * relife.clinic_data_sources is the generic, per-clinic registry for legacy
 * Sheets/storage identities (see docs/CANONICAL_PATH_REGISTRY.md and the
 * Phase A configuration foundation migration). This module is the first real
 * consumer of that table: it replaces hardcoded Relife literals with
 * clinic-owned configuration so any clinic — Relife's Physio department
 * included — can register a legacy source without a new code branch.
 *
 * The table itself is never seeded by a migration ("a migration must never
 * decide which clinic gets what" — phase_a_clinic_configuration_foundation
 * .sql). Rows are registered by the owner-approved scripts under
 * scripts/sql/relife-physio-clinic-data-sources-*.sql.
 */

export type { SheetsPatientSource };

function adminClient(): SupabaseClient {
  try {
    return createSupabaseAdminClient();
  } catch {
    throw new Error("CLINIC_DATA_SOURCES_STORE_UNAVAILABLE");
  }
}

/**
 * Every clinic's registered legacy-Sheets patient identity, generically.
 * Used to source `lib/patients.ts` without a per-tenant hardcoded literal.
 */
export async function listActiveSheetsPatientSources(
  client = adminClient()
): Promise<SheetsPatientSource[]> {
  const result = await client
    .schema("relife")
    .from("clinic_data_sources")
    .select("organization_id,clinic_id,source_ref")
    .eq("source_kind", "sheets_workbook")
    .eq("source_role", "patients")
    .eq("status", "active");
  if (result.error) {
    throw new Error(`CLINIC_DATA_SOURCES_READ_FAILED:${result.error.message}`);
  }
  return (result.data || []).flatMap((row: Record<string, unknown>) => {
    const source = parseSheetsPatientSourceRef(
      String(row.organization_id),
      String(row.clinic_id),
      row.source_ref
    );
    return source ? [source] : [];
  });
}

/**
 * One tenant's registered legacy-Sheets patient sources, keyed by department.
 * Powers the generic compatibility bridge in `lib/webos/reception.ts` — a
 * tenant with no registered row here gets no bridge matching (fails closed,
 * same as any non-legacy clinic).
 */
export async function resolveTenantSheetsPatientSources(
  organizationId: string,
  clinicId: string,
  client = adminClient()
): Promise<Partial<Record<Department, { legacyOrganizationId: string; legacyClinicId: string }>>> {
  const result = await client
    .schema("relife")
    .from("clinic_data_sources")
    .select("source_ref")
    .eq("organization_id", organizationId)
    .eq("clinic_id", clinicId)
    .eq("source_kind", "sheets_workbook")
    .eq("source_role", "patients")
    .eq("status", "active");
  if (result.error) {
    throw new Error(`CLINIC_DATA_SOURCES_READ_FAILED:${result.error.message}`);
  }
  const byDepartment: Partial<Record<Department, { legacyOrganizationId: string; legacyClinicId: string }>> = {};
  for (const row of (result.data || []) as Record<string, unknown>[]) {
    const source = parseSheetsPatientSourceRef(organizationId, clinicId, row.source_ref);
    if (source) {
      byDepartment[source.department] = {
        legacyOrganizationId: source.legacyOrganizationId,
        legacyClinicId: source.legacyClinicId,
      };
    }
  }
  return byDepartment;
}

/**
 * Every clinic's registered legacy patient-report storage prefix. Lets
 * `supabase/functions/relife-report-storage` admit a new clinic's uploads
 * without adding its prefix to the function's hardcoded literal check.
 */
export async function listActiveStoragePrefixes(client = adminClient()): Promise<string[]> {
  const result = await client
    .schema("relife")
    .from("clinic_data_sources")
    .select("source_ref")
    .eq("source_kind", "storage_prefix")
    .eq("source_role", "patient_reports")
    .eq("status", "active");
  if (result.error) {
    throw new Error(`CLINIC_DATA_SOURCES_READ_FAILED:${result.error.message}`);
  }
  return ((result.data || []) as Record<string, unknown>[])
    .map((row) => String(row.source_ref).trim())
    .filter(Boolean);
}
