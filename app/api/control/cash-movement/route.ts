import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  checkOwnerPin,
  verifySessionToken,
} from "@/lib/auth";
import { decideCashMovement } from "@/lib/domain/finance/production";
import type { Workbook } from "@/lib/data/googleSheets";
import { requireTenantFeature } from "@/lib/domain/tenancy/featureGuard";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

function statusForError(message: string): number {
  if (message === "ACCESS_DENIED" || message.startsWith("FEATURE_ACCESS_DENIED:")) return 403;
  if (message === "CONTROL_NOT_FOUND") return 404;
  if (message === "CONTROL_ALREADY_DECIDED") return 409;
  if (message === "SCHEMA_MISMATCH" || message === "FINANCE_DB_UNAVAILABLE") return 503;
  if (["INVALID_WORKBOOK", "INVALID_DECISION", "INVALID_RECEIVED_AMOUNT"].includes(message)) return 400;
  return 500;
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }

  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (!verifySessionToken(session)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let tenantContext;
  try {
    tenantContext = await requireCurrentTenantAccessContext();
  } catch {
    return NextResponse.json({ ok: false, error: "ACCESS_DENIED" }, { status: 403 });
  }

  try {
    await requireTenantFeature(tenantContext.tenant, "optional.finance_advanced");
  } catch (error) {
    const message = error instanceof Error ? error.message : "FEATURE_ACCESS_DENIED";
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  const context = tenantContext.access;

  // Explicit Owner authorization check (before PIN check)
  if (!context.roles.includes("Owner")) {
    return NextResponse.json({ ok: false, error: "ACCESS_DENIED" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const workbook = body?.workbook as Workbook | undefined;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const decision = body?.decision;
  const pin = typeof body?.pin === "string" ? body.pin : "";
  const receivedAmount =
    typeof body?.receivedAmount === "number" ? body.receivedAmount : undefined;

  // PIN check (secondary confirmation, not primary authorization)
  if (!pin || !checkOwnerPin(pin)) {
    return NextResponse.json({ ok: false, error: "Incorrect PIN" }, { status: 401 });
  }

  if (!(["physio", "dental"] as const).includes(workbook as Workbook)) {
    return NextResponse.json({ ok: false, error: "Invalid workbook" }, { status: 400 });
  }
  if (!id || !["accept", "reject"].includes(decision)) {
    return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
  }
  if (
    receivedAmount !== undefined &&
    (!Number.isFinite(receivedAmount) || receivedAmount < 0)
  ) {
    return NextResponse.json({ ok: false, error: "Invalid received amount" }, { status: 400 });
  }

  try {
    await decideCashMovement({
      workbook: workbook as Workbook,
      movementId: id,
      decision,
      receivedAmount,
      actorId: context.staffId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CONTROL_FAILED";
    console.error("Owner cash movement control failed:", message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: statusForError(message) }
    );
  }
}
