import { NextRequest, NextResponse } from "next/server";
import { paymentErrorResponse } from "@/lib/api/paymentErrorResponse";
import { createPayment } from "@/lib/domain/finance/production";
import { recordActorWorkGamification } from "@/lib/domain/gamification/events";
import { validateDepartmentAccess, validateTenantScope } from "@/lib/domain/tenancy/validators";
import { invalidatePatientsCache } from "@/lib/patients";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

function departmentFromPatientId(value: unknown): "Physio" | "Dental" | null {
  const patientId = String(value || "").trim().toUpperCase();
  if (patientId.startsWith("PT")) return "Physio";
  if (patientId.startsWith("DT")) return "Dental";
  return null;
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const tenantContext = await requireCurrentTenantAccessContext();
    const { access, tenant } = tenantContext;
    validateTenantScope(access, tenant, "payment.create");
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }
    const department = departmentFromPatientId(body.patientId);
    if (department) {
      validateDepartmentAccess(access, department);
    }
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
    return paymentErrorResponse(error);
  }
}
