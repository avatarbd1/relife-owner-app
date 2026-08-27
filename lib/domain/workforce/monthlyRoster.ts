import type { WorkforceDepartment } from "./types.ts";
import { isValidIsoDate, shiftDateWithinLeaveRange, shiftOverlaps } from "./shiftPolicy.ts";

export type MonthlyRosterRole = "Receptionist" | "Therapist" | "Dentist" | "Manager";

export interface MonthlyRosterProfile {
  staffId: string;
  department: WorkforceDepartment;
  role: MonthlyRosterRole;
  segments: ReadonlyArray<{ startTime: string; endTime: string }>;
  halfDayWeekday: number;
}

export interface MonthlyRosterEntry {
  staffId: string;
  department: WorkforceDepartment;
  role: MonthlyRosterRole;
  shiftDate: string;
  startTime: string;
  endTime: string;
  weeklyHalfDay: boolean;
}

export interface MonthlyRosterLeaveRange {
  staffId: string;
  startDate: string;
  endDate: string;
}

export const ROLE_SHIFT_SEGMENTS: Record<MonthlyRosterRole, ReadonlyArray<{ startTime: string; endTime: string }>> = {
  Receptionist: [{ startTime: "09:00", endTime: "13:00" }, { startTime: "15:00", endTime: "20:00" }],
  Therapist: [{ startTime: "09:30", endTime: "13:00" }, { startTime: "15:00", endTime: "20:30" }],
  Dentist: [{ startTime: "10:00", endTime: "13:00" }, { startTime: "15:00", endTime: "21:00" }],
  Manager: [{ startTime: "12:00", endTime: "18:00" }],
};

export const MONTHLY_ROSTER_PROFILES: readonly MonthlyRosterProfile[] = [
  { staffId: "ST002", department: "Dental", role: "Receptionist", segments: ROLE_SHIFT_SEGMENTS.Receptionist, halfDayWeekday: 6 },
  { staffId: "ST003", department: "Physio", role: "Therapist", segments: ROLE_SHIFT_SEGMENTS.Therapist, halfDayWeekday: 0 },
  // Owner-approved exception: Avro keeps the canonical Receptionist role but works 12:00-18:00.
  { staffId: "ST004", department: "Physio", role: "Receptionist", segments: [{ startTime: "12:00", endTime: "18:00" }], halfDayWeekday: 1 },
  { staffId: "ST005", department: "Physio", role: "Therapist", segments: ROLE_SHIFT_SEGMENTS.Therapist, halfDayWeekday: 2 },
  // ST007 remains operationally rostered but is intentionally excluded from gamification.
  { staffId: "ST007", department: "Dental", role: "Receptionist", segments: ROLE_SHIFT_SEGMENTS.Receptionist, halfDayWeekday: 3 },
  { staffId: "ST008", department: "Physio", role: "Receptionist", segments: ROLE_SHIFT_SEGMENTS.Receptionist, halfDayWeekday: 4 },
  { staffId: "ST010", department: "Dental", role: "Dentist", segments: ROLE_SHIFT_SEGMENTS.Dentist, halfDayWeekday: 5 },
  { staffId: "ST011", department: "Physio", role: "Therapist", segments: ROLE_SHIFT_SEGMENTS.Therapist, halfDayWeekday: 6 },
] as const;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidRosterMonth(value: unknown): value is string {
  return MONTH.test(String(value ?? "").trim());
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function halfDaySegments(profile: MonthlyRosterProfile): ReadonlyArray<{ startTime: string; endTime: string }> {
  if (profile.segments.length > 1) return [profile.segments[0]];
  const segment = profile.segments[0];
  const [startHour, startMinute] = segment.startTime.split(":").map(Number);
  const [endHour, endMinute] = segment.endTime.split(":").map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  const midpoint = start + Math.floor((end - start) / 2);
  return [{
    startTime: segment.startTime,
    endTime: `${String(Math.floor(midpoint / 60)).padStart(2, "0")}:${String(midpoint % 60).padStart(2, "0")}`,
  }];
}

/** Deterministic Dhaka-local monthly plan. Each staff member gets one staggered half-day per Saturday-Friday week. */
export function generateMonthlyRoster(month: string): MonthlyRosterEntry[] {
  if (!isValidRosterMonth(month)) throw new Error("ROSTER_MONTH_INVALID");
  const [year, monthNumber] = month.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, monthNumber - 1, 1));
  const entries: MonthlyRosterEntry[] = [];
  while (cursor.getUTCFullYear() === year && cursor.getUTCMonth() === monthNumber - 1) {
    const shiftDate = isoDate(cursor);
    for (const profile of MONTHLY_ROSTER_PROFILES) {
      const weeklyHalfDay = cursor.getUTCDay() === profile.halfDayWeekday;
      const segments = weeklyHalfDay ? halfDaySegments(profile) : profile.segments;
      for (const segment of segments) {
        entries.push({
          staffId: profile.staffId,
          department: profile.department,
          role: profile.role,
          shiftDate,
          startTime: segment.startTime,
          endTime: segment.endTime,
          weeklyHalfDay,
        });
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return entries;
}

export function monthlyRosterConflictCodes(input: {
  entries: MonthlyRosterEntry[];
  existing: Array<{ shiftId: string; staffId: string; shiftDate: string; startTime: string; endTime: string; status: "Draft" | "Published" | "Cancelled" }>;
  approvedLeave: MonthlyRosterLeaveRange[];
}): string[] {
  const conflicts = new Set<string>();
  for (const entry of input.entries) {
    if (!isValidIsoDate(entry.shiftDate)) conflicts.add("ROSTER_PLAN_INVALID");
    if (shiftOverlaps(entry, input.existing)) conflicts.add(`SHIFT_OVERLAP:${entry.staffId}:${entry.shiftDate}`);
    const leave = input.approvedLeave.some((range) =>
      range.staffId === entry.staffId &&
      shiftDateWithinLeaveRange(entry.shiftDate, range.startDate, range.endDate)
    );
    if (leave) conflicts.add(`SHIFT_LEAVE_CONFLICT:${entry.staffId}:${entry.shiftDate}`);
  }
  return [...conflicts].sort();
}
