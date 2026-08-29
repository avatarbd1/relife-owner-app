import { NextRequest, NextResponse } from "next/server";
import { isRelifeLegacyTenant } from "@/lib/config/relifeSystem";
import { recordActorWorkGamification } from "@/lib/domain/gamification/events";
import { hasTenantFeature } from "@/lib/domain/tenancy/featureGuard";
import { invalidatePatientsCache } from "@/lib/patients";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { consumePhysioInventorySystem } from "@/lib/webos/inventory";
import { withMutationLock } from "@/lib/webos/mutationLock";
import { registerPatientSerial } from "@/lib/webos/registerPatientSerial";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { validateDepartmentAccess } from "@/lib/domain/tenancy/validators";

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "PATIENT_CREATE_FAILED";
  if (message === "ACCESS_DENIED") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message.startsWith("DUPLICATE_PHONE:")) {
    return NextResponse.json(
      { ok: false, error: "DUPLICATE_PHONE", patientId: message.split(":")[1] || "" },
      { status: 409 }
    );
  }
  if (["INVALID_DEPARTMENT", "INVALID_PATIENT_NAME", "INVALID_PATIENT_GENDER"].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  if (message === "SCHEMA_MISMATCH") {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
  console.error("Patient registration failed:", message);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

function normalizeGender(value: unknown): string {
  return String(value ?? "").trim();
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }

  try {
    const tenantContext = await requireCurrentTenantAccessContext();
    const { access, tenant } = tenantContext;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }

    const department = String(body.department || "").trim();
    const gender = normalizeGender(body.gender);
    validateDepartmentAccess(access, department as "Physio" | "Dental");

    if (department === "Physio" && !["Male", "Female"].includes(gender)) {
      throw new Error("INVALID_PATIENT_GENDER");
    }

    const lockKey = `patient-register:${tenant.organizationId}:${tenant.clinicId}:${department || "unknown"}`;
    const result = await withMutationLock(lockKey, () =>
      registerPatientSerial(access, tenant.organizationId, tenant.clinicId, {
        department: body.department,
        fullName: body.fullName,
        fatherHusbandName: body.fatherHusbandName,
        phone: body.phone,
        alternativePhone: body.alternativePhone,
        age: body.age,
        gender: body.gender,
        address: body.address,
        diagnosis: body.diagnosis,
        therapist: body.therapist,
        referral: body.referral,
        remarks: body.remarks,
      })
    );
    invalidatePatientsCache();
    const legacyInventoryEnabled =
      department === "Physio" &&
      isRelifeLegacyTenant(tenant) &&
      await hasTenantFeature(tenant, "optional.inventory");
    if (legacyInventoryEnabled) {
      try {
        await consumePhysioInventorySystem(["Patient Card"], access.staffId, tenant.organizationId, tenant.clinicId, "Auto-Registration");
      } catch (error) {
        console.error("Patient saved but automatic inventory consumption failed", error);
      }
    }

    if (department === "Physio" || department === "Dental") {
      await recordActorWorkGamification({
        tenant,
        context: access,
        department,
        purpose: "reception",
        eventType: "patient_registered",
        eventKey: `patient:${department}:${result.patientId}:registered:v2`,
        sourceType: "patient_registration",
        sourceId: result.patientId,
        eventAt: new Date().toISOString(),
        reason: "Verified patient registration",
        verificationMethod: "canonical_patient_registration",
        payload: {
          patientId: result.patientId,
          department,
          phonePresent: Boolean(String(body.phone || "").trim()),
        },
      });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
