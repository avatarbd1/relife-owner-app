import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { undoShiftStatus } from "@/lib/domain/workforce/shiftUndo";

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "SHIFT_UNDO_FAILED";
  if (message === "ACCESS_DENIED") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message === "SHIFT_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  if (["SHIFT_UNDO_CONFLICT", "SHIFT_LEAVE_CONFLICT", "WORKFORCE_REQUEST_ID_CONFLICT"].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
  if (["SHIFT_UNDO_INVALID", "WORKFORCE_REQUEST_ID_INVALID"].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  if (["WORKFORCE_SCHEMA_NOT_PROVISIONED", "WORKFORCE_DATA_INVALID"].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
  console.error("Shift undo API failed", message);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export async function POST(
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
    const result = await undoShiftStatus(context, {
      shiftId: decodeURIComponent(routeParams.shiftId),
      expectedCurrentStatus: String(body?.expectedCurrentStatus || ""),
      restoreStatus: String(body?.restoreStatus || ""),
      requestId: String(body?.requestId || ""),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
