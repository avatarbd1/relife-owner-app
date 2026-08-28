import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import {
  finalizeMonthlyGamification,
  getMonthlyGamificationFinalization,
  type MonthlyRosterOpportunitySnapshot,
} from "@/lib/data/supabaseWeeklyGamification";
import { requireTenantFeature } from "@/lib/domain/tenancy/featureGuard";
import { GAMIFICATION_ELIGIBLE_STAFF_IDS } from "@/lib/domain/gamification/monthlyPolicy";
import { isValidRosterMonth } from "@/lib/domain/workforce/monthlyRoster";
import { timeToMinutes } from "@/lib/domain/workforce/shiftPolicy";
import { listShiftsForContext } from "@/lib/domain/workforce/shifts";
import { assertCanPerform } from "@/lib/webos/access";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

function statusFor(message: string): number {
  if (
    message === "ACCESS_DENIED" ||
    message === "OWNER_REQUIRED" ||
    message.startsWith("FEATURE_ACCESS_DENIED:")
  ) return 403;
  if (
    message === "ROSTER_MONTH_INVALID" ||
    message === "INVALID_MONTH" ||
    message === "MONTH_NOT_FINISHED" ||
    message === "MONTHLY_ROSTER_SNAPSHOT_INVALID"
  ) return 400;
  if (
    message === "MONTHLY_ROSTER_NOT_PUBLISHED" ||
    message === "MONTHLY_SCORE_INCOMPLETE" ||
    message === "MONTHLY_RC_BUDGET_EXCEEDED"
  ) return 409;
  if (
    message === "WORKFORCE_SCHEMA_NOT_PROVISIONED" ||
    message === "GAMIFICATION_EDGE_SECRET_MISSING" ||
    message === "MONTHLY_REWARD_CONFIG_MISSING"
  ) return 503;
  return 500;
}

function rosterOpportunity(
  month: string,
  shifts: Awaited<ReturnType<typeof listShiftsForContext>>
): MonthlyRosterOpportunitySnapshot[] {
  return GAMIFICATION_ELIGIBLE_STAFF_IDS.map((staffId) => {
    const published = shifts.filter((shift) =>
      shift.staffId === staffId &&
      shift.status === "Published" &&
      shift.shiftDate.startsWith(`${month}-`)
    );
    const publishedScheduledMinutes = published.reduce((sum, shift) => {
      const start = timeToMinutes(shift.startTime);
      const end = timeToMinutes(shift.endTime);
      if (start === null || end === null || end <= start) throw new Error("WORKFORCE_DATA_INVALID");
      return sum + (end - start);
    }, 0);
    return { staffId, publishedScheduledMinutes, publishedShiftCount: published.length };
  });
}

export async function GET(request: NextRequest) {
  try {
    const tenantContext = await requireCurrentTenantAccessContext();
    await requireTenantFeature(tenantContext.tenant, "optional.gamification");
    assertCanPerform(tenantContext.access, "performance.weekly.finalize", "All");
    const month = request.nextUrl.searchParams.get("month")?.trim() || undefined;
    if (month && !isValidRosterMonth(month)) throw new Error("ROSTER_MONTH_INVALID");
    const finalization = await getMonthlyGamificationFinalization(
      tenantContext.tenant.organizationId,
      tenantContext.tenant.clinicId,
      month
    );
    return NextResponse.json({ ok: true, finalization });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MONTHLY_STATUS_FAILED";
    if (statusFor(message) === 500) console.error("Monthly Gamification status failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: statusFor(message) });
  }
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const tenantContext = await requireCurrentTenantAccessContext();
    await requireTenantFeature(tenantContext.tenant, "optional.gamification");
    assertCanPerform(tenantContext.access, "performance.weekly.finalize", "All");
    if (!tenantContext.access.roles.includes("Owner")) throw new Error("OWNER_REQUIRED");
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const month = String(body.month || "").trim();
    if (!isValidRosterMonth(month)) throw new Error("ROSTER_MONTH_INVALID");
    const shifts = await listShiftsForContext(tenantContext.access);
    const rosterSnapshot = rosterOpportunity(month, shifts);
    if (rosterSnapshot.some((item) => item.publishedScheduledMinutes <= 0 || item.publishedShiftCount <= 0)) {
      throw new Error("MONTHLY_ROSTER_NOT_PUBLISHED");
    }
    const result = await finalizeMonthlyGamification({
      actorId: tenantContext.access.staffId,
      actorRoles: tenantContext.access.roles,
      organizationId: tenantContext.tenant.organizationId,
      clinicId: tenantContext.tenant.clinicId,
      month,
      rosterSnapshot,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MONTHLY_FINALIZE_FAILED";
    if (statusFor(message) === 500) console.error("Monthly Gamification finalize failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: statusFor(message) });
  }
}
