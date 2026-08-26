import { NextRequest, NextResponse } from "next/server";
import { updateUnifiedAppointmentStatus } from "@/lib/domain/appointments/status";
import { validateTenantScope } from "@/lib/domain/tenancy/validators";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { withMutationLock } from "@/lib/webos/mutationLock";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

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
    // T2-02: Require full tenant-aware context for appointment operations
    const tenantContext = await requireCurrentTenantAccessContext();
    const { access, tenant } = tenantContext;
    validateTenantScope(access, tenant, "appointment.status");
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }
    const appointmentId = String(body.appointmentId || "").trim();
    const lockKey = `appointment-update:${appointmentId}`;
    const result = await withMutationLock(lockKey, () =>
      updateUnifiedAppointmentStatus(access, tenant.organizationId, tenant.clinicId, {
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
