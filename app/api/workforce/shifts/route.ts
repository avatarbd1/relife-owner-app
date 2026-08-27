import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { createShift, listShiftsForContext } from "@/lib/domain/workforce/shifts";

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "SHIFT_ACTION_FAILED";
  if (message === "ACCESS_DENIED") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message === "STAFF_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  if (message === "SHIFT_OVERLAP" || message === "WORKFORCE_REQUEST_ID_CONFLICT") {
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
  if (
    [
      "SHIFT_DEPARTMENT_INVALID",
      "SHIFT_DATE_INVALID",
      "SHIFT_TIME_RANGE_INVALID",
      "WORKFORCE_REQUEST_ID_INVALID",
    ].includes(message)
  ) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  if (message === "WORKFORCE_SCHEMA_NOT_PROVISIONED" || message === "WORKFORCE_DATA_INVALID") {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
  console.error("Shift API failed", message);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export async function GET(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const tenantContext = await requireCurrentTenantAccessContext();
    const shifts = await listShiftsForContext(tenantContext.access);
    return NextResponse.json({ ok: true, shifts });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const tenantContext = await requireCurrentTenantAccessContext();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }
    const result = await createShift(
      tenantContext.access,
      tenantContext.tenant.organizationId,
      tenantContext.tenant.clinicId,
      {
        staffId: String(body.staffId || ""),
        department: String(body.department || ""),
        shiftDate: String(body.shiftDate || ""),
        startTime: String(body.startTime || ""),
        endTime: String(body.endTime || ""),
        notes: body.notes,
        requestId: String(body.requestId || ""),
      }
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
