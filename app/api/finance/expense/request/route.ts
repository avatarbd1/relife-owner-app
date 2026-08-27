import { NextRequest, NextResponse } from "next/server";
import { requestExpense } from "@/lib/domain/finance/production";
import { validateDepartmentAccess, validateTenantScope } from "@/lib/domain/tenancy/validators";
import { requireTenantFeature } from "@/lib/domain/tenancy/featureGuard";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "EXPENSE_REQUEST_FAILED";
  if (message === "ACCESS_DENIED") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message.startsWith("FEATURE_ACCESS_DENIED:")) return NextResponse.json({ ok: false, error: message }, { status: 403 });
  if (message === "SCHEMA_MISMATCH" || message === "FINANCE_DB_UNAVAILABLE") {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
  if (["INVALID_DEPARTMENT", "INVALID_AMOUNT", "INVALID_CATEGORY", "INVALID_REQUEST_ID"].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  console.error("Finance expense request failed:", message);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const tenantContext = await requireCurrentTenantAccessContext();
    const { access, tenant } = tenantContext;
    validateTenantScope(access, tenant, "expense.request");
    await requireTenantFeature(tenant, "core.finance_basic");
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }
    const department = String(body.department || "");
    if (department === "Physio" || department === "Dental") {
      validateDepartmentAccess(access, department);
    }
    const result = await requestExpense(access, tenant.organizationId, tenant.clinicId, {
      department: body.department,
      category: body.category,
      amount: Number(body.amount),
      note: body.note,
      expenseType: body.expenseType,
      requestId: body.requestId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
