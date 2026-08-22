import type { Department } from "@/lib/types";

/** Shift = planned work. Never attendance (actual presence) or leave (absence). */
export type ShiftStatus = "Draft" | "Published" | "Cancelled";

/** Leave = requested/approved absence. Never attendance or a reward/perk claim. */
export type LeaveStatus = "Pending" | "Approved" | "Rejected" | "Cancelled";

/**
 * Explicit small allowlist. Reward-catalog "leave-flavored" perk kinds
 * (two_hour_early_leave, priority_weekly_off, half_day_family_time, ...)
 * live in lib/webos/performanceRewards.ts and are incentive claims, not
 * general leave — they are a different domain and must never be accepted
 * here.
 */
export const LEAVE_TYPES = [
  "Sick",
  "Casual",
  "Earned",
  "Unpaid",
  "Emergency",
] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const WorkforceDepartments = ["Physio", "Dental"] as const;
export type WorkforceDepartment = "Physio" | "Dental";

export function isWorkforceDepartment(
  value: unknown
): value is WorkforceDepartment {
  return value === "Physio" || value === "Dental";
}

export function isLeaveType(value: unknown): value is LeaveType {
  return (LEAVE_TYPES as readonly string[]).includes(String(value ?? ""));
}

export function isShiftStatus(value: unknown): value is ShiftStatus {
  return value === "Draft" || value === "Published" || value === "Cancelled";
}

export function isLeaveStatus(value: unknown): value is LeaveStatus {
  return value === "Pending" || value === "Approved" || value === "Rejected" || value === "Cancelled";
}

export interface ShiftRecord {
  shiftId: string;
  staffId: string;
  staffName: string;
  department: Department;
  shiftDate: string;
  startTime: string;
  endTime: string;
  status: ShiftStatus;
  notes: string;
  requestId: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface LeaveRecord {
  leaveId: string;
  staffId: string;
  staffName: string;
  department: Department;
  leaveType: LeaveType | string;
  startDate: string;
  endDate: string;
  reason: string;
  status: LeaveStatus;
  requestId: string;
  requestedAt: string;
  decidedBy: string;
  decidedAt: string;
  decisionNote: string;
  updatedBy: string;
  updatedAt: string;
}

/** Auditor-safe view: never Notes/Reason/Decision_Note free text. */
export type ShiftCoverageView = Omit<ShiftRecord, "notes">;
export type LeaveSummaryView = Omit<LeaveRecord, "reason" | "decisionNote">;

export const STAFF_SHIFTS_SHEET = "Staff_Shifts";
export const LEAVE_REQUESTS_SHEET = "Leave_Requests";

export const STAFF_SHIFTS_HEADERS = [
  "Shift_ID",
  "Staff_ID",
  "Department",
  "Shift_Date",
  "Start_Time",
  "End_Time",
  "Status",
  "Notes",
  "Request_ID",
  "Created_By",
  "Created_At",
  "Updated_By",
  "Updated_At",
] as const;

export const LEAVE_REQUESTS_HEADERS = [
  "Leave_ID",
  "Staff_ID",
  "Department",
  "Leave_Type",
  "Start_Date",
  "End_Date",
  "Reason",
  "Status",
  "Request_ID",
  "Requested_At",
  "Decided_By",
  "Decided_At",
  "Decision_Note",
  "Updated_By",
  "Updated_At",
] as const;
