import { NextRequest, NextResponse } from "next/server";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { isScopeAllowed, parseScope } from "@/lib/webos/scope";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const scope = parseScope(body?.scope);
    if (!scope) {
      return NextResponse.json({ ok: false, error: "Invalid scope" }, { status: 400 });
    }

    const context = await requireCurrentAccessContext();
    if (!isScopeAllowed(context, scope)) {
      return NextResponse.json({ ok: false, error: "Scope not allowed" }, { status: 403 });
    }

    const response = NextResponse.json({ ok: true, scope });
    response.cookies.set("relife_scope", scope, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  } catch (error) {
    console.error("Scope update failed", error);
    return NextResponse.json({ ok: false, error: "Access denied" }, { status: 403 });
  }
}
