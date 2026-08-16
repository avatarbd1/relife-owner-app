import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import {
  createHourlyBedBooking,
  validateHourlyBedBooking,
} from "@/lib/webos/chamberHourlyBooking";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { withMutationLock } from "@/lib/webos/mutationLock";

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "CHAMBER_HOURLY_BOOKING_FAILED";
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
  console.error("Chamber hourly booking failed:", message);
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
    const action = String(body.action || "validate");
    const input = {
      patientId: String(body.patientId || ""),
      date: String(body.date || ""),
      time: String(body.time || ""),
      therapist: String(body.therapist || ""),
      remarks: String(body.remarks || ""),
      modalities: Array.isArray(body.modalities) ? body.modalities.map(String) : [],
      requestedBedId: String(body.requestedBedId || ""),
    };
    if (action === "validate") {
      const validation = await validateHourlyBedBooking(context, input);
      return NextResponse.json({ ok: true, validation });
    }
    if (action === "create") {
      const lockKey = `appointment-create:${input.date}`;
      const result = await withMutationLock(lockKey, () => createHourlyBedBooking(context, input));
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
