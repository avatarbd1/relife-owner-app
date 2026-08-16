import { NextRequest, NextResponse } from "next/server";
import { requestCashMovement } from "@/lib/domain/finance/production";
import { getScopedCashPosition } from "@/lib/scopedCash";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "CASH_REQUEST_FAILED";
  if (message === "ACCESS_DENIED") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message === "SCHEMA_MISMATCH" || message === "FINANCE_DB_UNAVAILABLE") {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
  if (message.startsWith("INSUFFICIENT_RECEPTION_CASH:")) {
    return NextResponse.json(
      {
        ok: false,
        error: "INSUFFICIENT_RECEPTION_CASH",
        available: Number(message.split(":")[1] || 0),
      },
      { status: 409 }
    );
  }
  if (["INVALID_DEPARTMENT", "INVALID_AMOUNT", "INVALID_CUSTODIAN", "INVALID_REQUEST_ID"].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  console.error("Finance cash request failed:", message);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const context = await requireCurrentAccessContext();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }

    const department = String(body.department || "");
    const amount = Number(body.amount);
    if (department === "Physio" || department === "Dental") {
      const cash = await getScopedCashPosition(
        department === "Dental" ? "dental" : "physio"
      );
      if (Number.isFinite(amount) && amount > cash.reception + 0.001) {
        throw new Error(`INSUFFICIENT_RECEPTION_CASH:${Math.max(0, cash.reception)}`);
      }
    }

    const result = await requestCashMovement(context, {
      department: body.department,
      amount,
      toCustodian: body.toCustodian,
      note: body.note,
      requestId: body.requestId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
