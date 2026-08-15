import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { WEBAUTHN_CHALLENGE_COOKIE } from "@/lib/webauthn";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(WEBAUTHN_CHALLENGE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/auth/webauthn",
    maxAge: 0,
  });
  return response;
}
