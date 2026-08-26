import "server-only";

import { randomUUID } from "node:crypto";
import { fetchSheetRanges } from "@/lib/data/googleSheets";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import { getActiveWebStaffById } from "@/lib/webos/staffDirectory";
import {
  attendanceMutationLockKey,
  type AttendanceRecord,
} from "@/lib/webos/attendance";
import { appendEntityWithAudit } from "@/lib/webos/sheetTransaction";
import { withMutationLock } from "@/lib/webos/mutationLock";

type SheetValue = string | number | boolean;

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function headerIndex(headers: string[], name: string): number {
  const needle = name.toLowerCase();
  return headers.findIndex((header) => normalize(header).toLowerCase() === needle);
}

function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
}

function rowForHeaders(
  headers: string[],
  values: Record<string, SheetValue>
): SheetValue[] {
  const mapped = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value])
  );
  return headers.map(
    (header) => mapped.get(normalize(header).toLowerCase()) ?? ""
  );
}

function dhakaNow(ref = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(ref);
  const v = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${v.year}-${v.month}-${v.day}`;
  const hour24 = Number(v.hour) % 24;
  const minute = Number(v.minute);
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  const displayTime = `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${suffix}`;
  return {
    date,
    displayTime,
    timestamp: `${date} ${displayTime}`,
    provenance: ref.toISOString(),
    minuteOfDay: hour24 * 60 + minute,
  };
}

function auditRow(
  context: AccessContext,
  attendanceId: string,
  checkInTime: string,
  now: ReturnType<typeof dhakaNow>
): SheetValue[] {
  return [
    `AUD-${randomUUID()}`,
    now.timestamp,
    context.staffId,
    "attendance.check_in",
    "Attendance",
    attendanceId,
    "",
    "",
    checkInTime,
    "Normal Web PWA attendance; GPS not required by clinic policy",
    "RELIFE",
    "RELIFE-PHYSIO",
    "AMTALI-01",
    `RELIFE-PHYSIO:${attendanceId}`,
    "",
    context.staffId,
    "web_pwa",
    "human_entry",
    false,
    true,
    "relife-uda-v1",
    now.provenance,
    "All",
  ];
}

export async function performNormalAttendanceCheckIn(
  context: AccessContext,
  organizationId: string,
  clinicId: string
): Promise<AttendanceRecord> {
  assertCanPerform(context, "attendance.self", context.primaryDepartment);
  const identity = await getActiveWebStaffById(context.staffId);
  if (!identity) throw new Error("STAFF_NOT_FOUND");

  const now = dhakaNow();
  const lockKey = attendanceMutationLockKey(context.staffId, now.date);

  return withMutationLock(lockKey, async () => {
    const snapshot = await fetchSheetRanges("physio", ["03_Attendance"]);
    const rows = snapshot["03_Attendance"] || [];
    if (rows.length === 0) throw new Error("ATTENDANCE_SCHEMA_MISMATCH");

    const headers = rows[0];
    const idIdx = headerIndex(headers, "Attendance_ID");
    const dateIdx = headerIndex(headers, "Date");
    const staffIdx = headerIndex(headers, "Staff_ID");
    const checkInIdx = headerIndex(headers, "Check_In");
    if ([idIdx, dateIdx, staffIdx, checkInIdx].some((idx) => idx < 0)) {
      throw new Error("ATTENDANCE_SCHEMA_MISMATCH");
    }

    const alreadyCheckedIn = rows.slice(1).some(
      (row) =>
        at(row, dateIdx) === now.date &&
        at(row, staffIdx) === context.staffId &&
        Boolean(at(row, checkInIdx))
    );
    if (alreadyCheckedIn) throw new Error("ATTENDANCE_ALREADY_CHECKED_IN");

    const attendanceId = `ATW${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    const lateMinutes = Math.max(0, now.minuteOfDay - 9 * 60);
    const status = lateMinutes > 15 ? "Late" : "Present";
    const remarks = "Web PWA check-in · GPS not required";

    const values: Record<string, SheetValue> = {
      Attendance_ID: attendanceId,
      Date: now.date,
      Staff_ID: identity.staffId,
      Staff_Name: identity.fullName,
      Role: identity.roles[0] || "Staff",
      Check_In: now.displayTime,
      Break_Out: "",
      Break_In: "",
      Check_Out: "",
      Working_Hours: "",
      Late_Minutes: lateMinutes,
      Overtime: 0,
      Status: status,
      Remarks: remarks,
      Organization_ID: organizationId,
      Clinic_ID: clinicId,
      Branch_ID: "AMTALI-01",
      Record_ID: `${clinicId}:${attendanceId}`,
      Provider_ID: context.staffId,
      Source_System: "web_pwa",
      Source_Type: "human_entry",
      AI_Generated: false,
      Human_Verified: true,
      Schema_Version: "relife-uda-v1",
      Provenance_Timestamp: now.provenance,
    };

    await appendEntityWithAudit(
      "physio",
      "03_Attendance",
      rowForHeaders(headers, values),
      auditRow(context, attendanceId, now.displayTime, now)
    );

    return {
      attendanceId,
      date: now.date,
      staffId: identity.staffId,
      staffName: identity.fullName,
      role: identity.roles[0] || "Staff",
      checkIn: now.displayTime,
      breakOut: "",
      breakIn: "",
      checkOut: "",
      workingHours: null,
      lateMinutes,
      overtime: 0,
      status,
      remarks,
    };
  });
}
