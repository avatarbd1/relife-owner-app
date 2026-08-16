import { NextRequest, NextResponse } from "next/server";
import { validateUnifiedPhysioBooking } from "@/lib/domain/appointments/create";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { getBookingProfile } from "@/lib/webos/appointmentScheduling";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "APPOINTMENT_VALIDATE_FAILED";
  if (message === "ACCESS_DENIED") return NextResponse.json({ ok: false, error: message }, { status: 403 });
  if (message === "PATIENT_NOT_FOUND") return NextResponse.json({ ok: false, error: message }, { status: 404 });
  if (["INVALID_DATE", "INVALID_TIME"].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  if (["SCHEMA_MISMATCH", "SUPABASE_EDGE_SECRET_MISSING", "TENANT_NOT_FOUND"].includes(message)) {
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
    if (!patientId) return NextResponse.json({ ok: false, error: "PATIENT_NOT_FOUND" }, { status: 404 });

    if (!body.date || !body.time) {
      const profile = await getBookingProfile(context, patientId);
      return NextResponse.json({ ok: true, profile, validation: null });
    }

    const validation = await validateUnifiedPhysioBooking(context, {
      patientId,
      date: body.date,
      time: body.time,
      therapist: body.therapist,
      modalities: Array.isArray(body.modalities) ? body.modalities.map(String) : [],
      remarks: body.remarks,
    });
    return NextResponse.json({ ok: true, validation });
  } catch (error) {
    return errorResponse(error);
  }
}
