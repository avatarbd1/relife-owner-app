import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { getCurrentStaffIdentity, requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { updateOwnProfile } from "@/lib/webos/profileSettings";

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "PROFILE_UPDATE_FAILED";
  if (message === "ACCESS_DENIED") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message === "PROFILE_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  if (message === "PROFILE_PHONE_DUPLICATE") {
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
  if (["PROFILE_NAME_REQUIRED", "INVALID_PROFILE_PHONE"].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  if (message === "PROFILE_SCHEMA_MISMATCH") {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
  console.error("Profile settings API failed", message);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export async function GET() {
  try {
    const identity = await getCurrentStaffIdentity();
    if (!identity) {
      return NextResponse.json({ ok: false, error: "ACCESS_DENIED" }, { status: 403 });
    }
    return NextResponse.json({
      ok: true,
      profile: {
        staffId: identity.staffId,
        fullName: identity.fullName,
        phone: identity.phone,
        roles: identity.roles,
        departments: identity.departmentAccess,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }

  try {
    const { access, tenant } = await requireCurrentTenantAccessContext();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }

    const profile = await updateOwnProfile(
      access,
      tenant.organizationId,
      tenant.clinicId,
      {
        fullName: String(body.fullName || ""),
        phone: String(body.phone || ""),
      }
    );
    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    return errorResponse(error);
  }
}
