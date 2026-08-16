import { NextRequest, NextResponse } from "next/server";
import {
  createChamberScheduleBooking,
  validateChamberSchedule,
  type ChamberScheduleInput,
} from "@/lib/domain/chamber/scheduler";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

function errorResponse(error: unknown): NextResponse {
  const message =
    error instanceof Error ? error.message : "CHAMBER_SCHEDULE_FAILED";
  const validation = (error as Error & { validation?: unknown })?.validation;

  if (message === "ACCESS_DENIED") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message === "PATIENT_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  if (message.startsWith("APPOINTMENT_CONFLICT:")) {
    return NextResponse.json(
      {
        ok: false,
        error: "APPOINTMENT_CONFLICT",
        detail: message.split(":").slice(2).join(":"),
        validation,
      },
      { status: 409 }
    );
  }
  if (
    [
      "INVALID_DATE",
      "INVALID_TIME",
      "INVALID_SLOT",
      "INVALID_BED",
      "INVALID_THERAPIST",
    ].includes(message)
  ) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  if (message === "SCHEMA_MISMATCH") {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }

  console.error("Chamber schedule failed", error);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

function parseInput(body: Record<string, unknown>): ChamberScheduleInput {
  return {
    patientId: String(body.patientId || ""),
    date: String(body.date || ""),
    time: String(body.time || ""),
    therapist: String(body.therapist || ""),
    requestedBedId: String(body.requestedBedId || ""),
    modalities: Array.isArray(body.modalities) ? body.modalities.map(String) : [],
    remarks: String(body.remarks || ""),
  };
}

export async function chamberSchedulePost(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json(
      { ok: false, error: "Origin rejected" },
      { status: 403 }
    );
  }

  try {
    const context = await requireCurrentAccessContext();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { ok: false, error: "Invalid request" },
        { status: 400 }
      );
    }

    const record = body as Record<string, unknown>;
    const action = String(record.action || "validate");
    const input = parseInput(record);

    if (action === "validate") {
      const validation = await validateChamberSchedule(context, input);
      return NextResponse.json({ ok: true, validation });
    }
    if (action === "create") {
      const result = await createChamberScheduleBooking(context, input);
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json(
      { ok: false, error: "Unknown action" },
      { status: 400 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
