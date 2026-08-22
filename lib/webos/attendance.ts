import "server-only";

import { randomUUID } from "node:crypto";
import { fetchSheetRanges } from "@/lib/data/googleSheets";
import type { Scope } from "@/lib/types";
import { canPerform, assertCanPerform, type AccessContext } from "@/lib/webos/access";
import { getAppointmentsForContext, todayDhaka } from "@/lib/webos/reception";
import {
  getActiveWebStaffById,
  getWebStaffDirectory,
  type WebStaffIdentity,
} from "@/lib/webos/staffDirectory";
import {
  appendEntityWithAudit,
  replaceEntityRowWithAudit,
} from "@/lib/webos/sheetTransaction";
import { withMutationLock } from "@/lib/webos/mutationLock";

export type AttendanceAction = "check_in" | "break_out" | "break_in" | "check_out";

type SheetValue = string | number | boolean;

export interface AttendanceRecord {
  attendanceId: string;
  date: string;
  staffId: string;
  staffName: string;
  role: string;
  checkIn: string;
  breakOut: string;
  breakIn: string;
  checkOut: string;
  workingHours: number | null;
  lateMinutes: number;
  overtime: number;
  status: string;
  remarks: string;
}

export interface AttendanceLocationConfig {
  configured: boolean;
  radiusMeters: number;
  maxAccuracyMeters: number;
}

export interface DailyStaffStatus {
  staffId: string;
  fullName: string;
  role: string;
  department: string;
  state: "not_in" | "working" | "break" | "checked_out";
  checkIn: string;
  checkOut: string;
}

export interface DailyOperationsSnapshot {
  date: string;
  attendance: {
    self: AttendanceRecord | null;
    team: DailyStaffStatus[];
    location: AttendanceLocationConfig;
    canAct: boolean;
    canReadTeam: boolean;
  };
  appointments: Array<{
    appointmentId: string;
    time: string;
    patientId: string;
    patientName: string;
    department: "Physio" | "Dental";
    therapist: string;
    status: string;
  }>;
  appointmentCounts: {
    total: number;
    completed: number;
    open: number;
    missed: number;
  };
}

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

function rowForHeaders(headers: string[], values: Record<string, SheetValue>): SheetValue[] {
  const mapped = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value])
  );
  return headers.map((header) => mapped.get(normalize(header).toLowerCase()) ?? "");
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

function parseMinutes(value: string): number | null {
  const text = normalize(value).toUpperCase();
  if (!text) return null;
  let match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(text);
  if (match) {
    let hour = Number(match[1]) % 12;
    if (match[3] === "PM") hour += 12;
    return hour * 60 + Number(match[2]);
  }
  match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  return null;
}

function hoursBetween(start: string, end: string): number {
  const a = parseMinutes(start);
  const b = parseMinutes(end);
  if (a === null || b === null) return 0;
  let minutes = b - a;
  if (minutes < 0) minutes += 24 * 60;
  return minutes / 60;
}

function computeWorkingHours(row: AttendanceRecord, checkout: string): number {
  let total = hoursBetween(row.checkIn, checkout);
  if (row.breakOut && row.breakIn) total -= hoursBetween(row.breakOut, row.breakIn);
  return Math.max(0, Math.round(total * 100) / 100);
}

function parseAttendance(rows: string[][]): AttendanceRecord[] {
  if (rows.length < 2) return [];
  const h = rows[0];
  const idx = (name: string) => headerIndex(h, name);
  return rows.slice(1).flatMap((row) => {
    const attendanceId = at(row, idx("Attendance_ID"));
    if (!attendanceId) return [];
    const workingRaw = at(row, idx("Working_Hours"));
    return [{
      attendanceId,
      date: at(row, idx("Date")),
      staffId: at(row, idx("Staff_ID")),
      staffName: at(row, idx("Staff_Name")),
      role: at(row, idx("Role")),
      checkIn: at(row, idx("Check_In")),
      breakOut: at(row, idx("Break_Out")),
      breakIn: at(row, idx("Break_In")),
      checkOut: at(row, idx("Check_Out")),
      workingHours: workingRaw ? Number(workingRaw) : null,
      lateMinutes: Number(at(row, idx("Late_Minutes")) || 0),
      overtime: Number(at(row, idx("Overtime")) || 0),
      status: at(row, idx("Status")) || "Present",
      remarks: at(row, idx("Remarks")),
    }];
  });
}

function locationConfigInternal() {
  const latitude = Number(process.env.CLINIC_LATITUDE || "0");
  const longitude = Number(process.env.CLINIC_LONGITUDE || "0");
  const radiusMeters = Number(process.env.ATTENDANCE_RADIUS_METERS || "200");
  const maxAccuracyMeters = Number(process.env.ATTENDANCE_MAX_ACCURACY_METERS || "100");
  const configured =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude !== 0 &&
    longitude !== 0 &&
    Number.isFinite(radiusMeters) && radiusMeters > 0 &&
    Number.isFinite(maxAccuracyMeters) && maxAccuracyMeters > 0;
  return { latitude, longitude, radiusMeters, maxAccuracyMeters, configured };
}

export function getAttendanceLocationConfig(): AttendanceLocationConfig {
  const config = locationConfigInternal();
  return {
    configured: config.configured,
    radiusMeters: config.radiusMeters,
    maxAccuracyMeters: config.maxAccuracyMeters,
  };
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (v: number) => (v * Math.PI) / 180;
  const r = 6371000;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function verifyLocation(location: { latitude?: number; longitude?: number; accuracy?: number } | undefined) {
  const config = locationConfigInternal();
  if (!config.configured) throw new Error("ATTENDANCE_LOCATION_NOT_CONFIGURED");
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  const accuracy = Number(location?.accuracy);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy) || accuracy < 0) {
    throw new Error("ATTENDANCE_LOCATION_INVALID");
  }
  if (accuracy > config.maxAccuracyMeters) throw new Error("ATTENDANCE_LOCATION_ACCURACY");
  const distance = haversineMeters(latitude, longitude, config.latitude, config.longitude);
  if (distance > config.radiusMeters) throw new Error("ATTENDANCE_OUTSIDE_CLINIC");
  return { distance: Math.round(distance), accuracy: Math.round(accuracy) };
}

function auditRow(
  context: AccessContext,
  action: AttendanceAction,
  attendanceId: string,
  afterValue: string,
  reason: string,
  now: ReturnType<typeof dhakaNow>
): SheetValue[] {
  return [
    `AUD-${randomUUID()}`,
    now.timestamp,
    context.staffId,
    `attendance.${action}`,
    "Attendance",
    attendanceId,
    "",
    "",
    afterValue,
    reason,
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

export function attendanceMutationLockKey(staffId: string, date: string): string {
  return `attendance:${staffId.trim()}:${date.trim()}`;
}

export async function getTodayAttendance(): Promise<AttendanceRecord[]> {
  const snapshot = await fetchSheetRanges("physio", ["03_Attendance"]);
  return parseAttendance(snapshot["03_Attendance"] || []).filter((row) => row.date === todayDhaka());
}

export async function performAttendanceAction(
  context: AccessContext,
  action: AttendanceAction,
  location?: { latitude?: number; longitude?: number; accuracy?: number }
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
    if ([idIdx, dateIdx, staffIdx].some((idx) => idx < 0)) throw new Error("ATTENDANCE_SCHEMA_MISMATCH");

    const matches = rows.slice(1).map((row, offset) => ({ row, rowNumber: offset + 2 }))
      .filter(({ row }) => at(row, dateIdx) === now.date && at(row, staffIdx) === context.staffId);
    const currentRaw = matches.at(-1);
    const current = currentRaw ? parseAttendance([headers, currentRaw.row])[0] : null;
    let locationReason = "Web attendance action";

    if (action === "check_in") {
      if (current?.checkIn) throw new Error("ATTENDANCE_ALREADY_CHECKED_IN");
      const verified = verifyLocation(location);
      locationReason = `Location verified; distance=${verified.distance}m; accuracy=${verified.accuracy}m`;
      const attendanceId = `ATW${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
      const lateMinutes = Math.max(0, now.minuteOfDay - 9 * 60);
      const status = lateMinutes > 15 ? "Late" : "Present";
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
        Remarks: "Web PWA check-in",
        Organization_ID: "RELIFE",
        Clinic_ID: identity.primaryDepartment === "Dental" ? "RELIFE-DENTAL" : "RELIFE-PHYSIO",
        Branch_ID: "AMTALI-01",
        Record_ID: `RELIFE:${attendanceId}`,
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
        auditRow(context, action, attendanceId, now.displayTime, locationReason, now)
      );
      return { attendanceId, date: now.date, staffId: identity.staffId, staffName: identity.fullName, role: identity.roles[0] || "Staff", checkIn: now.displayTime, breakOut: "", breakIn: "", checkOut: "", workingHours: null, lateMinutes, overtime: 0, status, remarks: "Web PWA check-in" };
    }

    if (!current || !currentRaw) throw new Error("ATTENDANCE_NOT_CHECKED_IN");
    if (current.checkOut) throw new Error("ATTENDANCE_ALREADY_CHECKED_OUT");

    const values = rowForHeaders(headers, Object.fromEntries(headers.map((header, idx) => [header, currentRaw.row[idx] ?? ""]))) as SheetValue[];
    const set = (name: string, value: SheetValue) => {
      const index = headerIndex(headers, name);
      if (index < 0) throw new Error("ATTENDANCE_SCHEMA_MISMATCH");
      values[index] = value;
    };

    if (action === "break_out") {
      if (current.breakOut && !current.breakIn) throw new Error("ATTENDANCE_ALREADY_ON_BREAK");
      if (current.breakOut && current.breakIn) throw new Error("ATTENDANCE_BREAK_ALREADY_USED");
      set("Break_Out", now.displayTime);
      current.breakOut = now.displayTime;
    } else if (action === "break_in") {
      if (!current.breakOut) throw new Error("ATTENDANCE_BREAK_NOT_STARTED");
      if (current.breakIn) throw new Error("ATTENDANCE_BREAK_ALREADY_ENDED");
      set("Break_In", now.displayTime);
      current.breakIn = now.displayTime;
    } else if (action === "check_out") {
      if (current.breakOut && !current.breakIn) throw new Error("ATTENDANCE_BREAK_STILL_OPEN");
      const workingHours = computeWorkingHours(current, now.displayTime);
      const overtime = Math.max(0, Math.round((workingHours - 8) * 100) / 100);
      set("Check_Out", now.displayTime);
      set("Working_Hours", workingHours);
      set("Overtime", overtime);
      current.checkOut = now.displayTime;
      current.workingHours = workingHours;
      current.overtime = overtime;
    }
    set("Provenance_Timestamp", now.provenance);
    await replaceEntityRowWithAudit(
      "physio",
      "03_Attendance",
      currentRaw.rowNumber,
      values,
      auditRow(context, action, current.attendanceId, now.displayTime, locationReason, now)
    );
    return current;
  });
}

function staffInScope(identity: WebStaffIdentity, scope: Scope): boolean {
  if (scope === "combined") return true;
  const target = scope === "physio" ? "Physio" : "Dental";
  return identity.primaryDepartment === target;
}

function attendanceState(record: AttendanceRecord | undefined): DailyStaffStatus["state"] {
  if (!record?.checkIn) return "not_in";
  if (record.checkOut) return "checked_out";
  if (record.breakOut && !record.breakIn) return "break";
  return "working";
}

export async function getDailyOperationsSnapshot(
  context: AccessContext,
  scope: Scope
): Promise<DailyOperationsSnapshot> {
  const [appointments, attendanceRows, directory] = await Promise.all([
    getAppointmentsForContext(context, scope, todayDhaka()),
    getTodayAttendance(),
    getWebStaffDirectory(),
  ]);
  const own = attendanceRows.find((row) => row.staffId === context.staffId) || null;
  const canReadTeam = canPerform(context, "attendance.read_team", context.primaryDepartment);
  const teamIdentities = canReadTeam
    ? directory.filter((staff) => staff.status === "Active" && staffInScope(staff, scope))
    : directory.filter((staff) => staff.staffId === context.staffId);
  const team = teamIdentities.map((staff) => {
    const record = attendanceRows.find((row) => row.staffId === staff.staffId);
    return {
      staffId: staff.staffId,
      fullName: staff.fullName,
      role: staff.roles.join(" + ") || "Staff",
      department: staff.primaryDepartment || "-",
      state: attendanceState(record),
      checkIn: record?.checkIn || "",
      checkOut: record?.checkOut || "",
    };
  });
  const completed = appointments.filter((row) => row.status.toLowerCase() === "completed").length;
  const missed = appointments.filter((row) => ["cancelled", "canceled", "no-show"].includes(row.status.toLowerCase())).length;
  return {
    date: todayDhaka(),
    attendance: {
      self: own,
      team,
      location: getAttendanceLocationConfig(),
      canAct: canPerform(context, "attendance.self", context.primaryDepartment),
      canReadTeam,
    },
    appointments: appointments.map((row) => ({
      appointmentId: row.appointmentId,
      time: row.time,
      patientId: row.patientId,
      patientName: row.patientName,
      department: row.department,
      therapist: row.therapist,
      status: row.status,
    })),
    appointmentCounts: {
      total: appointments.length,
      completed,
      missed,
      open: Math.max(0, appointments.length - completed - missed),
    },
  };
}
