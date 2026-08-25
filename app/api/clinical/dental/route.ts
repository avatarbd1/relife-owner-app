import { NextRequest, NextResponse } from "next/server";
import { validateDepartmentAccess, validateTenantScope } from "@/lib/domain/tenancy/validators";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { addDentalTreatmentNote } from "@/lib/webos/dentalClinical";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { withMutationLock } from "@/lib/webos/mutationLock";

function statusFor(message: string): number {
  if (message === "ACCESS_DENIED") return 403;
  if (message === "PATIENT_NOT_FOUND") return 404;
  if (message === "CLINICAL_SCHEMA_MISMATCH") return 503;
  if (
    [
      "CLINICAL_DENTAL_ONLY",
      "DENTAL_PROCEDURE_REQUIRED",
      "DENTAL_NOTE_REQUIRED",
      "DENTAL_CHARGE_INVALID",
      "DENTAL_REQUEST_ID_INVALID",
      "DENTAL_STATUS_INVALID",
    ].includes(message)
  ) {
    return 400;
  }
  return 500;
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }

  try {
    // T2-02: Require full tenant-aware context for clinical operations
    const tenantContext = await requireCurrentTenantAccessContext();
    const { access, tenant } = tenantContext;
    validateDepartmentAccess(access, "Dental");
    validateTenantScope(access, tenant, "clinical.dental.create");
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }
    const patientId = String(body.patientId || "").trim();
    const result = await withMutationLock(`patient:Dental:${patientId}`, () =>
      addDentalTreatmentNote(access, tenant.organizationId, tenant.clinicId, {
        patientId,
        procedure: body.procedure,
        toothArea: body.toothArea,
        clinicalNote: body.clinicalNote,
        charge: Number(body.charge),
        status: body.status,
        requestId: body.requestId,
      })
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DENTAL_CLINICAL_FAILED";
    if (statusFor(message) === 500) console.error("Dental clinical write failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: statusFor(message) });
  }
}
