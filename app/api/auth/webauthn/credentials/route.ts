import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaffIdentity } from "@/lib/webos/currentUser";
import { revokePasskey } from "@/lib/webauthn";

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.nextUrl.host;
  } catch {
    return false;
  }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const identity = await getCurrentStaffIdentity();
    if (!identity) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json().catch(() => null);
    const credentialId = typeof body?.credentialId === "string" ? body.credentialId : "";
    if (!credentialId) {
      return NextResponse.json({ ok: false, error: "Credential required" }, { status: 400 });
    }
    await revokePasskey(identity.staffId, credentialId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PASSKEY_REVOKE_FAILED";
    const status = message === "PASSKEY_NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
