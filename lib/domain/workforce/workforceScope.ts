/**
 * Relative import (not the "@/" alias) so this pure scoping module can be
 * imported directly by node:test files without a bundler resolving path
 * aliases — mirrors the plain-relative style already used by
 * lib/domain/clinical/sessionRequest.ts for the same reason.
 */
import { canPerform, type AccessContext } from "../../webos/access.ts";
import type { LeaveRecord, ShiftRecord } from "./types.ts";

/**
 * Owner/Manager "manage" the whole department (issue #153: "Manager:
 * read/manage department shifts; read/decide department leave"). Everyone
 * else only ever sees their own Published shifts / own leave. Auditor is a
 * third, redacted-coverage tier — never full detail, never a mutation
 * target.
 */
export function isWorkforceManagerTier(context: AccessContext): boolean {
  return context.roles.includes("Owner") || context.roles.includes("Manager");
}

export function isWorkforceAuditor(context: AccessContext): boolean {
  return context.roles.includes("Auditor");
}

/**
 * Combines department access AND the actual shift.read/leave.read
 * WebAction — canAccessDepartment alone is not enough, since a role with
 * some departmentAccess but no granted workforce action (Dental_Assistant,
 * System Admin) must still see nothing.
 */
function readableShiftRows(context: AccessContext, rows: ShiftRecord[]): ShiftRecord[] {
  return rows.filter((row) => canPerform(context, "shift.read", row.department));
}

function readableLeaveRows(context: AccessContext, rows: LeaveRecord[]): LeaveRecord[] {
  return rows.filter((row) => canPerform(context, "leave.read", row.department));
}

/**
 * Server-side visibility for GET /api/workforce/shifts. UI hiding is not
 * authorization — this is the actual boundary. Auditor never receives
 * free-text Notes; Receptionist/Therapist/Dentist never receive Draft rows
 * or any other staff member's shift, direct-ID or not.
 */
export function visibleShifts(
  context: AccessContext,
  rows: ShiftRecord[]
): ShiftRecord[] {
  const scoped = readableShiftRows(context, rows);
  if (isWorkforceManagerTier(context)) return scoped;
  if (isWorkforceAuditor(context)) {
    return scoped
      .filter((row) => row.status === "Published")
      .map((row) => ({
        ...row,
        notes: "",
        requestId: "",
        createdBy: "",
        updatedBy: "",
      }));
  }
  return scoped.filter(
    (row) => row.status === "Published" && row.staffId === context.staffId
  );
}

/**
 * Server-side visibility for GET /api/workforce/leave. Auditor never
 * receives Reason/Decision_Note free text (issue #153, explicit). Everyone
 * below manager tier only ever sees their own requests.
 */
export function visibleLeave(
  context: AccessContext,
  rows: LeaveRecord[]
): LeaveRecord[] {
  const scoped = readableLeaveRows(context, rows);
  if (isWorkforceManagerTier(context)) return scoped;
  if (isWorkforceAuditor(context)) {
    return scoped.map((row) => ({
      ...row,
      reason: "",
      decisionNote: "",
      requestId: "",
      decidedBy: "",
      requestedAt: "",
      decidedAt: "",
      updatedBy: "",
      updatedAt: "",
    }));
  }
  return scoped.filter((row) => row.staffId === context.staffId);
}

/**
 * A single shift/leave row is visible to this staff member as a direct-ID
 * read target (used before every mutation so a cross-department or
 * cross-staff ID guess cannot be probed via a different error shape).
 */
export function canReachShiftRow(
  context: AccessContext,
  row: ShiftRecord
): boolean {
  if (!canPerform(context, "shift.read", row.department)) return false;
  if (isWorkforceManagerTier(context)) return true;
  if (isWorkforceAuditor(context)) return row.status === "Published";
  // Own Draft rows are not "own Published shifts" (issue #153) — a direct
  // Shift_ID guess must be denied exactly like the list view already is.
  return row.staffId === context.staffId && row.status === "Published";
}

export function canReachLeaveRow(
  context: AccessContext,
  row: LeaveRecord
): boolean {
  if (!canPerform(context, "leave.read", row.department)) return false;
  if (isWorkforceManagerTier(context)) return true;
  if (isWorkforceAuditor(context)) return true;
  return row.staffId === context.staffId;
}
