import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { cancelLeave } from "@/lib/domain/workforce/leave";

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "LEAVE_CANCEL_FAILED";
  if (message === "ACCESS_DENIED") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message === "LEAVE_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  if (message === "LEAVE_INVALID_TRANSITION" || message === "WORKFORCE_REQUEST_ID_CONFLICT") {
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
  if (message === "WORKFORCE_REQUEST_ID_INVALID") {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  if (message === "WORKFORCE_SCHEMA_NOT_PROVISIONED" || message === "WORKFORCE_DATA_INVALID") {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
  console.error("Leave cancel API failed", message);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leaveId: string }> }
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
    const result = await cancelLeave(context, {
      leaveId: decodeURIComponent(routeParams.leaveId),
      requestId: String(body?.requestId || ""),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
