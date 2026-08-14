import { NextRequest, NextResponse } from "next/server";
import { consumePhysioInventorySystem } from "@/lib/webos/inventory";
import { registerPatient } from "@/lib/webos/reception";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.nextUrl.host;
  } catch {
    return false;
  }
}

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "PATIENT_CREATE_FAILED";
  if (message === "ACCESS_DENIED") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message.startsWith("DUPLICATE_PHONE:")) {
    return NextResponse.json(
      { ok: false, error: "DUPLICATE_PHONE", patientId: message.split(":")[1] || "" },
      { status: 409 }
    );
  }
  if (["INVALID_DEPARTMENT", "INVALID_PATIENT_NAME"].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  if (message === "SCHEMA_MISMATCH") {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
  console.error("Patient registration failed:", message);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }

  try {
    const context = await requireCurrentAccessContext();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }
    const result = await registerPatient(context, {
      department: body.department,
      fullName: body.fullName,
      fatherHusbandName: body.fatherHusbandName,
      phone: body.phone,
      alternativePhone: body.alternativePhone,
      age: body.age,
      gender: body.gender,
      address: body.address,
      diagnosis: body.diagnosis,
      therapist: body.therapist,
      referral: body.referral,
      remarks: body.remarks,
    });
    if (body.department === "Physio") {
      await consumePhysioInventorySystem(["Patient Card"], context.staffId, "Auto-Registration");
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
