import { NextRequest, NextResponse } from "next/server";
import { createStaffEnrollmentToken, STAFF_ENROLL_MAX_AGE } from "@/lib/staffEnrollment";
import { listPasskeysForStaff, webauthnConfig } from "@/lib/webauthn";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { getCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { toAccessContext } from "@/lib/webos/staffDirectory";
import { getTenantScopedWebStaffIdentity } from "@/lib/webos/tenantStaffDirectory";

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }

  const current = await getCurrentTenantAccessContext();
  if (!current || !current.access.roles.includes("Owner")) {
    return NextResponse.json({ ok: false, error: "Owner access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const staffId = typeof body?.staffId === "string" ? body.staffId.trim() : "";
  if (!staffId) {
    return NextResponse.json({ ok: false, error: "Staff ID required" }, { status: 400 });
  }

  try {
    const staff = await getTenantScopedWebStaffIdentity(staffId, current.tenant);
    if (!staff || !toAccessContext(staff)) {
      return NextResponse.json(
        { ok: false, error: "Staff access profile is incomplete or inactive" },
        { status: 400 }
      );
    }

    const passkeys = await listPasskeysForStaff(staff.staffId);
    const token = createStaffEnrollmentToken(staff.staffId, passkeys.length, current.tenant);
    const setupUrl = new URL("/staff-setup", webauthnConfig().origin);
    setupUrl.searchParams.set("token", token);

    return NextResponse.json({
      ok: true,
      staff: {
        staffId: staff.staffId,
        fullName: staff.fullName,
        roles: staff.roles,
        departments: staff.departmentAccess,
      },
      setupUrl: setupUrl.toString(),
      expiresInSeconds: STAFF_ENROLL_MAX_AGE,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "STAFF_ENROLLMENT_LINK_FAILED";
    console.error("Staff enrollment link failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
