import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { actOnRewardClaim, type RewardClaimTransition } from "@/lib/data/supabaseRewardClaims";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

const TRANSITIONS = new Set<RewardClaimTransition>(["approve", "deny", "cancel", "claim"]);

function errorResponse(error: unknown): NextResponse {
  const typed = error as Error & { status?: number };
  const message = error instanceof Error ? error.message : "REWARD_CLAIM_ACTION_FAILED";
  const status = typed.status && typed.status >= 400 && typed.status < 600 ? typed.status : 500;
  if (status >= 500) console.error("Reward claim action failed", error);
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ claimId: string }> }
) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const context = await requireCurrentAccessContext();
    const { claimId } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }
    const transition = String(body.transition || "").trim() as RewardClaimTransition;
    if (!TRANSITIONS.has(transition)) {
      return NextResponse.json({ ok: false, error: "INVALID_CLAIM_ACTION" }, { status: 400 });
    }
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) {
      return NextResponse.json({ ok: false, error: "INVALID_CLAIM_VERSION" }, { status: 400 });
    }
    const idempotencyKey = String(body.idempotencyKey || "").trim();
    if (!idempotencyKey) {
      return NextResponse.json({ ok: false, error: "INVALID_IDEMPOTENCY_KEY" }, { status: 400 });
    }
    const result = await actOnRewardClaim({
      requestId: `rca-${randomUUID()}`,
      idempotencyKey,
      actorId: context.staffId,
      actorRoles: context.roles,
      actorDepartmentAccess: context.departmentAccess,
      claimId: String(claimId || "").trim(),
      transition,
      expectedVersion,
      reason: String(body.reason || "").trim(),
      coverageStatus:
        body.coverageStatus === "available" || body.coverageStatus === "unavailable"
          ? body.coverageStatus
          : "",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
