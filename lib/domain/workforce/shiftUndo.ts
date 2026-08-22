import "server-only";

import { dhakaClockParts } from "@/lib/config/relifeSystem";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import { withMutationLock } from "@/lib/webos/mutationLock";
import { readApprovedLeaveRangesForStaff } from "./leave";
import { shiftDateWithinLeaveRange } from "./shiftPolicy";
import {
  appendRowRequest,
  at,
  buildWorkforceAuditRow,
  commitWorkforceBatch,
  DATA_AUDIT_SHEET,
  headerIndex,
  normalize,
  readDataAuditSheet,
  readWorkforceSheet,
  requireSheetId,
  updateCellRequest,
  workforceSheetIdMap,
} from "./sheetsIo";
import {
  STAFF_SHIFTS_HEADERS,
  STAFF_SHIFTS_SHEET,
  isShiftStatus,
  isWorkforceDepartment,
  type ShiftStatus,
} from "./types";
import {
  findWorkforceRequest,
  validateWorkforceRequestId,
  workforceRequestLedger,
} from "./workforceRequest";

export interface UndoShiftInput {
  shiftId: string;
  expectedCurrentStatus: string;
  restoreStatus: string;
  requestId: string;
}

/**
 * Compensating status restore for the immediately preceding publish/cancel UI
 * action. This is deliberately compare-and-swap: if anyone changed the shift
 * after the browser action, Undo fails closed instead of overwriting it.
 */
export async function undoShiftStatus(
  context: AccessContext,
  input: UndoShiftInput
): Promise<{ shiftId: string; status: ShiftStatus; duplicate: boolean }> {
  const shiftId = normalize(input.shiftId);
  const expectedCurrentStatus = normalize(input.expectedCurrentStatus);
  const restoreStatus = normalize(input.restoreStatus);
  const requestId = validateWorkforceRequestId(input.requestId);

  if (!shiftId) throw new Error("SHIFT_NOT_FOUND");
  if (!isShiftStatus(expectedCurrentStatus) || !isShiftStatus(restoreStatus)) {
    throw new Error("SHIFT_UNDO_INVALID");
  }
  const allowed =
    (expectedCurrentStatus === "Published" && restoreStatus === "Draft") ||
    (expectedCurrentStatus === "Cancelled" && (restoreStatus === "Draft" || restoreStatus === "Published"));
  if (!allowed) throw new Error("SHIFT_UNDO_INVALID");

  return withMutationLock(`workforce-shift-row:${shiftId}`, async () => {
    const { headers, dataRows } = await readWorkforceSheet(STAFF_SHIFTS_SHEET, STAFF_SHIFTS_HEADERS);
    const idIdx = headerIndex(headers, "Shift_ID");
    const staffIdx = headerIndex(headers, "Staff_ID");
    const departmentIdx = headerIndex(headers, "Department");
    const dateIdx = headerIndex(headers, "Shift_Date");
    const statusIdx = headerIndex(headers, "Status");
    const updatedByIdx = headerIndex(headers, "Updated_By");
    const updatedAtIdx = headerIndex(headers, "Updated_At");
    const rowIndex = dataRows.findIndex((row) => at(row, idIdx) === shiftId);
    if (rowIndex < 0) throw new Error("SHIFT_NOT_FOUND");

    const row = dataRows[rowIndex];
    const department = at(row, departmentIdx);
    if (!isWorkforceDepartment(department)) throw new Error("WORKFORCE_DATA_INVALID");
    assertCanPerform(context, "shift.manage", department);

    const audit = await readDataAuditSheet();
    const requestUse = findWorkforceRequest(
      workforceRequestLedger(audit.headers, audit.dataRows),
      requestId
    );
    if (requestUse) {
      if (
        requestUse.action === "shift.undo" &&
        requestUse.entityId === shiftId &&
        requestUse.actorId === context.staffId &&
        requestUse.status === restoreStatus
      ) {
        return { shiftId, status: restoreStatus, duplicate: true };
      }
      throw new Error("WORKFORCE_REQUEST_ID_CONFLICT");
    }

    const currentStatus = at(row, statusIdx);
    if (currentStatus !== expectedCurrentStatus) throw new Error("SHIFT_UNDO_CONFLICT");

    // Restoring Published must re-check today's source of truth. A leave may
    // have been approved after the original shift was cancelled.
    if (restoreStatus === "Published") {
      const approvedLeave = await readApprovedLeaveRangesForStaff(at(row, staffIdx));
      if (approvedLeave.some((range) =>
        shiftDateWithinLeaveRange(at(row, dateIdx), range.startDate, range.endDate)
      )) {
        throw new Error("SHIFT_LEAVE_CONFLICT");
      }
    }

    const ids = await workforceSheetIdMap();
    const shiftSheetId = requireSheetId(ids, STAFF_SHIFTS_SHEET);
    const auditSheetId = requireSheetId(ids, DATA_AUDIT_SHEET);
    const rowNumber = rowIndex + 2;
    const now = dhakaClockParts();
    const auditRow = buildWorkforceAuditRow(audit.headers, {
      context,
      action: "shift.undo",
      entityType: "Shift",
      entityId: shiftId,
      department,
      requestId,
      afterValue: {
        staffId: at(row, staffIdx),
        status: restoreStatus,
        undoneStatus: expectedCurrentStatus,
      },
      reason: `Undo shift status ${expectedCurrentStatus} -> ${restoreStatus}`,
      now,
    });

    await commitWorkforceBatch([
      updateCellRequest(shiftSheetId, rowNumber, statusIdx + 1, restoreStatus),
      updateCellRequest(shiftSheetId, rowNumber, updatedByIdx + 1, context.staffId),
      updateCellRequest(shiftSheetId, rowNumber, updatedAtIdx + 1, now.timestamp),
      appendRowRequest(auditSheetId, auditRow),
    ]);

    return { shiftId, status: restoreStatus, duplicate: false };
  });
}
