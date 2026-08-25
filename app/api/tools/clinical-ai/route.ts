import { NextRequest, NextResponse } from "next/server";
import { validateTenantScope } from "@/lib/domain/tenancy/validators";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { answerClinicalAi } from "@/lib/webos/ai";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    // T2-02: Require full tenant-aware context for tool operations
    const tenantContext = await requireCurrentTenantAccessContext();
    const { access, tenant } = tenantContext;
    validateTenantScope(access, tenant, "clinical.ai.query");
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    const result = await answerClinicalAi(access, {
      question: body.question,
      patientId: body.patientId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CLINICAL_AI_FAILED";
    const status = message === "ACCESS_DENIED" ? 403 : message === "AI_NOT_CONFIGURED" ? 503 : message.includes("PATIENT") ? 404 : 400;
    if (status >= 500) console.error("Clinical AI failed", error);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
