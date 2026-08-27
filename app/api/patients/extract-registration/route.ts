import { NextRequest, NextResponse } from "next/server";
import { validateDepartmentAccess, validateTenantScope } from "@/lib/domain/tenancy/validators";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { extractRegistrationDraftFromImage } from "@/lib/webos/registrationAi";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

function statusFor(message: string): number {
  if (message === "ACCESS_DENIED") return 403;
  if (message === "AI_NOT_CONFIGURED") return 503;
  if (message === "INVALID_REGISTRATION_IMAGE" || message === "INVALID_DEPARTMENT") return 400;
  if (message === "AI_PROVIDER_TIMEOUT") return 504;
  if (message.startsWith("AI_PROVIDER_HTTP_") || message === "AI_EMPTY_RESPONSE" || message === "AI_EXTRACTION_INVALID_RESPONSE") return 502;
  return 500;
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    // T2-02: Require full tenant-aware context for patient operations
    const tenantContext = await requireCurrentTenantAccessContext();
    const { access, tenant } = tenantContext;
    validateTenantScope(access, tenant, "patient.extract.registration");
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }
    const department = String(body.department || "");
    if (department !== "Physio" && department !== "Dental") {
      return NextResponse.json({ ok: false, error: "INVALID_DEPARTMENT" }, { status: 400 });
    }
    validateDepartmentAccess(access, department);
    const result = await extractRegistrationDraftFromImage(access, {
      department,
      imageDataUrl: String(body.imageDataUrl || ""),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI_EXTRACTION_FAILED";
    const status = statusFor(message);
    if (status >= 500) console.error("Registration image extraction failed", message);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
