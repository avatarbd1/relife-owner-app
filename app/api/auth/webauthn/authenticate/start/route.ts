import { NextRequest, NextResponse } from "next/server";
import { isAllowedWebAuthnRequestOrigin } from "@/lib/webauthnRequest";
import {
  beginPasskeyAuthentication,
  WEBAUTHN_CHALLENGE_COOKIE,
  WEBAUTHN_CHALLENGE_MAX_AGE,
} from "@/lib/webauthn";

export async function POST(request: NextRequest) {
  if (!isAllowedWebAuthnRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const { options, stateToken } = await beginPasskeyAuthentication();
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
    const message = error instanceof Error ? error.message : "WEBAUTHN_AUTH_START_FAILED";
    const status = message === "NO_PASSKEYS_REGISTERED" ? 404 : message.startsWith("WEBAUTHN_SCHEMA") ? 503 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
