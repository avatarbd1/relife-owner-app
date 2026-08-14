import { NextRequest, NextResponse } from "next/server";
import { checkOwnerPin } from "@/lib/auth";
import { paySalary } from "@/lib/webos/financeOps";
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
  const message = error instanceof Error ? error.message : "SALARY_PAY_FAILED";
  if (message === "ACCESS_DENIED") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message === "STAFF_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  if (message === "SCHEMA_MISMATCH") {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
  if (["INVALID_AMOUNT", "INVALID_CUSTODIAN", "INVALID_REQUEST_ID"].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  console.error("W3 salary pay failed:", message);
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
    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!pin || !checkOwnerPin(pin)) {
      return NextResponse.json({ ok: false, error: "Incorrect PIN" }, { status: 401 });
    }
    const result = await paySalary(context, {
      staffId: body.staffId,
      amount: Number(body.amount),
      paidFrom: body.paidFrom,
      note: body.note,
      requestId: body.requestId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
