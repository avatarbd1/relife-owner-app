import { NextRequest, NextResponse } from "next/server";
import { createUnifiedPhysioBooking } from "@/lib/domain/appointments/create";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import type { BookingValidationResult } from "@/lib/webos/appointmentScheduling";
import { assertCanPerform } from "@/lib/webos/access";
import { withMutationLock } from "@/lib/webos/mutationLock";
import { createAppointment, getPatientForContext } from "@/lib/webos/reception";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

function errorResponse(error: unknown): NextResponse {
  const typed = error as Error & { validation?: BookingValidationResult };
  const message = error instanceof Error ? error.message : "APPOINTMENT_CREATE_FAILED";
  if (message === "ACCESS_DENIED") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message === "PATIENT_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  if (message === "APPOINTMENT_DUPLICATE") {
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
  if (message.startsWith("APPOINTMENT_CONFLICT:")) {
    const [, type, ...detailParts] = message.split(":");
    return NextResponse.json(
      {
        ok: false,
        error: "APPOINTMENT_CONFLICT",
        conflictType: type || "other",
        detail: detailParts.join(":") || "Booking conflict",
        validation: typed.validation,
      },
      { status: 409 }
    );
  }
  if (message.startsWith("APPOINTMENT_CAPACITY:")) {
    return NextResponse.json(
      { ok: false, error: "APPOINTMENT_CAPACITY", detail: message.split(":").slice(1).join(":") },
      { status: 409 }
    );
  }
  if (["INVALID_DATE", "INVALID_TIME", "INVALID_THERAPIST", "INVALID_REQUEST_ID"].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  if (["SCHEMA_MISMATCH", "SUPABASE_EDGE_SECRET_MISSING", "TENANT_NOT_FOUND"].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
  console.error("Appointment creation failed:", message);
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
    const patient = await getPatientForContext(context, String(body.patientId || ""));
    if (!patient || patient.department === "All") {
      return NextResponse.json({ ok: false, error: "PATIENT_NOT_FOUND" }, { status: 404 });
    }

    assertCanPerform(context, "appointment.create", patient.department);

    const lockKey = `appointment-create:${String(body.date || "")}`;
    const result = await withMutationLock(lockKey, () => {
      if (patient.department === "Physio") {
        return createUnifiedPhysioBooking(context, {
          patientId: patient.patientId,
          date: body.date,
          time: body.time,
          therapist: body.therapist,
          remarks: body.remarks,
          modalities: Array.isArray(body.modalities) ? body.modalities.map(String) : [],
          requestId: body.requestId,
        });
      }
      return createAppointment(context, {
        patientId: patient.patientId,
        date: body.date,
        time: body.time,
        therapist: body.therapist,
        remarks: body.remarks,
      });
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
