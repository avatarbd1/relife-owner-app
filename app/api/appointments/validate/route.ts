import { NextRequest, NextResponse } from "next/server";
import { validateCapacityBooking } from "@/lib/domain/appointments/capacityBooking";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "APPOINTMENT_VALIDATE_FAILED";
  if (message === "ACCESS_DENIED") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message === "PATIENT_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  if (["INVALID_DATE", "INVALID_TIME", "INVALID_SLOT"].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  if (message === "SCHEMA_MISMATCH") {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
  console.error("Appointment validation failed:", message);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
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

    const patientId = String(body.patientId || "").trim();
    if (!patientId) {
      return NextResponse.json({ ok: false, error: "PATIENT_NOT_FOUND" }, { status: 404 });
    }

    // Legacy callers used this endpoint to load modality suggestions before a
    // booking. Operation demand is no longer a booking concern, so keep a
    // harmless empty compatibility profile instead of exposing machine planning.
    if (!body.date || !body.time) {
      return NextResponse.json({
        ok: true,
        profile: {
          suggestedModalities: [],
          needsTraction: false,
          modalityOptions: [],
        },
        validation: null,
      });
    }

    const validation = await validateCapacityBooking(context, {
      patientId,
      date: String(body.date || ""),
      time: String(body.time || ""),
      therapist: String(body.therapist || ""),
      remarks: String(body.remarks || ""),
    });
    return NextResponse.json({ ok: true, validation });
  } catch (error) {
    return errorResponse(error);
  }
}
