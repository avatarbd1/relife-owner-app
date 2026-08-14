import { NextRequest, NextResponse } from "next/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { getCurrentStaffIdentity } from "@/lib/webos/currentUser";
import {
  finishPasskeyRegistration,
  readChallengeState,
  WEBAUTHN_CHALLENGE_COOKIE,
} from "@/lib/webauthn";

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.nextUrl.host;
  } catch {
    return false;
  }
}

function clearChallenge(response: NextResponse) {
  response.cookies.set(WEBAUTHN_CHALLENGE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/auth/webauthn",
    maxAge: 0,
  });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const identity = await getCurrentStaffIdentity();
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
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "WEBAUTHN_REGISTRATION_FAILED";
    console.error("WebAuthn registration verify failed", message);
    const response = NextResponse.json({ ok: false, error: message }, { status: 400 });
    clearChallenge(response);
    return response;
  }
}
