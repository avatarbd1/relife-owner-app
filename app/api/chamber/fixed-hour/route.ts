import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { createFixedHourBooking, validateFixedHourBooking } from "@/lib/webos/chamberFixedHour";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { withMutationLock } from "@/lib/webos/mutationLock";

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "CHAMBER_FIXED_HOUR_FAILED";
  const validation = (error as Error & { validation?: unknown })?.validation;
  if (message === "ACCESS_DENIED") return NextResponse.json({ ok: false, error: message }, { status: 403 });
  if (message === "PATIENT_NOT_FOUND") return NextResponse.json({ ok: false, error: message }, { status: 404 });
  if (message.startsWith("APPOINTMENT_CONFLICT:")) {
    return NextResponse.json({ ok: false, error: "APPOINTMENT_CONFLICT", detail: message.split(":").slice(2).join(":"), validation }, { status: 409 });
  }
  if (["INVALID_DATE", "INVALID_TIME", "INVALID_SLOT", "INVALID_BED", "INVALID_THERAPIST"].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  if (message === "SCHEMA_MISMATCH") return NextResponse.json({ ok: false, error: message }, { status: 503 });
  console.error("Fixed-hour Chamber booking failed", error);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const context = await requireCurrentAccessContext();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    const action = String(body.action || "validate");
    const input = {
      patientId: String(body.patientId || ""),
      date: String(body.date || ""),
      time: String(body.time || ""),
      therapist: String(body.therapist || ""),
      requestedBedId: String(body.requestedBedId || ""),
      modalities: Array.isArray(body.modalities) ? body.modalities.map(String) : [],
      remarks: String(body.remarks || ""),
    };
    if (action === "validate") {
      const validation = await validateFixedHourBooking(context, input);
      return NextResponse.json({ ok: true, validation });
    }
    if (action === "create") {
      const result = await withMutationLock(`appointment-create:${input.date}`, () => createFixedHourBooking(context, input));
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
