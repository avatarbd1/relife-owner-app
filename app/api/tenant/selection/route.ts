import { NextRequest, NextResponse } from "next/server";
import { resolveStaffTenantContexts } from "@/lib/domain/tenancy/staffTenantContext";
import { requireTenantScope } from "@/lib/domain/tenancy/policy";
import { ACTIVE_TENANT_COOKIE, serializeTenantSelection } from "@/lib/domain/tenancy/tenantSelection";
import { getCurrentStaffIdentity } from "@/lib/webos/currentUser";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "TENANT_SELECTION_FAILED";
  const status = /ACCESS|AUTHORIZED|TENANT_(SCOPE|SELECTION|BINDING)/.test(message) ? 403 : 503;
  return NextResponse.json({ ok: false, error: message }, { status });
}
async function requireOwner() {
  const identity = await getCurrentStaffIdentity();
  if (!identity || !identity.roles.includes("Owner")) throw new Error("TENANT_SELECTION_NOT_AUTHORIZED");
  return identity;
}

export async function GET() {
  try {
    const identity = await requireOwner();
    const resolution = await resolveStaffTenantContexts(identity.staffId);
    return NextResponse.json({ ok: true, selected: resolution.selected, available: resolution.available });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    const identity = await requireOwner();
    const body = await request.json().catch(() => ({}));
    const scope = requireTenantScope({
      organizationId: typeof body.organizationId === "string" ? body.organizationId : "",
      clinicId: typeof body.clinicId === "string" ? body.clinicId : "",
    });
    const resolution = await resolveStaffTenantContexts(identity.staffId, scope);
    const response = NextResponse.json({ ok: true, selected: resolution.selected });
    response.cookies.set(ACTIVE_TENANT_COOKIE, serializeTenantSelection(scope), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  } catch (error) {
    return failure(error);
  }
}
