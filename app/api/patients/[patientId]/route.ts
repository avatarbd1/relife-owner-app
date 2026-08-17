import { NextRequest, NextResponse } from "next/server";
import { invalidatePatientsCache } from "@/lib/patients";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { withMutationLock } from "@/lib/webos/mutationLock";
import { updatePatientProfile } from "@/lib/webos/patientUpdate";
import { syncActiveChamberPatientProfile } from "@/lib/webos/chamberPatientProfile";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { getPatientForContext } from "@/lib/webos/reception";

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

    const patient = await getPatientForContext(context, decodedPatientId);
    if (!patient || patient.department === "All") {
      return NextResponse.json({ ok: false, error: "PATIENT_NOT_FOUND" }, { status: 404 });
    }

    const result = await withMutationLock(`patient:${patient.department}:${decodedPatientId}`, () =>
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
    invalidatePatientsCache();

    let chamberSynced = true;
    try {
      chamberSynced = await syncActiveChamberPatientProfile(context.staffId, decodedPatientId, {
        fullName: body.fullName,
        gender: body.gender,
      });
    } catch (error) {
      chamberSynced = false;
      console.error("Patient updated but active chamber profile sync failed", error);
    }

    return NextResponse.json({ ok: true, ...result, chamberSynced });
  } catch (error) {
    return errorResponse(error);
  }
}
