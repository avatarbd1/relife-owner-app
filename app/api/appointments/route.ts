import { NextRequest, NextResponse } from "next/server";
import {
  createCapacityBooking,
  type CapacityBookingValidation,
} from "@/lib/domain/appointments/capacityBooking";
import { recordActorWorkGamification } from "@/lib/domain/gamification/events";
import { validateDepartmentAccess, validateTenantScope } from "@/lib/domain/tenancy/validators";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { assertCanPerform } from "@/lib/webos/access";
import { withMutationLock } from "@/lib/webos/mutationLock";
import { createAppointment, getPatientForContext } from "@/lib/webos/reception";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

function errorResponse(error: unknown): NextResponse {
  const typed = error as Error & { validation?: CapacityBookingValidation };
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
      {
        ok: false,
        error: "APPOINTMENT_CAPACITY",
        detail: message.split(":").slice(1).join(":"),
      },
      { status: 409 }
    );
  }
  if (["INVALID_DATE", "INVALID_TIME", "INVALID_SLOT", "INVALID_THERAPIST", "INVALID_REQUEST_ID"].includes(message)) {
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
    // T2-02: Require full tenant-aware context for appointment operations
    const tenantContext = await requireCurrentTenantAccessContext();
    const { access, tenant } = tenantContext;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }
    const patient = await getPatientForContext(access, String(body.patientId || ""));
    if (!patient || patient.department === "All") {
      return NextResponse.json({ ok: false, error: "PATIENT_NOT_FOUND" }, { status: 404 });
    }

    // Validate staff has access to this patient's department
    validateDepartmentAccess(access, patient.department);
    validateTenantScope(access, tenant, "appointment.create");

    assertCanPerform(access, "appointment.create", patient.department);

    const isPhysio = patient.department === "Physio";
    const lockKey = isPhysio
      ? `capacity-booking:${String(body.date || "")}`
      : `appointment-create:${String(body.date || "")}`;

    const result = await withMutationLock(lockKey, () => {
      if (isPhysio) {
        return createCapacityBooking(access, tenant.organizationId, tenant.clinicId, {
          patientId: patient.patientId,
          date: String(body.date || ""),
          time: String(body.time || ""),
          therapist: String(body.therapist || ""),
          remarks: String(body.remarks || ""),
        });
      }
      return createAppointment(access, tenant.organizationId, tenant.clinicId, {
        patientId: patient.patientId,
        date: body.date,
        time: body.time,
        therapist: body.therapist,
        remarks: body.remarks,
      });
    });

    await recordActorWorkGamification({
      context: access,
      department: patient.department,
      purpose: "reception",
      eventType: "appointment_booked",
      eventKey: `appointment:${patient.department}:${result.appointmentId}:booked:v2`,
      sourceType: "appointment_create",
      sourceId: result.appointmentId,
      eventAt: new Date().toISOString(),
      reason: "Verified appointment booking",
      verificationMethod: "canonical_appointment_create",
      payload: {
        appointmentId: result.appointmentId,
        patientId: patient.patientId,
        appointmentDate: String(body.date || "").trim(),
        therapistReference: String(body.therapist || "").trim(),
      },
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
