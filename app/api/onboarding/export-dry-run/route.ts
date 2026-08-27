import { NextRequest, NextResponse } from "next/server";
import { readClinicConfiguration } from "@/lib/data/clinicConfiguration";
import { validateTenantScope } from "@/lib/domain/tenancy/validators";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";

/**
 * F4 — portability capability preview.
 *
 * This endpoint does not claim to export data. It reports which canonical
 * export surfaces are available to the authenticated tenant and points to the
 * existing tenant-aware /api/export/csv writer. Unknown/unsupported surfaces
 * remain explicitly unavailable.
 */
export async function GET(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    const { access, tenant } = await requireCurrentTenantAccessContext();
    validateTenantScope(access, tenant, "clinic.manage");

    const configuration = await readClinicConfiguration({ organizationId: tenant.organizationId, clinicId: tenant.clinicId });
    const operational = canPerform(access, "report.read_operational", "Physio") || canPerform(access, "report.read_operational", "Dental");
    const financial = canPerform(access, "report.read_financial", "Physio") || canPerform(access, "report.read_financial", "Dental");
    const patientRead = canPerform(access, "patient.read", "Physio") || canPerform(access, "patient.read", "Dental");
    const appointmentRead = canPerform(access, "appointment.read", "Physio") || canPerform(access, "appointment.read", "Dental");
    const salaryRead = canPerform(access, "salary.read", "Physio") || canPerform(access, "salary.read", "Dental");

    const surfaces = {
      patients: { supported: operational && patientRead, canonicalEndpoint: "/api/export/csv?types=patients" },
      appointments: { supported: operational && appointmentRead, canonicalEndpoint: "/api/export/csv?types=appointments" },
      payments: { supported: financial, canonicalEndpoint: "/api/export/csv?types=payments" },
      expenses: { supported: financial, canonicalEndpoint: "/api/export/csv?types=expenses" },
      salary: { supported: financial && salaryRead, canonicalEndpoint: "/api/export/csv?types=salary" },
      services: { supported: Boolean(configuration.profile), canonicalEndpoint: null, reason: "configuration portability foundation only; no service CSV writer yet" },
      staff: { supported: false, canonicalEndpoint: null, reason: "tenant-safe staff portability writer not yet exposed" },
      reports: { supported: false, canonicalEndpoint: null, reason: "generated reports are not treated as canonical tenant data export" },
    };

    return NextResponse.json({
      ok: true,
      dryRun: true,
      organizationId: tenant.organizationId,
      clinicId: tenant.clinicId,
      surfaces,
      rollback: {
        supported: false,
        reason: "export is read-only; provisioning rollback evidence is provided separately by /api/onboarding/provisioning-dry-run",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "EXPORT_DRY_RUN_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: /ACCESS|TENANT_SCOPE/.test(message) ? 403 : 500 });
  }
}
