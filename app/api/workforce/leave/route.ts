import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { listLeaveForContext, requestLeave } from "@/lib/domain/workforce/leave";

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "LEAVE_ACTION_FAILED";
  if (message === "ACCESS_DENIED") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message === "STAFF_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  if (message === "LEAVE_OVERLAP" || message === "WORKFORCE_REQUEST_ID_CONFLICT") {
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
  if (
    [
      "LEAVE_DEPARTMENT_INVALID",
      "LEAVE_TYPE_INVALID",
      "LEAVE_DATE_RANGE_INVALID",
      "WORKFORCE_REQUEST_ID_INVALID",
    ].includes(message)
  ) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  if (message === "WORKFORCE_SCHEMA_NOT_PROVISIONED" || message === "WORKFORCE_DATA_INVALID") {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
  console.error("Leave API failed", message);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export async function GET(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const context = await requireCurrentAccessContext();
    const leave = await listLeaveForContext(context);
    return NextResponse.json({ ok: true, leave });
  } catch (error) {
    return errorResponse(error);
  }
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
    const result = await requestLeave(context, {
      department: String(body.department || ""),
      leaveType: String(body.leaveType || ""),
      startDate: String(body.startDate || ""),
      endDate: String(body.endDate || ""),
      reason: body.reason,
      requestId: String(body.requestId || ""),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
