import { NextRequest, NextResponse } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSessionToken,
} from "@/lib/auth";
import { postLoginPathForStaffId } from "@/lib/domain/platform/authority";
import { isAllowedWebAuthnRequestOrigin } from "@/lib/webauthnRequest";
import { getCanonicalActiveWebStaffById } from "@/lib/webos/canonicalStaffIdentity";
import { getActiveWebStaffById, type WebStaffIdentity } from "@/lib/webos/staffDirectory";
import {
  finishPasskeyAuthentication,
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

async function getLegacyLoginIdentity(staffId: string): Promise<WebStaffIdentity | null> {
  try {
    return await getActiveWebStaffById(staffId);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  if (!isAllowedWebAuthnRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const state = readChallengeState(
      request.cookies.get(WEBAUTHN_CHALLENGE_COOKIE)?.value,
      "authenticate"
    );
    if (!state) {
      return NextResponse.json(
        { ok: false, error: "WEBAUTHN_CHALLENGE_INVALID" },
        { status: 400 }
      );
    }
    const body = await request.json().catch(() => null);
    const credential = body?.credential as AuthenticationResponseJSON | undefined;
    if (!credential?.id) {
      return NextResponse.json({ ok: false, error: "INVALID_CREDENTIAL" }, { status: 400 });
    }
    const { staffId } = await finishPasskeyAuthentication(state, credential);
    const identity =
      (await getCanonicalActiveWebStaffById(staffId)) ||
      (await getLegacyLoginIdentity(staffId));
    if (!identity) {
      const inactive = NextResponse.json(
        { ok: false, error: "STAFF_ACCESS_INACTIVE_OR_CLINIC_NOT_ACTIVE" },
        { status: 403 },
      );
      clearChallenge(inactive);
      return inactive;
    }

    const response = NextResponse.json({
      ok: true,
      next: postLoginPathForStaffId(
        staffId,
        process.env.PLATFORM_OWNER_STAFF_IDS,
      ),
    });
    response.cookies.set(SESSION_COOKIE, createSessionToken(staffId), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    clearChallenge(response);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "WEBAUTHN_AUTHENTICATION_FAILED";
    console.error("WebAuthn authentication failed", message);
    const response = NextResponse.json({ ok: false, error: message }, { status: 401 });
    clearChallenge(response);
    return response;
  }
}
