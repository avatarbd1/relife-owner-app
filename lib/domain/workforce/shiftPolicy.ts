import type { ShiftStatus } from "./types.ts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_24H = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const SHIFT_NOTES_MAX_LENGTH = 500;

export function isValidIsoDate(value: unknown): value is string {
  const text = String(value ?? "").trim();
  if (!ISO_DATE.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function timeToMinutes(value: unknown): number | null {
  const text = String(value ?? "").trim();
  const match = TIME_24H.exec(text);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Date-specific shifts only (issue #153): start and end must fall on the
 * same calendar day, so an overnight/wrapping shift is rejected rather than
 * silently truncated.
 */
export function isValidShiftTimeRange(
  startTime: unknown,
  endTime: unknown
): boolean {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start === null || end === null) return false;
  return end > start;
}

export function boundedNotes(value: unknown): string {
  return String(value ?? "").trim().slice(0, SHIFT_NOTES_MAX_LENGTH);
}

export interface ShiftOverlapCandidate {
  shiftId: string;
  staffId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  status: ShiftStatus;
}

/**
 * Reject overlapping non-cancelled shifts for the same staff member
 * (issue #153). Two ranges on the same date overlap when
 * startA < endB && startB < endA.
 */
export function shiftOverlaps(
  candidate: { staffId: string; shiftDate: string; startTime: string; endTime: string },
  existing: ShiftOverlapCandidate[],
  excludeShiftId?: string
): ShiftOverlapCandidate | null {
  const candidateStart = timeToMinutes(candidate.startTime);
  const candidateEnd = timeToMinutes(candidate.endTime);
  if (candidateStart === null || candidateEnd === null) return null;

  for (const row of existing) {
    if (excludeShiftId && row.shiftId === excludeShiftId) continue;
    if (row.status === "Cancelled") continue;
    if (row.staffId !== candidate.staffId) continue;
    if (row.shiftDate !== candidate.shiftDate) continue;
    const rowStart = timeToMinutes(row.startTime);
    const rowEnd = timeToMinutes(row.endTime);
    if (rowStart === null || rowEnd === null) continue;
    if (candidateStart < rowEnd && rowStart < candidateEnd) return row;
  }
  return null;
}

const SHIFT_TRANSITIONS: Record<ShiftStatus, ShiftStatus[]> = {
  Draft: ["Published", "Cancelled"],
  Published: ["Cancelled"],
  Cancelled: [],
};

export function isValidShiftTransition(
  from: ShiftStatus,
  to: ShiftStatus
): boolean {
  return SHIFT_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Publishing against Approved leave must fail closed (issue #153). Leave
 * ranges are inclusive Dhaka-local dates; a shift on any day inside an
 * Approved range is a conflict.
 */
export function shiftDateWithinLeaveRange(
  shiftDate: string,
  leaveStart: string,
  leaveEnd: string
): boolean {
  return shiftDate >= leaveStart && shiftDate <= leaveEnd;
}
