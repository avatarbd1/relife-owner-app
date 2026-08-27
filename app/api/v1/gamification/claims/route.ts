import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  listRewardClaims,
  requestRewardClaim,
  type RewardClaimStatus,
} from "@/lib/data/supabaseRewardClaims";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

const STATUSES = new Set<RewardClaimStatus | "all">([
  "pending",
  "approved",
  "denied",
  "cancelled",
  "claimed",
  "expired",
  "all",
]);

function errorResponse(error: unknown): NextResponse {
  const typed = error as Error & { status?: number };
  const message = error instanceof Error ? error.message : "REWARD_CLAIM_FAILED";
  const status = typed.status && typed.status >= 400 && typed.status < 600 ? typed.status : 500;
  if (status >= 500) console.error("Reward claim API failed", error);
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const tenantContext = await requireCurrentTenantAccessContext();
    const rawStatus = String(request.nextUrl.searchParams.get("status") || "pending").trim() as RewardClaimStatus | "all";
    if (!STATUSES.has(rawStatus)) {
      return NextResponse.json({ ok: false, error: "INVALID_CLAIM_STATUS" }, { status: 400 });
    }
    const claims = await listRewardClaims({
      actorId: tenantContext.access.staffId,
      actorRoles: tenantContext.access.roles,
      actorDepartmentAccess: tenantContext.access.departmentAccess,
      organizationId: tenantContext.tenant.organizationId,
      clinicId: tenantContext.tenant.clinicId,
      status: rawStatus,
    });
    return NextResponse.json({ ok: true, claims });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const tenantContext = await requireCurrentTenantAccessContext();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }
    const department = String(body.department || "").trim();
    if (department !== "Physio" && department !== "Dental") {
      return NextResponse.json({ ok: false, error: "INVALID_DEPARTMENT" }, { status: 400 });
    }
    const idempotencyKey = String(body.idempotencyKey || "").trim();
    if (!idempotencyKey) {
      return NextResponse.json({ ok: false, error: "INVALID_IDEMPOTENCY_KEY" }, { status: 400 });
    }
    const result = await requestRewardClaim({
      requestId: `rcl-${randomUUID()}`,
      idempotencyKey,
      actorId: tenantContext.access.staffId,
      actorRoles: tenantContext.access.roles,
      actorDepartmentAccess: tenantContext.access.departmentAccess,
      organizationId: tenantContext.tenant.organizationId,
      clinicId: tenantContext.tenant.clinicId,
      staffId: tenantContext.access.staffId,
      department,
      rewardKey: String(body.rewardKey || "").trim(),
      requestedFor: body.requestedFor ? String(body.requestedFor).trim() : null,
      requestNotes: String(body.requestNotes || "").trim(),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
