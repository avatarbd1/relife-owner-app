import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { deactivateManagedStaff } from "@/lib/webos/staffManagement";

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "STAFF_DEACTIVATE_FAILED";
  if (message === "ACCESS_DENIED" || message === "OWNER_PROFILE_IMMUTABLE") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message === "STAFF_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  if (message === "STAFF_SCHEMA_MISMATCH") {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
  if (message === "STAFF_ID_REQUIRED") {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  console.error("Staff deactivate API failed", message);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ staffId: string }> }
) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }

  try {
    const [tenantContext, routeParams] = await Promise.all([
      requireCurrentTenantAccessContext(),
      params,
    ]);
    const result = await deactivateManagedStaff(
      tenantContext.access,
      tenantContext.tenant.organizationId,
      tenantContext.tenant.clinicId,
      decodeURIComponent(routeParams.staffId)
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
