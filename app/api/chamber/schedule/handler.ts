import { NextRequest, NextResponse } from "next/server";
import {
  createCapacityBooking,
  validateCapacityBooking,
  type CapacityBookingInput,
} from "@/lib/domain/appointments/capacityBooking";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { assertCanPerform } from "@/lib/webos/access";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { withMutationLock } from "@/lib/webos/mutationLock";

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
  if (["INVALID_DATE", "INVALID_TIME", "INVALID_SLOT"].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  if (message === "SCHEMA_MISMATCH") {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }

  console.error("Chamber schedule compatibility route failed", error);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

function parseInput(body: Record<string, unknown>): CapacityBookingInput {
  return {
    patientId: String(body.patientId || ""),
    date: String(body.date || ""),
    time: String(body.time || ""),
    therapist: String(body.therapist || ""),
    remarks: String(body.remarks || ""),
  };
}

/**
 * Compatibility HTTP boundary for old Chamber booking clients.
 *
 * Physio booking owns only booking intent and automatic gender/capacity safety.
 * requestedBedId, modalities and machine timing from legacy clients are
 * intentionally ignored: general beds and machines are allocated at live
 * operation time, not at booking time.
 */
export async function chamberSchedulePost(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json(
      { ok: false, error: "Origin rejected" },
      { status: 403 }
    );
  }

  try {
    const tenantContext = await requireCurrentTenantAccessContext();
    assertCanPerform(tenantContext.access, "appointment.create", "Physio");

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
      const validation = await validateCapacityBooking(
        tenantContext.access,
        tenantContext.tenant.organizationId,
        tenantContext.tenant.clinicId,
        input
      );
      return NextResponse.json({ ok: true, validation });
    }

    if (action === "create") {
      const result = await withMutationLock(
        `capacity-booking:${input.date}`,
        () => createCapacityBooking(
          tenantContext.access,
          tenantContext.tenant.organizationId,
          tenantContext.tenant.clinicId,
          input
        )
      );
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json(
      { ok: false, error: "INVALID_ACTION" },
      { status: 400 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
