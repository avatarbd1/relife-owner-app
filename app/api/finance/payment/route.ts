import { NextRequest, NextResponse } from "next/server";
import { createPayment } from "@/lib/webos/financeOps";
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
  const message = error instanceof Error ? error.message : "PAYMENT_CREATE_FAILED";
  if (message === "ACCESS_DENIED") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message === "PATIENT_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  if (message === "SCHEMA_MISMATCH") {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
  if (
    [
      "INVALID_PATIENT_ID",
      "INVALID_AMOUNT",
      "EMPTY_PAYMENT",
      "INVALID_PAYMENT_METHOD",
      "INVALID_REQUEST_ID",
      "DEPARTMENT_MISMATCH",
    ].includes(message)
  ) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  console.error("W3 payment create failed:", message);
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
    const result = await createPayment(context, {
      patientId: body.patientId,
      amount: Number(body.amount),
      discount: Number(body.discount || 0),
      paymentMethod: body.paymentMethod,
      sessions: Number(body.sessions || 0),
      sessionType: body.sessionType,
      remarks: body.remarks,
      requestId: body.requestId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
