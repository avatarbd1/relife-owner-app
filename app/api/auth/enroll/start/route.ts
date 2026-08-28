import { NextRequest, NextResponse } from "next/server";
import {
  STAFF_ENROLL_COOKIE,
  enrollmentCookieMaxAge,
  readStaffEnrollmentToken,
} from "@/lib/staffEnrollment";
import { isAllowedWebAuthnRequestOrigin } from "@/lib/webauthnRequest";
import { getEnrollmentIdentity } from "@/lib/webos/enrollmentIdentity";

export async function POST(request: NextRequest) {
  if (!isAllowedWebAuthnRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : null;
  const claims = readStaffEnrollmentToken(token);
  if (!claims) {
    return NextResponse.json({ ok: false, error: "Setup link is invalid or expired" }, { status: 401 });
  }

  try {
    const enrollment = await getEnrollmentIdentity(token);
    if (!enrollment) {
      return NextResponse.json(
        { ok: false, error: "Staff access is inactive or incomplete" },
        { status: 403 }
      );
    }
    const { identity: staff } = enrollment;

    const response = NextResponse.json({
      ok: true,
      staff: {
        staffId: staff.staffId,
        fullName: staff.fullName,
        roles: staff.roles,
        departments: staff.departmentAccess,
      },
    });
    response.cookies.set(STAFF_ENROLL_COOKIE, token, {
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
    const status = message === "STAFF_ENROLLMENT_ALREADY_USED"
      ? 409
      : message === "STAFF_ENROLLMENT_ACCESS_DENIED"
        ? 403
        : message.startsWith("STAFF_ENROLLMENT")
          ? 401
          : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
