import { NextRequest, NextResponse } from "next/server";
import { createPayment } from "@/lib/domain/finance/production";
import { recordActorWorkGamification } from "@/lib/domain/gamification/events";
import { validateDepartmentAccess, validateTenantScope } from "@/lib/domain/tenancy/validators";
import { requireTenantFeature } from "@/lib/domain/tenancy/featureGuard";
import { invalidatePatientsCache } from "@/lib/patients";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "PAYMENT_CREATE_FAILED";
  if (message === "ACCESS_DENIED") return NextResponse.json({ ok: false, error: message }, { status: 403 });
  if (message.startsWith("FEATURE_ACCESS_DENIED:")) return NextResponse.json({ ok: false, error: message }, { status: 403 });
  if (message === "PATIENT_NOT_FOUND") return NextResponse.json({ ok: false, error: message }, { status: 404 });
  if (message === "SCHEMA_MISMATCH" || message === "FINANCE_DB_UNAVAILABLE") return NextResponse.json({ ok: false, error: message }, { status: 503 });
  if (["INVALID_PATIENT_ID", "INVALID_AMOUNT", "EMPTY_PAYMENT", "INVALID_PAYMENT_METHOD", "INVALID_REQUEST_ID", "DEPARTMENT_MISMATCH"].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  console.error("Finance payment create failed:", message);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

function departmentFromPatientId(value: unknown): "Physio" | "Dental" | null {
  const patientId = String(value || "").trim().toUpperCase();
  if (patientId.startsWith("PT")) return "Physio";
  if (patientId.startsWith("DT")) return "Dental";
  return null;
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    const tenantContext = await requireCurrentTenantAccessContext();
    const { access, tenant } = tenantContext;
    validateTenantScope(access, tenant, "payment.create");
    await requireTenantFeature(tenant, "core.finance_basic");
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    const department = departmentFromPatientId(body.patientId);
    if (department) validateDepartmentAccess(access, department);
    const result = await createPayment(access, tenant.organizationId, tenant.clinicId, {
      patientId: body.patientId,
      amount: Number(body.amount),
      discount: Number(body.discount || 0),
      paymentMethod: body.paymentMethod,
      sessions: Number(body.sessions || 0),
      sessionType: body.sessionType,
      remarks: body.remarks,
      requestId: body.requestId,
    });
    invalidatePatientsCache();

    if (department) {
      await recordActorWorkGamification({
        tenant,
        context: access,
        department,
        purpose: "reception",
        eventType: "payment_processed",
        eventKey: `payment:${department}:${result.receiptNo}:processed:v2`,
        sourceType: "finance_payment",
        sourceId: result.receiptNo,
        eventAt: new Date().toISOString(),
        reason: "Verified patient payment processed",
        verificationMethod: "canonical_finance_payment",
        payload: {
          receiptNo: result.receiptNo,
          patientId: String(body.patientId || "").trim().toUpperCase(),
          paymentMethod: String(body.paymentMethod || "").trim(),
          sheetsDuplicate: result.duplicate,
        },
      });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
