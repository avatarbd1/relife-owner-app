import { NextRequest, NextResponse } from "next/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSessionToken,
} from "@/lib/auth";
import { STAFF_ENROLL_COOKIE } from "@/lib/staffEnrollment";
import { getCurrentStaffIdentity } from "@/lib/webos/currentUser";
import { getEnrollmentIdentity } from "@/lib/webos/enrollmentIdentity";
import { isAllowedWebAuthnRequestOrigin } from "@/lib/webauthnRequest";
import {
  finishPasskeyRegistration,
  readChallengeState,
  WEBAUTHN_CHALLENGE_COOKIE,
} from "@/lib/webauthn";

function clearChallenge(response: NextResponse) {
  response.cookies.set(WEBAUTHN_CHALLENGE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/auth/webauthn",
    maxAge: 0,
  });
}

function clearEnrollment(response: NextResponse) {
  response.cookies.set(STAFF_ENROLL_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/auth/webauthn",
    maxAge: 0,
  });
}

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
    const state = readChallengeState(
      request.cookies.get(WEBAUTHN_CHALLENGE_COOKIE)?.value,
      "register"
    );
    if (!state) {
      return NextResponse.json(
        { ok: false, error: "WEBAUTHN_CHALLENGE_INVALID" },
        { status: 400 }
      );
    }
    const body = await request.json().catch(() => null);
    const credential = body?.credential as RegistrationResponseJSON | undefined;
    if (!credential?.id) {
      return NextResponse.json({ ok: false, error: "INVALID_CREDENTIAL" }, { status: 400 });
    }
    const passkey = await finishPasskeyRegistration(
      identity.staffId,
      state,
      credential,
      typeof body?.displayName === "string" ? body.displayName : undefined
    );
    const response = NextResponse.json({ ok: true, passkey });
    clearChallenge(response);

    if (enrollment) {
      response.cookies.set(SESSION_COOKIE, createSessionToken(identity.staffId), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_MAX_AGE,
      });
      clearEnrollment(response);
    }

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "WEBAUTHN_REGISTRATION_FAILED";
    console.error("WebAuthn registration verify failed", message);
    const status = message.startsWith("STAFF_ENROLLMENT") ? 401 : 400;
    const response = NextResponse.json({ ok: false, error: message }, { status });
    clearChallenge(response);
    return response;
  }
}
