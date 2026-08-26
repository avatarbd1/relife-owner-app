import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { answerStaffAi } from "@/lib/webos/ai";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    const { access, tenant } = await requireCurrentTenantAccessContext();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    const result = await answerStaffAi(
      access,
      tenant.organizationId,
      tenant.clinicId,
      body.question
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "STAFF_AI_FAILED";
    const status = message === "ACCESS_DENIED" ? 403 : message === "AI_NOT_CONFIGURED" ? 503 : 400;
    if (status >= 500) console.error("Staff AI failed", error);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
