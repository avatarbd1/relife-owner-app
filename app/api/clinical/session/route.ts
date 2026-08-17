import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { recordTreatmentSession } from "@/lib/webos/clinical";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { consumePhysioInventorySystem } from "@/lib/webos/inventory";
import { withMutationLock } from "@/lib/webos/mutationLock";

function code(message: string) {
  if (message === "ACCESS_DENIED") return 403;
  if (message === "PATIENT_NOT_FOUND") return 404;
  if (["CLINICAL_PHYSIO_ONLY", "ACTIVE_PLAN_REQUIRED"].includes(message)) return 409;
  if (message === "CLINICAL_SCHEMA_MISMATCH") return 503;
  return 500;
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    const context = await requireCurrentAccessContext();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    const patientId = String(body.patientId || "").trim();
    const result = await withMutationLock(`patient:Physio:${patientId}`, () =>
      recordTreatmentSession(context, {
        patientId,
        painBefore: body.painBefore,
        painAfter: body.painAfter,
        response: body.response,
        modification: body.modification,
        remarks: body.remarks,
      })
    );
    try {
      await consumePhysioInventorySystem(["Hand Gloves", "Tissue"], context.staffId, "Auto-Session");
    } catch (error) {
      console.error("Session saved but automatic inventory consumption failed", error);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SESSION_CREATE_FAILED";
    if (code(message) === 500) console.error("Treatment session create failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: code(message) });
  }
}
