import { NextRequest, NextResponse } from "next/server";
import {
  STAFF_ENROLL_COOKIE,
  enrollmentCookieMaxAge,
  readStaffEnrollmentToken,
} from "@/lib/staffEnrollment";
import { listPasskeysForStaff } from "@/lib/webauthn";
import { isAllowedWebAuthnRequestOrigin } from "@/lib/webauthnRequest";
import { getActiveWebStaffById, toAccessContext } from "@/lib/webos/staffDirectory";

export async function POST(request: NextRequest) {
  if (!isAllowedWebAuthnRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const claims = readStaffEnrollmentToken(
    typeof body?.token === "string" ? body.token : null
  );
  if (!claims) {
    return NextResponse.json({ ok: false, error: "Setup link is invalid or expired" }, { status: 401 });
  }

  try {
    const staff = await getActiveWebStaffById(claims.staffId);
    if (!staff || !toAccessContext(staff)) {
      return NextResponse.json(
        { ok: false, error: "Staff access is inactive or incomplete" },
        { status: 403 }
      );
    }

    const passkeys = await listPasskeysForStaff(staff.staffId);
    if (passkeys.length !== claims.passkeyCount) {
      return NextResponse.json(
        { ok: false, error: "Setup link has already been used. Ask the owner for a new link." },
        { status: 409 }
      );
    }

    const response = NextResponse.json({
      ok: true,
      staff: {
        staffId: staff.staffId,
        fullName: staff.fullName,
        roles: staff.roles,
        departments: staff.departmentAccess,
      },
    });
    response.cookies.set(STAFF_ENROLL_COOKIE, body.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/auth/webauthn",
      maxAge: enrollmentCookieMaxAge(claims),
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "STAFF_ENROLLMENT_START_FAILED";
    console.error("Staff enrollment start failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
