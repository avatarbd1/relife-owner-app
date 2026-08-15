import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { withMutationLock } from "@/lib/webos/mutationLock";
import { updatePatientProfile } from "@/lib/webos/patientUpdate";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "PATIENT_UPDATE_FAILED";
  if (message === "ACCESS_DENIED") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message === "PATIENT_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  if (message === "DUPLICATE_PHONE") {
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
  if (["INVALID_PATIENT_NAME", "NO_CHANGES"].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  if (message === "SCHEMA_MISMATCH") {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
  console.error("Patient update failed", error);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ patientId: string }> }
) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }

  try {
    const context = await requireCurrentAccessContext();
    const { patientId } = await params;
    const decodedPatientId = decodeURIComponent(patientId);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }

    const result = await withMutationLock(`patient-update:${decodedPatientId}`, () =>
      updatePatientProfile(context, decodedPatientId, {
        fullName: body.fullName,
        phone: body.phone,
        age: body.age,
        gender: body.gender,
        address: body.address,
        diagnosis: body.diagnosis,
        therapist: body.therapist,
        status: body.status,
      })
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
