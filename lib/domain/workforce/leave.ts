import "server-only";

import type { Department } from "@/lib/types";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import { dhakaClockParts } from "@/lib/config/relifeSystem";
import { getActiveWebStaffById, getWebStaffDirectory } from "@/lib/webos/staffDirectory";
import { withMutationLock } from "@/lib/webos/mutationLock";
import {
  boundedDecisionNote,
  boundedReason,
  isValidLeaveDateRange,
  isValidLeaveTransition,
  leaveOverlaps,
} from "./leavePolicy";
import {
  appendRowRequest,
  at,
  buildWorkforceAuditRow,
  commitWorkforceBatch,
  DATA_AUDIT_SHEET,
  headerIndex,
  newEntityId,
  normalize,
  readDataAuditSheet,
  readWorkforceSheet,
  requireSheetId,
  rowForHeaders,
  updateCellRequest,
  workforceSheetIdMap,
} from "./sheetsIo";
import {
  findWorkforceRequest,
  validateWorkforceRequestId,
  workforceRequestLedger,
} from "./workforceRequest";
import {
  LEAVE_REQUESTS_HEADERS,
  LEAVE_REQUESTS_SHEET,
  isLeaveType,
  isLeaveStatus,
  isWorkforceDepartment,
  type LeaveRecord,
  type LeaveStatus,
} from "./types";
import { canReachLeaveRow, isWorkforceManagerTier, visibleLeave } from "./workforceScope";

function parseLeaveRow(headers: string[], row: string[]): LeaveRecord {
  const idx = (name: string) => headerIndex(headers, name);
  const leaveId = at(row, idx("Leave_ID"));
  const staffId = at(row, idx("Staff_ID"));
  const department = at(row, idx("Department"));
  const leaveType = at(row, idx("Leave_Type"));
  const startDate = at(row, idx("Start_Date"));
  const endDate = at(row, idx("End_Date"));
  const status = at(row, idx("Status"));
  const requestId = at(row, idx("Request_ID"));
  if (
    !leaveId || !staffId || !isWorkforceDepartment(department) ||
    !isLeaveType(leaveType) || !isValidLeaveDateRange(startDate, endDate) ||
    !isLeaveStatus(status)
  ) {
    throw new Error("WORKFORCE_DATA_INVALID");
  }
  validateWorkforceRequestId(requestId);
  return {
    leaveId,
    staffId,
    staffName: "",
    department,
    leaveType,
    startDate,
    endDate,
    reason: at(row, idx("Reason")),
    status,
    requestId,
    requestedAt: at(row, idx("Requested_At")),
    decidedBy: at(row, idx("Decided_By")),
    decidedAt: at(row, idx("Decided_At")),
    decisionNote: at(row, idx("Decision_Note")),
    updatedBy: at(row, idx("Updated_By")),
    updatedAt: at(row, idx("Updated_At")),
  };
}

async function readLeaveRecords(): Promise<{ headers: string[]; records: LeaveRecord[] }> {
  const { headers, dataRows } = await readWorkforceSheet(
    LEAVE_REQUESTS_SHEET,
    LEAVE_REQUESTS_HEADERS
  );
  return { headers, records: dataRows.map((row) => parseLeaveRow(headers, row)) };
}

async function withStaffNames(records: LeaveRecord[]): Promise<LeaveRecord[]> {
  if (records.length === 0) return records;
  const directory = await getWebStaffDirectory();
  const nameById = new Map(directory.map((item) => [item.staffId, item.fullName]));
  return records.map((record) => ({
    ...record,
    staffName: nameById.get(record.staffId) || record.staffId,
  }));
}

export async function listLeaveForContext(context: AccessContext): Promise<LeaveRecord[]> {
  const { records } = await readLeaveRecords();
  return visibleLeave(context, await withStaffNames(records));
}

export async function getLeaveForContext(
  context: AccessContext,
  leaveId: string
): Promise<LeaveRecord | null> {
  const { records } = await readLeaveRecords();
  const [record] = await withStaffNames(
    records.filter((row) => row.leaveId === normalize(leaveId))
  );
  if (!record) return null;
  return canReachLeaveRow(context, record) ? record : null;
}

/**
 * Used by shift publish to enforce "publishing a shift that overlaps
 * Approved leave must fail closed" (issue #153) without leaking Reason.
 */
export async function readApprovedLeaveRangesForStaff(
  staffId: string
): Promise<Array<{ startDate: string; endDate: string }>> {
  const { records } = await readLeaveRecords();
  return records
    .filter((row) => row.staffId === staffId && row.status === "Approved")
    .map((row) => ({ startDate: row.startDate, endDate: row.endDate }));
}

export interface RequestLeaveInput {
  department: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason?: string;
  requestId: string;
}

/**
 * Staff request only for self (issue #153) — staffId is never accepted from
 * the client; it is always the caller's own context.staffId, matching the
 * existing attendance.self / clinical self-action convention.
 */
export async function requestLeave(
  context: AccessContext,
  input: RequestLeaveInput
): Promise<{ leaveId: string; status: LeaveStatus; duplicate: boolean }> {
  const staffId = context.staffId;
  if (!isWorkforceDepartment(input.department)) throw new Error("LEAVE_DEPARTMENT_INVALID");
  assertCanPerform(context, "leave.request", input.department);
  if (!isLeaveType(input.leaveType)) throw new Error("LEAVE_TYPE_INVALID");
  if (!isValidLeaveDateRange(input.startDate, input.endDate)) {
    throw new Error("LEAVE_DATE_RANGE_INVALID");
  }
  const requestId = validateWorkforceRequestId(input.requestId);
  const reason = boundedReason(input.reason);

  const identity = await getActiveWebStaffById(staffId);
  if (!identity) throw new Error("STAFF_NOT_FOUND");
  if (
    !identity.departmentAccess.includes(input.department as Department) &&
    !identity.departmentAccess.includes("All")
  ) {
    throw new Error("LEAVE_DEPARTMENT_INVALID");
  }

  return withMutationLock(`workforce-leave:${staffId}`, async () => {
    const { headers, records } = await readLeaveRecords();
    const audit = await readDataAuditSheet();
    const requestUse = findWorkforceRequest(
      workforceRequestLedger(audit.headers, audit.dataRows),
      requestId
    );
    const existing = records.find((row) => row.requestId === requestId);
    if (existing) {
      if (!requestUse) throw new Error("WORKFORCE_DATA_INVALID");
      if (
        requestUse.action === "leave.request" &&
        requestUse.entityId === existing.leaveId &&
        requestUse.actorId === context.staffId
      ) {
        return { leaveId: existing.leaveId, status: "Pending", duplicate: true };
      }
      throw new Error("WORKFORCE_REQUEST_ID_CONFLICT");
    }
    if (requestUse) throw new Error("WORKFORCE_REQUEST_ID_CONFLICT");
    const overlap = leaveOverlaps(
      { staffId, startDate: input.startDate, endDate: input.endDate },
      records
    );
    if (overlap) throw new Error("LEAVE_OVERLAP");

    const leaveId = newEntityId("LVE");
    const now = dhakaClockParts();
    const row = rowForHeaders(headers, {
      Leave_ID: leaveId,
      Staff_ID: staffId,
      Department: input.department,
      Leave_Type: input.leaveType,
      Start_Date: input.startDate,
      End_Date: input.endDate,
      Reason: reason,
      Status: "Pending",
      Request_ID: requestId,
      Requested_At: now.timestamp,
      Decided_By: "",
      Decided_At: "",
      Decision_Note: "",
      Updated_By: staffId,
      Updated_At: now.timestamp,
    });

    const ids = await workforceSheetIdMap();
    const leaveSheetId = requireSheetId(ids, LEAVE_REQUESTS_SHEET);
    const auditSheetId = requireSheetId(ids, DATA_AUDIT_SHEET);
    const auditRow = buildWorkforceAuditRow(audit.headers, {
      context,
      action: "leave.request",
      entityType: "Leave",
      entityId: leaveId,
      department: input.department,
      requestId,
      afterValue: {
        staffId,
        leaveType: input.leaveType,
        startDate: input.startDate,
        endDate: input.endDate,
        status: "Pending",
      },
      reason: "Staff requested leave",
      now,
    });
    await commitWorkforceBatch([
      appendRowRequest(leaveSheetId, row),
      appendRowRequest(auditSheetId, auditRow),
    ]);
    return { leaveId, status: "Pending", duplicate: false };
  });
}

async function loadLeaveRow(
  leaveId: string
): Promise<{ headers: string[]; dataRows: string[][]; rowIndex: number; record: LeaveRecord }> {
  const { headers, dataRows } = await readWorkforceSheet(
    LEAVE_REQUESTS_SHEET,
    LEAVE_REQUESTS_HEADERS
  );
  const idIdx = headerIndex(headers, "Leave_ID");
  const rowIndex = dataRows.findIndex((row) => at(row, idIdx) === normalize(leaveId));
  if (rowIndex < 0) throw new Error("LEAVE_NOT_FOUND");
  return { headers, dataRows, rowIndex, record: parseLeaveRow(headers, dataRows[rowIndex]) };
}

async function writeLeaveTransition(input: {
  context: AccessContext;
  headers: string[];
  rowIndex: number;
  record: LeaveRecord;
  requestId: string;
  auditHeaders: string[];
  status: LeaveStatus;
  decidedBy: string;
  decisionNote: string;
  action: string;
  reason: string;
}): Promise<void> {
  const rowNumber = input.rowIndex + 2;
  const now = dhakaClockParts();
  const idx = (name: string) => headerIndex(input.headers, name);
  const ids = await workforceSheetIdMap();
  const leaveSheetId = requireSheetId(ids, LEAVE_REQUESTS_SHEET);
  const auditSheetId = requireSheetId(ids, DATA_AUDIT_SHEET);
  const auditRow = buildWorkforceAuditRow(input.auditHeaders, {
    context: input.context,
    action: input.action,
    entityType: "Leave",
    entityId: input.record.leaveId,
    department: input.record.department,
    requestId: input.requestId,
    afterValue: { staffId: input.record.staffId, status: input.status },
    reason: input.reason,
    now,
  });
  await commitWorkforceBatch([
    updateCellRequest(leaveSheetId, rowNumber, idx("Status") + 1, input.status),
    updateCellRequest(leaveSheetId, rowNumber, idx("Decided_By") + 1, input.decidedBy),
    updateCellRequest(leaveSheetId, rowNumber, idx("Decided_At") + 1, input.decidedBy ? now.timestamp : ""),
    updateCellRequest(leaveSheetId, rowNumber, idx("Decision_Note") + 1, input.decisionNote),
    updateCellRequest(leaveSheetId, rowNumber, idx("Updated_By") + 1, input.context.staffId),
    updateCellRequest(leaveSheetId, rowNumber, idx("Updated_At") + 1, now.timestamp),
    appendRowRequest(auditSheetId, auditRow),
  ]);
}

export interface DecideLeaveInput {
  leaveId: string;
  decision: "Approved" | "Rejected";
  decisionNote?: string;
  requestId: string;
}

/**
 * Owner decides all; Manager decides only within department scope. A
 * decider may never approve/reject their own request — only Owner has no
 * one above them, so self-decision is reserved to Owner (interpretation
 * documented in REVIEW.md; issue #153 does not explicitly cover
 * self-approval and this is the conservative, fail-closed reading).
 */
export async function decideLeave(
  context: AccessContext,
  input: DecideLeaveInput
): Promise<{ leaveId: string; status: LeaveStatus; duplicate: boolean }> {
  if (input.decision !== "Approved" && input.decision !== "Rejected") {
    throw new Error("LEAVE_DECISION_INVALID");
  }
  const requestId = validateWorkforceRequestId(input.requestId);
  const decisionNote = boundedDecisionNote(input.decisionNote);

  return withMutationLock(`workforce-leave-row:${normalize(input.leaveId)}`, async () => {
    const { headers, rowIndex, record } = await loadLeaveRow(input.leaveId);
    assertCanPerform(context, "leave.decide", record.department);
    if (!isWorkforceManagerTier(context)) throw new Error("ACCESS_DENIED");
    if (record.staffId === context.staffId && !context.roles.includes("Owner")) {
      throw new Error("LEAVE_SELF_DECISION_FORBIDDEN");
    }
    const audit = await readDataAuditSheet();
    const requestUse = findWorkforceRequest(
      workforceRequestLedger(audit.headers, audit.dataRows),
      requestId
    );
    const action = input.decision === "Approved" ? "leave.approve" : "leave.reject";
    if (requestUse) {
      if (requestUse.action === action && requestUse.entityId === record.leaveId && requestUse.actorId === context.staffId) {
        return { leaveId: record.leaveId, status: input.decision, duplicate: true };
      }
      throw new Error("WORKFORCE_REQUEST_ID_CONFLICT");
    }
    if (!isValidLeaveTransition(record.status, input.decision)) {
      throw new Error("LEAVE_INVALID_TRANSITION");
    }
    await writeLeaveTransition({
      context,
      headers,
      rowIndex,
      record,
      requestId,
      auditHeaders: audit.headers,
      status: input.decision,
      decidedBy: context.staffId,
      decisionNote,
      action,
      reason: decisionNote || `Leave ${input.decision.toLowerCase()}`,
    });
    return { leaveId: record.leaveId, status: input.decision, duplicate: false };
  });
}

export interface CancelLeaveInput {
  leaveId: string;
  requestId: string;
}

/** Staff may cancel only their own Pending request (issue #153). */
export async function cancelLeave(
  context: AccessContext,
  input: CancelLeaveInput
): Promise<{ leaveId: string; status: LeaveStatus; duplicate: boolean }> {
  const requestId = validateWorkforceRequestId(input.requestId);

  return withMutationLock(`workforce-leave-row:${normalize(input.leaveId)}`, async () => {
    const { headers, rowIndex, record } = await loadLeaveRow(input.leaveId);
    const isOwn = record.staffId === context.staffId;
    assertCanPerform(context, isOwn ? "leave.cancel_own" : "leave.cancel", record.department);
    const audit = await readDataAuditSheet();
    const requestUse = findWorkforceRequest(
      workforceRequestLedger(audit.headers, audit.dataRows),
      requestId
    );
    if (requestUse) {
      if (requestUse.action === "leave.cancel" && requestUse.entityId === record.leaveId && requestUse.actorId === context.staffId) {
        return { leaveId: record.leaveId, status: "Cancelled", duplicate: true };
      }
      throw new Error("WORKFORCE_REQUEST_ID_CONFLICT");
    }
    if (!isValidLeaveTransition(record.status, "Cancelled")) {
      throw new Error("LEAVE_INVALID_TRANSITION");
    }
    await writeLeaveTransition({
      context,
      headers,
      rowIndex,
      record,
      requestId,
      auditHeaders: audit.headers,
      status: "Cancelled",
      decidedBy: record.decidedBy,
      decisionNote: record.decisionNote,
      action: "leave.cancel",
      reason: isOwn ? "Staff cancelled own pending leave request" : "Owner cancelled pending leave request",
    });
    return { leaveId: record.leaveId, status: "Cancelled", duplicate: false };
  });
}
