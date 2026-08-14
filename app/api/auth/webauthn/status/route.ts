import { NextResponse } from "next/server";
import { getCurrentStaffIdentity } from "@/lib/webos/currentUser";
import { listPasskeysForStaff } from "@/lib/webauthn";

export async function GET() {
  try {
    const identity = await getCurrentStaffIdentity();
    if (!identity) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const passkeys = await listPasskeysForStaff(identity.staffId);
    return NextResponse.json({
      ok: true,
      staffId: identity.staffId,
      count: passkeys.length,
      passkeys,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WEBAUTHN_STATUS_FAILED";
    const status = message.startsWith("WEBAUTHN_SCHEMA") ? 503 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
