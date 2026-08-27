import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  checkOwnerPin,
  createSessionToken,
} from "@/lib/auth";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import {
  clearOwnerLoginThrottle,
  ownerLoginClientKey,
  recordOwnerLoginFailure,
  reserveOwnerLoginAttempt,
} from "@/lib/webos/loginThrottle";

function blockedResponse(retryAfterSeconds: number) {
  const retryAfter = Math.max(1, Math.ceil(retryAfterSeconds || 1));
  return NextResponse.json(
    { ok: false, error: "Too many attempts. Try again later." },
    {
      status: 429,
      headers: { "retry-after": String(retryAfter) },
    }
  );
}

function unavailableResponse() {
  return NextResponse.json(
    { ok: false, error: "Login temporarily unavailable" },
    { status: 503 }
  );
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json(
      { ok: false, error: "Origin rejected" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const pin = typeof body?.pin === "string" ? body.pin : "";

  let clientKey = "";
  try {
    clientKey = ownerLoginClientKey(request);
    const reservation = await reserveOwnerLoginAttempt(clientKey);
    if (!reservation.allowed || reservation.blocked) {
      return blockedResponse(reservation.retryAfterSeconds);
    }
  } catch (error) {
    console.error("Owner login throttle reserve failed", error);
    return unavailableResponse();
  }

  if (!pin || !checkOwnerPin(pin)) {
    try {
      const failure = await recordOwnerLoginFailure(clientKey);
      if (failure.blocked) {
        return blockedResponse(failure.retryAfterSeconds);
      }
    } catch (error) {
      console.error("Owner login throttle failure record failed", error);
      return unavailableResponse();
    }
    return NextResponse.json(
      { ok: false, error: "Incorrect PIN" },
      { status: 401 }
    );
  }

  try {
    await clearOwnerLoginThrottle(clientKey);
  } catch (error) {
    console.error("Owner login throttle clear failed", error);
    return unavailableResponse();
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}
