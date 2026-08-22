import { isValidIsoDate } from "./shiftPolicy.ts";
import type { LeaveStatus } from "./types.ts";

export const LEAVE_REASON_MAX_LENGTH = 500;
export const LEAVE_DECISION_NOTE_MAX_LENGTH = 500;

/** Inclusive Dhaka-local date range; a single-day leave has start === end. */
export function isValidLeaveDateRange(
  startDate: unknown,
  endDate: unknown
): boolean {
  if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate)) return false;
  return String(endDate) >= String(startDate);
}

export function boundedReason(value: unknown): string {
  return String(value ?? "").trim().slice(0, LEAVE_REASON_MAX_LENGTH);
}

export function boundedDecisionNote(value: unknown): string {
  return String(value ?? "").trim().slice(0, LEAVE_DECISION_NOTE_MAX_LENGTH);
}

/** Non-terminal = still able to conflict with a new request. */
const NON_TERMINAL_LEAVE_STATUSES: ReadonlySet<LeaveStatus> = new Set([
  "Pending",
  "Approved",
]);

export interface LeaveOverlapCandidate {
  leaveId: string;
  staffId: string;
  startDate: string;
  endDate: string;
  status: LeaveStatus;
}

/**
 * Reject overlap with active (Pending/Approved) leave for the same staff
 * member (issue #153). Two inclusive ranges overlap when
 * startA <= endB && startB <= endA.
 */
export function leaveOverlaps(
  candidate: { staffId: string; startDate: string; endDate: string },
  existing: LeaveOverlapCandidate[],
  excludeLeaveId?: string
): LeaveOverlapCandidate | null {
  for (const row of existing) {
    if (excludeLeaveId && row.leaveId === excludeLeaveId) continue;
    if (!NON_TERMINAL_LEAVE_STATUSES.has(row.status)) continue;
    if (row.staffId !== candidate.staffId) continue;
    if (candidate.startDate <= row.endDate && row.startDate <= candidate.endDate) {
      return row;
    }
  }
  return null;
}

const LEAVE_TRANSITIONS: Record<LeaveStatus, LeaveStatus[]> = {
  Pending: ["Approved", "Rejected", "Cancelled"],
  Approved: [],
  Rejected: [],
  Cancelled: [],
};

export function isValidLeaveTransition(
  from: LeaveStatus,
  to: LeaveStatus
): boolean {
  return LEAVE_TRANSITIONS[from]?.includes(to) ?? false;
}
