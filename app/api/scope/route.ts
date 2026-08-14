import { NextRequest, NextResponse } from "next/server";

const VALID = ["combined", "physio", "dental"];

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const scope = typeof body?.scope === "string" ? body.scope : "";
  if (!VALID.includes(scope)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set("relife_scope", scope, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
