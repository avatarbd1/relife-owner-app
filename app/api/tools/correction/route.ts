import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { deleteLatestTodayPhysioPayment } from "@/lib/webos/corrections";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    const context = await requireCurrentAccessContext();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    const receiptNo = String(body.receiptNo || "").trim();
    const confirmReceiptNo = String(body.confirmReceiptNo || "").trim();
    if (!receiptNo || receiptNo !== confirmReceiptNo) {
      return NextResponse.json({ ok: false, error: "CONFIRMATION_MISMATCH" }, { status: 400 });
    }
    const result = await deleteLatestTodayPhysioPayment(context, receiptNo);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CORRECTION_FAILED";
    const conflict = new Set([
      "TODAY_ONLY_CORRECTION",
      "PAYMENT_NOT_LATEST_FOR_PATIENT",
      "STALE_PAYMENT_STATE",
    ]);
    const status = message === "ACCESS_DENIED" ? 403 : message === "PAYMENT_NOT_FOUND" || message === "PATIENT_NOT_FOUND" ? 404 : conflict.has(message) ? 409 : message.includes("SCHEMA") ? 503 : 400;
    if (status >= 500) console.error("Correction failed", error);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
