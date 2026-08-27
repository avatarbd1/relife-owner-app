import { NextResponse } from "next/server";

export function paymentErrorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "PAYMENT_CREATE_FAILED";
  if (
    message === "ACCESS_DENIED" ||
    message === "DEPARTMENT_ACCESS_DENIED" ||
    message.startsWith("TENANT_SCOPE_DENIED:")
  ) {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message === "PATIENT_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  if (message === "SCHEMA_MISMATCH" || message === "FINANCE_DB_UNAVAILABLE") {
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
  console.error("Finance payment create failed:", message);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}
