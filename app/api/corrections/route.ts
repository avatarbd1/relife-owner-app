import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { deleteOwnLatestTodayPayment } from "@/lib/webos/ownCorrections";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

function statusFor(message: string): number {
  if (["ACCESS_DENIED", "OWN_ENTRY_REQUIRED"].includes(message)) return 403;
  if (["PAYMENT_NOT_FOUND", "PATIENT_NOT_FOUND"].includes(message)) return 404;
  if (
    [
      "TODAY_ONLY_CORRECTION",
      "PAYMENT_NOT_LATEST_FOR_PATIENT",
      "STALE_PAYMENT_STATE",
    ].includes(message)
  ) {
    return 409;
  }
  if (message.includes("SCHEMA")) return 503;
  return 400;
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const tenantContext = await requireCurrentTenantAccessContext();
    const { access, tenant } = tenantContext;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }
    const receiptNo = String(body.receiptNo || "").trim();
    const confirmReceiptNo = String(body.confirmReceiptNo || "").trim();
    if (!receiptNo || receiptNo !== confirmReceiptNo) {
      return NextResponse.json({ ok: false, error: "CONFIRMATION_MISMATCH" }, { status: 400 });
    }
    const result = await deleteOwnLatestTodayPayment(access, tenant.organizationId, tenant.clinicId, {
      department: body.department,
      receiptNo,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CORRECTION_FAILED";
    const status = statusFor(message);
    if (status >= 500) console.error("Own same-day correction failed", error);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
