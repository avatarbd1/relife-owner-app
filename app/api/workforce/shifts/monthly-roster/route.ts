import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { applyMonthlyRoster, previewMonthlyRoster } from "@/lib/domain/workforce/shifts";

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "ROSTER_ACTION_FAILED";
  if (message === "ACCESS_DENIED") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message === "ROSTER_CONFLICT" || message === "WORKFORCE_REQUEST_ID_CONFLICT") {
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
  if (message === "ROSTER_MONTH_INVALID" || message === "WORKFORCE_REQUEST_ID_INVALID") {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  if (
    message === "WORKFORCE_SCHEMA_NOT_PROVISIONED" ||
    message === "WORKFORCE_DATA_INVALID" ||
    message.startsWith("ROSTER_STAFF_")
  ) {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
  console.error("Monthly roster API failed", message);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export async function GET(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const tenantContext = await requireCurrentTenantAccessContext();
    const preview = await previewMonthlyRoster(
      tenantContext.access,
      tenantContext.tenant.organizationId,
      tenantContext.tenant.clinicId,
      String(request.nextUrl.searchParams.get("month") || "")
    );
    return NextResponse.json({ ok: true, preview });
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
    const result = await applyMonthlyRoster(
      tenantContext.access,
      tenantContext.tenant.organizationId,
      tenantContext.tenant.clinicId,
      {
        month: String(body.month || ""),
        requestId: String(body.requestId || ""),
      }
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
