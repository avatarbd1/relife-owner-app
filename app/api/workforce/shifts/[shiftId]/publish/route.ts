import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { publishShift } from "@/lib/domain/workforce/shifts";

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "SHIFT_PUBLISH_FAILED";
  if (message === "ACCESS_DENIED") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message === "SHIFT_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  if (message === "SHIFT_INVALID_TRANSITION" || message === "SHIFT_LEAVE_CONFLICT" || message === "WORKFORCE_REQUEST_ID_CONFLICT") {
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
  if (message === "WORKFORCE_REQUEST_ID_INVALID") {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  if (message === "WORKFORCE_SCHEMA_NOT_PROVISIONED" || message === "WORKFORCE_DATA_INVALID") {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
  console.error("Shift publish API failed", message);
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
    const [tenantContext, routeParams, body] = await Promise.all([
      requireCurrentTenantAccessContext(),
      params,
      request.json().catch(() => ({})),
    ]);
    const result = await publishShift(
      tenantContext.access,
      tenantContext.tenant.organizationId,
      tenantContext.tenant.clinicId,
      {
        shiftId: decodeURIComponent(routeParams.shiftId),
        requestId: String(body?.requestId || ""),
      }
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
