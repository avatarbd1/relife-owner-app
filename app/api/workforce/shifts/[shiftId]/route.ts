import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { updateShift } from "@/lib/domain/workforce/shifts";

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "SHIFT_UPDATE_FAILED";
  if (message === "ACCESS_DENIED") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message === "SHIFT_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  if (["SHIFT_OVERLAP", "SHIFT_INVALID_TRANSITION", "WORKFORCE_REQUEST_ID_CONFLICT"].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
  if (["SHIFT_DATE_INVALID", "SHIFT_TIME_RANGE_INVALID", "WORKFORCE_REQUEST_ID_INVALID"].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  if (message === "WORKFORCE_SCHEMA_NOT_PROVISIONED" || message === "WORKFORCE_DATA_INVALID") {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
  console.error("Shift update API failed", message);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ shiftId: string }> }
) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const [context, routeParams, body] = await Promise.all([
      requireCurrentAccessContext(),
      params,
      request.json().catch(() => ({})),
    ]);
    const result = await updateShift(context, {
      shiftId: decodeURIComponent(routeParams.shiftId),
      shiftDate: String(body?.shiftDate || ""),
      startTime: String(body?.startTime || ""),
      endTime: String(body?.endTime || ""),
      notes: body?.notes,
      requestId: String(body?.requestId || ""),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
