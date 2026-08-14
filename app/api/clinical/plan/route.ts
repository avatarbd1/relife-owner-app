import { NextRequest, NextResponse } from "next/server";
import { createTreatmentPlan } from "@/lib/webos/clinical";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === request.nextUrl.host; } catch { return false; }
}

function code(message: string) {
  if (message === "ACCESS_DENIED") return 403;
  if (message === "PATIENT_NOT_FOUND") return 404;
  if (["CLINICAL_PHYSIO_ONLY", "INVALID_TOTAL_SESSIONS"].includes(message)) return 400;
  if (message === "CLINICAL_SCHEMA_MISMATCH") return 503;
  return 500;
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    const context = await requireCurrentAccessContext();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    const result = await createTreatmentPlan(context, {
      patientId: body.patientId,
      diagnosis: body.diagnosis,
      totalSessions: Number(body.totalSessions),
      exercisePlan: body.exercisePlan,
      electrotherapyPlan: body.electrotherapyPlan,
      manualTherapyPlan: body.manualTherapyPlan,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PLAN_CREATE_FAILED";
    if (code(message) === 500) console.error("Treatment plan create failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: code(message) });
  }
}
