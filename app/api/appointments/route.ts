import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { withMutationLock } from "@/lib/webos/mutationLock";
import { createAppointment } from "@/lib/webos/reception";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

function errorResponse(error: unknown): NextResponse {
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
  if (message.startsWith("APPOINTMENT_CAPACITY:")) {
    return NextResponse.json(
      { ok: false, error: "APPOINTMENT_CAPACITY", detail: message.split(":").slice(1).join(":") },
      { status: 409 }
    );
  }
  if (["INVALID_DATE", "INVALID_TIME", "INVALID_THERAPIST"].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  if (message === "SCHEMA_MISMATCH") {
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

    const lockKey = `appointment-create:${String(body.date || "")}:${String(body.time || "")}`;
    const result = await withMutationLock(lockKey, () =>
      createAppointment(context, {
        patientId: body.patientId,
        date: body.date,
        time: body.time,
        therapist: body.therapist,
        remarks: body.remarks,
      })
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
