import { NextRequest, NextResponse } from "next/server";
import {
  gamificationDepartmentForContext,
  recordActorWorkGamification,
} from "@/lib/domain/gamification/events";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import {
  performAttendanceAction,
  type AttendanceAction,
} from "@/lib/webos/attendance";
import { performNormalAttendanceCheckIn } from "@/lib/webos/attendanceNormal";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

const ACTIONS = new Set<AttendanceAction>([
  "check_in",
  "break_out",
  "break_in",
  "check_out",
]);

function statusFor(error: string): number {
  if (error === "ACCESS_DENIED") return 403;
  if (error === "INVALID_ACTION") return 400;
  if (error === "ATTENDANCE_SCHEMA_MISMATCH") return 503;
  if (error.startsWith("ATTENDANCE_")) return 409;
  return 500;
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json(
      { ok: false, error: "Origin rejected" },
      { status: 403 }
    );
  }
  try {
    const tenantContext = await requireCurrentTenantAccessContext();
    const { access, tenant } = tenantContext;
    const body = await request.json().catch(() => null);
    const action = body?.action as AttendanceAction;
    if (!ACTIONS.has(action)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_ACTION" },
        { status: 400 }
      );
    }

    const record =
      action === "check_in"
        ? await performNormalAttendanceCheckIn(access, tenant.organizationId, tenant.clinicId)
        : await performAttendanceAction(access, tenant.organizationId, tenant.clinicId, action);

    if (action === "check_in") {
      const department = gamificationDepartmentForContext(access);
      if (department) {
        const eventType =
          Number(record.lateMinutes || 0) <= 2
            ? "attendance_on_time"
            : "attendance_check_in";
        await recordActorWorkGamification({
          tenant,
          context: access,
          department,
          purpose: "attendance",
          eventType,
          eventKey: `attendance:${record.attendanceId}:check_in:v2`,
          sourceType: "attendance_check_in",
          sourceId: record.attendanceId,
          eventAt: new Date().toISOString(),
          metricValue: 1,
          reason:
            eventType === "attendance_on_time"
              ? "Verified on-time attendance"
              : "Verified attendance check-in",
          verificationMethod: "canonical_attendance_check_in",
          payload: {
            attendanceId: record.attendanceId,
            date: record.date,
            checkIn: record.checkIn,
            lateMinutes: record.lateMinutes,
            attendanceStatus: record.status,
          },
        });
      }
    }

    return NextResponse.json({ ok: true, record });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "ATTENDANCE_ACTION_FAILED";
    if (statusFor(message) === 500) {
      console.error("Attendance action failed", error);
    }
    return NextResponse.json(
      { ok: false, error: message },
      { status: statusFor(message) }
    );
  }
}
