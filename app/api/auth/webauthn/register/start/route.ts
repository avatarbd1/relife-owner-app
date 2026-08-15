import { NextRequest, NextResponse } from "next/server";
import { STAFF_ENROLL_COOKIE } from "@/lib/staffEnrollment";
import { getCurrentStaffIdentity } from "@/lib/webos/currentUser";
import { getEnrollmentIdentity } from "@/lib/webos/enrollmentIdentity";
import { isAllowedWebAuthnRequestOrigin } from "@/lib/webauthnRequest";
import {
  beginPasskeyRegistration,
  WEBAUTHN_CHALLENGE_COOKIE,
  WEBAUTHN_CHALLENGE_MAX_AGE,
} from "@/lib/webauthn";

export async function POST(request: NextRequest) {
  if (!isAllowedWebAuthnRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const enrollment = await getEnrollmentIdentity(
      request.cookies.get(STAFF_ENROLL_COOKIE)?.value
    );
    const identity = enrollment?.identity || (await getCurrentStaffIdentity());
    if (!identity) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const { options, stateToken } = await beginPasskeyRegistration(
      identity.staffId,
      identity.fullName
    );
    const response = NextResponse.json({ ok: true, options });
    response.cookies.set(WEBAUTHN_CHALLENGE_COOKIE, stateToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/auth/webauthn",
      maxAge: WEBAUTHN_CHALLENGE_MAX_AGE,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "WEBAUTHN_REGISTRATION_START_FAILED";
    console.error("WebAuthn registration start failed", message);
    const status = message.startsWith("STAFF_ENROLLMENT")
      ? 401
      : message.startsWith("WEBAUTHN_SCHEMA")
        ? 503
        : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
