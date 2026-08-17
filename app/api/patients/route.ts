import { NextRequest, NextResponse } from "next/server";
import { invalidatePatientsCache } from "@/lib/patients";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { consumePhysioInventorySystem } from "@/lib/webos/inventory";
import { withMutationLock } from "@/lib/webos/mutationLock";
import { registerPatient } from "@/lib/webos/reception";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

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

function normalizePhone(value: unknown): string {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("880")) digits = digits.slice(3);
  return digits;
}

function normalizeGender(value: unknown): string {
  return String(value ?? "").trim();
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }

  try {
    const context = await requireCurrentAccessContext();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }

    const department = String(body.department || "").trim();
    const gender = normalizeGender(body.gender);
    if (department === "Physio" && !["Male", "Female"].includes(gender)) {
      throw new Error("INVALID_PATIENT_GENDER");
    }

    const lockKey = `patient-register:${department || "unknown"}`;
    const result = await withMutationLock(lockKey, () =>
      registerPatient(context, {
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
    if (body.department === "Physio") {
      try {
        await consumePhysioInventorySystem(["Patient Card"], context.staffId, "Auto-Registration");
      } catch (error) {
        console.error("Patient saved but automatic inventory consumption failed", error);
      }
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
