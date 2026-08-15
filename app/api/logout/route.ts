import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { STAFF_ENROLL_COOKIE } from "@/lib/staffEnrollment";
import { WEBAUTHN_CHALLENGE_COOKIE } from "@/lib/webauthn";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set("relife_scope", "", { path: "/", maxAge: 0 });
  response.cookies.set(STAFF_ENROLL_COOKIE, "", {
    path: "/api/auth/webauthn",
    maxAge: 0,
  });
  response.cookies.set(WEBAUTHN_CHALLENGE_COOKIE, "", {
    path: "/api/auth/webauthn",
    maxAge: 0,
  });
  return response;
}
