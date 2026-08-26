import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import {
  finalizeWeeklyGamification,
  getWeeklyGamificationFinalization,
} from "@/lib/data/supabaseWeeklyGamification";
import { assertCanPerform } from "@/lib/webos/access";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

function statusFor(message: string): number {
  if (message === "ACCESS_DENIED" || message === "OWNER_REQUIRED") return 403;
  if (
    message === "INVALID_WEEK_START" ||
    message === "WEEK_START_MUST_BE_MONDAY" ||
    message === "WEEK_NOT_FINISHED"
  ) return 400;
  if (
    message === "LEGACY_FINAL_WEEK_EXISTS" ||
    message === "WEEKLY_PERFORMANCE_ALREADY_FINALIZED"
  ) return 409;
  if (message === "GAMIFICATION_EDGE_SECRET_MISSING") return 503;
  return 500;
}

export async function GET(request: NextRequest) {
  try {
    const { access, tenant } = await requireCurrentTenantAccessContext();
    assertCanPerform(access, "performance.weekly.finalize", "All");
    const weekStart = request.nextUrl.searchParams.get("weekStart")?.trim() || undefined;
    const finalization = await getWeeklyGamificationFinalization(
      tenant.organizationId,
      tenant.clinicId,
      weekStart
    );
    return NextResponse.json({ ok: true, finalization });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WEEKLY_STATUS_FAILED";
    if (statusFor(message) === 500) console.error("Weekly Gamification status failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: statusFor(message) });
  }
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const { access, tenant } = await requireCurrentTenantAccessContext();
    assertCanPerform(access, "performance.weekly.finalize", "All");
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const weekStart = String(body.weekStart || "").trim() || undefined;
    const result = await finalizeWeeklyGamification({
      actorId: access.staffId,
      actorRoles: access.roles,
      organizationId: tenant.organizationId,
      clinicId: tenant.clinicId,
      weekStart,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WEEKLY_FINALIZE_FAILED";
    if (statusFor(message) === 500) console.error("Weekly Gamification finalize failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: statusFor(message) });
  }
}
