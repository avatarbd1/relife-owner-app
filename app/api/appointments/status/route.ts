import { NextRequest, NextResponse } from "next/server";
import { updateUnifiedAppointmentStatus } from "@/lib/domain/appointments/status";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { withMutationLock } from "@/lib/webos/mutationLock";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

function code(message: string): number {
  if (message === "ACCESS_DENIED") return 403;
  if (message === "APPOINTMENT_NOT_FOUND") return 404;
  if (["SCHEMA_MISMATCH", "SUPABASE_EDGE_SECRET_MISSING", "TENANT_NOT_FOUND"].includes(message)) {
    return 503;
  }
  if (["INVALID_DEPARTMENT", "INVALID_APPOINTMENT_STATUS", "DEPARTMENT_MISMATCH"].includes(message)) {
    return 400;
  }
  return 500;
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
    const appointmentId = String(body.appointmentId || "").trim();
    const lockKey = `appointment-update:${appointmentId}`;
    const result = await withMutationLock(lockKey, () =>
      updateUnifiedAppointmentStatus(context, {
        appointmentId,
        department: body.department,
        status: body.status,
      })
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "APPOINTMENT_STATUS_FAILED";
    if (code(message) === 500) console.error("Appointment status update failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: code(message) });
  }
}
