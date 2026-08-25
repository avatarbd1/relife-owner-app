import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { generateCaseStudyLesson } from "@/lib/webos/ai";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    const tenantContext = await requireCurrentTenantAccessContext();
    const { access, tenant } = tenantContext;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    const result = await generateCaseStudyLesson(access, tenant.clinicId, {
      patientId: body.patientId,
      lessonTitle: body.lessonTitle,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CASE_STUDY_FAILED";
    const status = message === "ACCESS_DENIED" ? 403 : message === "AI_NOT_CONFIGURED" ? 503 : message.includes("PATIENT") ? 404 : message.includes("SCHEMA") ? 503 : 400;
    if (status >= 500) console.error("Case study generation failed", error);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
