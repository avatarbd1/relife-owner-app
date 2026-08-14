import { NextRequest, NextResponse } from "next/server";
import { addQuickAssessment } from "@/lib/webos/clinical";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === request.nextUrl.host; } catch { return false; }
}

function code(message: string) {
  if (message === "ACCESS_DENIED") return 403;
  if (["PATIENT_NOT_FOUND"].includes(message)) return 404;
  if (["CLINICAL_PHYSIO_ONLY", "ASSESSMENT_FINDINGS_REQUIRED"].includes(message)) return 400;
  if (message === "CLINICAL_SCHEMA_MISMATCH") return 503;
  return 500;
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    const context = await requireCurrentAccessContext();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    const result = await addQuickAssessment(context, {
      patientId: body.patientId,
      category: body.category,
      findings: body.findings,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ASSESSMENT_CREATE_FAILED";
    if (code(message) === 500) console.error("Assessment create failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: code(message) });
  }
}
