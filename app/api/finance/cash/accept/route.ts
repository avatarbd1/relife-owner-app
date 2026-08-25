import { NextRequest, NextResponse } from "next/server";
import { getScopedCashPosition } from "@/lib/scopedCash";
import { validateDepartmentAccess, validateTenantScope } from "@/lib/domain/tenancy/validators";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import {
  finalizeCashMovement,
  getPendingCashMovements,
} from "@/lib/webos/cashAcceptance";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

function code(message: string): number {
  if (message === "ACCESS_DENIED") return 403;
  if (message === "CASH_MOVEMENT_NOT_FOUND") return 404;
  if (message === "CASH_MOVEMENT_ALREADY_DECIDED") return 409;
  if (message.startsWith("INSUFFICIENT_RECEPTION_CASH:")) return 409;
  if (message === "SCHEMA_MISMATCH") return 503;
  if (["INVALID_DEPARTMENT", "INVALID_DECISION", "INVALID_RECEIVED_AMOUNT", "DEPARTMENT_MISMATCH"].includes(message)) return 400;
  return 500;
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    // T2-02: Require full tenant-aware context for finance operations
    const tenantContext = await requireCurrentTenantAccessContext();
    const { access, tenant } = tenantContext;
    validateTenantScope(access, tenant, "cash.accept");
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }

    const department = String(body.department || "");
    const decision = String(body.decision || "");
    const receivedAmount =
      body.receivedAmount === undefined || body.receivedAmount === ""
        ? undefined
        : Number(body.receivedAmount);

    if (department === "Physio" || department === "Dental") {
      validateDepartmentAccess(access, department);
    }

    // Pending requests do not reduce cash. Recheck the live Reception balance at
    // the moment of acceptance so a stale/oversized handover can never create a
    // negative custody balance.
    if (decision === "Accepted" && (department === "Physio" || department === "Dental")) {
      const scope = department === "Dental" ? "dental" : "physio";
      const pending = await getPendingCashMovements(access, scope);
      const movement = pending.find(
        (item) => item.movementId === String(body.movementId || "")
      );
      if (movement) {
        const amount = receivedAmount ?? movement.requestedAmount;
        const cash = await getScopedCashPosition(scope);
        if (Number.isFinite(amount) && amount > cash.reception + 0.001) {
          throw new Error(`INSUFFICIENT_RECEPTION_CASH:${Math.max(0, cash.reception)}`);
        }
      }
    }

    const result = await finalizeCashMovement(access, {
      movementId: body.movementId,
      department: body.department,
      decision: body.decision,
      receivedAmount,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CASH_ACCEPT_FAILED";
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
    if (code(message) === 500) console.error("Cash handover finalize failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: code(message) });
  }
}
