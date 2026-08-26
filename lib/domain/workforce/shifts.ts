import "server-only";

import type { Department } from "@/lib/types";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import { dhakaClockParts } from "@/lib/config/relifeSystem";
import { getActiveWebStaffById, getWebStaffDirectory } from "@/lib/webos/staffDirectory";
import { withMutationLock } from "@/lib/webos/mutationLock";
import {
  readApprovedLeaveRangesForStaff,
  readApprovedLeaveRangesForStaffIds,
} from "./leave";
import {
  generateMonthlyRoster,
  isValidRosterMonth,
  MONTHLY_ROSTER_PROFILES,
  monthlyRosterConflictCodes,
  type MonthlyRosterEntry,
} from "./monthlyRoster";
import {
  boundedNotes,
  isValidIsoDate,
  isValidShiftTimeRange,
  isValidShiftTransition,
  shiftDateWithinLeaveRange,
  shiftOverlaps,
} from "./shiftPolicy";
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
  STAFF_SHIFTS_HEADERS,
  STAFF_SHIFTS_SHEET,
  isWorkforceDepartment,
  isShiftStatus,
  type ShiftRecord,
  type ShiftStatus,
} from "./types";
import { canReachShiftRow, isWorkforceManagerTier, visibleShifts } from "./workforceScope";
import {
  findWorkforceRequest,
  validateWorkforceRequestId,
  workforceRequestLedger,
} from "./workforceRequest";

function parseShiftRow(headers: string[], row: string[]): ShiftRecord {
  const idx = (name: string) => headerIndex(headers, name);
  const shiftId = at(row, idx("Shift_ID"));
  const staffId = at(row, idx("Staff_ID"));
  const department = at(row, idx("Department"));
  const shiftDate = at(row, idx("Shift_Date"));
  const startTime = at(row, idx("Start_Time"));
  const endTime = at(row, idx("End_Time"));
  const status = at(row, idx("Status"));
  const requestId = at(row, idx("Request_ID"));
  if (
    !shiftId || !staffId || !isWorkforceDepartment(department) ||
    !isValidIsoDate(shiftDate) || !isValidShiftTimeRange(startTime, endTime) ||
    !isShiftStatus(status)
  ) {
    throw new Error("WORKFORCE_DATA_INVALID");
  }
  validateWorkforceRequestId(requestId);
  return {
    shiftId,
    staffId,
    staffName: "",
    department,
    shiftDate,
    startTime,
    endTime,
    status,
    notes: at(row, idx("Notes")),
    requestId,
    createdBy: at(row, idx("Created_By")),
    createdAt: at(row, idx("Created_At")),
    updatedBy: at(row, idx("Updated_By")),
    updatedAt: at(row, idx("Updated_At")),
  };
}

async function readShiftRecords(): Promise<{ headers: string[]; records: ShiftRecord[] }> {
  const { headers, dataRows } = await readWorkforceSheet(
    STAFF_SHIFTS_SHEET,
    STAFF_SHIFTS_HEADERS
  );
  return { headers, records: dataRows.map((row) => parseShiftRow(headers, row)) };
}

async function withStaffNames(records: ShiftRecord[]): Promise<ShiftRecord[]> {
  if (records.length === 0) return records;
  const directory = await getWebStaffDirectory();
  const nameById = new Map(directory.map((item) => [item.staffId, item.fullName]));
  return records.map((record) => ({
    ...record,
    staffName: nameById.get(record.staffId) || record.staffId,
  }));
}

export async function listShiftsForContext(context: AccessContext): Promise<ShiftRecord[]> {
  const { records } = await readShiftRecords();
  return visibleShifts(context, await withStaffNames(records));
}

export async function getShiftForContext(
  context: AccessContext,
  shiftId: string
): Promise<ShiftRecord | null> {
  const { records } = await readShiftRecords();
  const [record] = await withStaffNames(
    records.filter((row) => row.shiftId === normalize(shiftId))
  );
  if (!record) return null;
  return canReachShiftRow(context, record) ? record : null;
}

export interface CreateShiftInput {
  staffId: string;
  department: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  notes?: string;
  requestId: string;
}

export interface MonthlyRosterPreview {
  month: string;
  entries: MonthlyRosterEntry[];
  conflicts: string[];
  canApply: boolean;
}

function assertOwnerRosterAccess(context: AccessContext): void {
  if (!context.roles.includes("Owner")) throw new Error("ACCESS_DENIED");
  assertCanPerform(context, "shift.manage", "Physio");
  assertCanPerform(context, "shift.manage", "Dental");
}

async function validateRosterDirectory(): Promise<void> {
  const directory = await getWebStaffDirectory();
  const byId = new Map(directory.map((item) => [item.staffId, item]));
  for (const profile of MONTHLY_ROSTER_PROFILES) {
    const identity = byId.get(profile.staffId);
    if (!identity || identity.status !== "Active") throw new Error("ROSTER_STAFF_INVALID");
    if (!identity.roles.includes(profile.role)) throw new Error("ROSTER_STAFF_ROLE_MISMATCH");
    if (
      !identity.departmentAccess.includes(profile.department) &&
      !identity.departmentAccess.includes("All")
    ) {
      throw new Error("ROSTER_STAFF_DEPARTMENT_MISMATCH");
    }
  }
}

async function buildMonthlyRosterPreview(month: string): Promise<MonthlyRosterPreview> {
  const entries = generateMonthlyRoster(month);
  const staffIds = MONTHLY_ROSTER_PROFILES.map((profile) => profile.staffId);
  const [{ records }, approvedLeave] = await Promise.all([
    readShiftRecords(),
    readApprovedLeaveRangesForStaffIds(staffIds),
  ]);
  const conflicts = monthlyRosterConflictCodes({ entries, existing: records, approvedLeave });
  return { month, entries, conflicts, canApply: conflicts.length === 0 };
}

export async function previewMonthlyRoster(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  month: string
): Promise<MonthlyRosterPreview> {
  assertOwnerRosterAccess(context);
  if (!isValidRosterMonth(month)) throw new Error("ROSTER_MONTH_INVALID");
  await validateRosterDirectory();
  return buildMonthlyRosterPreview(month);
}

export async function applyMonthlyRoster(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  input: { month: string; requestId: string }
): Promise<{ month: string; shiftCount: number; duplicate: boolean }> {
  assertOwnerRosterAccess(context);
  if (!isValidRosterMonth(input.month)) throw new Error("ROSTER_MONTH_INVALID");
  const requestId = validateWorkforceRequestId(input.requestId);
  await validateRosterDirectory();

  return withMutationLock(`workforce-roster:${input.month}`, async () => {
    const audit = await readDataAuditSheet();
    const requestUse = findWorkforceRequest(
      workforceRequestLedger(audit.headers, audit.dataRows),
      requestId
    );
    const entries = generateMonthlyRoster(input.month);
    if (requestUse) {
      if (
        requestUse.action === "shift.roster.apply" &&
        requestUse.entityId === input.month &&
        requestUse.actorId === context.staffId
      ) {
        return { month: input.month, shiftCount: entries.length, duplicate: true };
      }
      throw new Error("WORKFORCE_REQUEST_ID_CONFLICT");
    }

    const preview = await buildMonthlyRosterPreview(input.month);
    if (!preview.canApply) throw new Error("ROSTER_CONFLICT");
    const { headers } = await readWorkforceSheet(STAFF_SHIFTS_SHEET, STAFF_SHIFTS_HEADERS);
    const ids = await workforceSheetIdMap();
    const shiftSheetId = requireSheetId(ids, STAFF_SHIFTS_SHEET);
    const auditSheetId = requireSheetId(ids, DATA_AUDIT_SHEET);
    const now = dhakaClockParts();
    const requests = preview.entries.map((entry, index) => appendRowRequest(shiftSheetId, rowForHeaders(headers, {
      Shift_ID: newEntityId("SHF"),
      Staff_ID: entry.staffId,
      Department: entry.department,
      Shift_Date: entry.shiftDate,
      Start_Time: entry.startTime,
      End_Time: entry.endTime,
      Status: "Published",
      Notes: entry.weeklyHalfDay ? "Monthly roster · weekly half-day" : "Monthly roster",
      Request_ID: `${requestId.slice(0, 88)}_R${String(index).padStart(3, "0")}`,
      Created_By: context.staffId,
      Created_At: now.timestamp,
      Updated_By: context.staffId,
      Updated_At: now.timestamp,
    })));
    const auditRow = buildWorkforceAuditRow(audit.headers, {
      context,
      action: "shift.roster.apply",
      entityType: "Shift",
      entityId: input.month,
      department: "All",
      requestId,
      afterValue: {
        month: input.month,
        shiftCount: preview.entries.length,
        status: "Published",
        staffIds: MONTHLY_ROSTER_PROFILES.map((profile) => profile.staffId),
      },
      reason: "Owner applied deterministic monthly roster",
      now,
      organizationId,
      clinicId,
    });
    await commitWorkforceBatch([...requests, appendRowRequest(auditSheetId, auditRow)]);
    return { month: input.month, shiftCount: preview.entries.length, duplicate: false };
  });
}

/** Owner/Manager only, department-scoped (issue #153: "read/manage department shifts"). */
export async function createShift(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  input: CreateShiftInput
): Promise<{ shiftId: string; status: ShiftStatus; duplicate: boolean }> {
  if (!isWorkforceDepartment(input.department)) throw new Error("SHIFT_DEPARTMENT_INVALID");
  assertCanPerform(context, "shift.manage", input.department);
  const staffId = normalize(input.staffId);
  if (!staffId) throw new Error("STAFF_NOT_FOUND");
  if (!isValidIsoDate(input.shiftDate)) throw new Error("SHIFT_DATE_INVALID");
  if (!isValidShiftTimeRange(input.startTime, input.endTime)) {
    throw new Error("SHIFT_TIME_RANGE_INVALID");
  }
  const requestId = validateWorkforceRequestId(input.requestId);
  const notes = boundedNotes(input.notes);

  const identity = await getActiveWebStaffById(staffId);
  if (!identity) throw new Error("STAFF_NOT_FOUND");
  if (
    !identity.departmentAccess.includes(input.department as Department) &&
    !identity.departmentAccess.includes("All")
  ) {
    throw new Error("SHIFT_DEPARTMENT_INVALID");
  }

  return withMutationLock(`workforce-shift:${staffId}`, async () => {
    const { headers, records } = await readShiftRecords();
    const audit = await readDataAuditSheet();
    const requestUse = findWorkforceRequest(
      workforceRequestLedger(audit.headers, audit.dataRows),
      requestId
    );
    const existing = records.find((row) => row.requestId === requestId);
    if (existing) {
      if (!requestUse) throw new Error("WORKFORCE_DATA_INVALID");
      if (
        requestUse.action === "shift.create" &&
        requestUse.entityId === existing.shiftId &&
        requestUse.actorId === context.staffId
      ) {
        return { shiftId: existing.shiftId, status: "Draft", duplicate: true };
      }
      throw new Error("WORKFORCE_REQUEST_ID_CONFLICT");
    }
    if (requestUse) throw new Error("WORKFORCE_REQUEST_ID_CONFLICT");
    const overlap = shiftOverlaps(
      { staffId, shiftDate: input.shiftDate, startTime: input.startTime, endTime: input.endTime },
      records
    );
    if (overlap) throw new Error("SHIFT_OVERLAP");

    const shiftId = newEntityId("SHF");
    const now = dhakaClockParts();
    const row = rowForHeaders(headers, {
      Shift_ID: shiftId,
      Staff_ID: staffId,
      Department: input.department,
      Shift_Date: input.shiftDate,
      Start_Time: input.startTime,
      End_Time: input.endTime,
      Status: "Draft",
      Notes: notes,
      Request_ID: requestId,
      Created_By: context.staffId,
      Created_At: now.timestamp,
      Updated_By: context.staffId,
      Updated_At: now.timestamp,
    });

    const ids = await workforceSheetIdMap();
    const shiftSheetId = requireSheetId(ids, STAFF_SHIFTS_SHEET);
    const auditSheetId = requireSheetId(ids, DATA_AUDIT_SHEET);
    const auditRow = buildWorkforceAuditRow(audit.headers, {
      context,
      action: "shift.create",
      entityType: "Shift",
      entityId: shiftId,
      department: input.department,
      requestId,
      afterValue: {
        staffId,
        shiftDate: input.shiftDate,
        startTime: input.startTime,
        endTime: input.endTime,
        status: "Draft",
      },
      reason: "Shift created as Draft",
      now,
      organizationId,
      clinicId,
    });
    await commitWorkforceBatch([
      appendRowRequest(shiftSheetId, row),
      appendRowRequest(auditSheetId, auditRow),
    ]);
    return { shiftId, status: "Draft", duplicate: false };
  });
}

async function loadShiftRow(
  shiftId: string
): Promise<{ headers: string[]; dataRows: string[][]; rowIndex: number; record: ShiftRecord }> {
  const { headers, dataRows } = await readWorkforceSheet(
    STAFF_SHIFTS_SHEET,
    STAFF_SHIFTS_HEADERS
  );
  const idIdx = headerIndex(headers, "Shift_ID");
  const rowIndex = dataRows.findIndex((row) => at(row, idIdx) === normalize(shiftId));
  if (rowIndex < 0) throw new Error("SHIFT_NOT_FOUND");
  return { headers, dataRows, rowIndex, record: parseShiftRow(headers, dataRows[rowIndex]) };
}

async function writeShiftTransition(input: {
  context: AccessContext;
  headers: string[];
  rowIndex: number;
  record: ShiftRecord;
  requestId: string;
  auditHeaders: string[];
  status: ShiftStatus;
  action: string;
  reason: string;
  organizationId: string;
  clinicId: string;
}): Promise<void> {
  const rowNumber = input.rowIndex + 2;
  const now = dhakaClockParts();
  const idx = (name: string) => headerIndex(input.headers, name);
  const ids = await workforceSheetIdMap();
  const shiftSheetId = requireSheetId(ids, STAFF_SHIFTS_SHEET);
  const auditSheetId = requireSheetId(ids, DATA_AUDIT_SHEET);
  const auditRow = buildWorkforceAuditRow(input.auditHeaders, {
    context: input.context,
    action: input.action,
    entityType: "Shift",
    entityId: input.record.shiftId,
    department: input.record.department,
    requestId: input.requestId,
    afterValue: { staffId: input.record.staffId, status: input.status },
    reason: input.reason,
    now,
    organizationId: input.organizationId,
    clinicId: input.clinicId,
  });
  await commitWorkforceBatch([
    updateCellRequest(shiftSheetId, rowNumber, idx("Status") + 1, input.status),
    updateCellRequest(shiftSheetId, rowNumber, idx("Updated_By") + 1, input.context.staffId),
    updateCellRequest(shiftSheetId, rowNumber, idx("Updated_At") + 1, now.timestamp),
    appendRowRequest(auditSheetId, auditRow),
  ]);
}

export interface UpdateShiftInput extends ShiftActionInput {
  shiftDate: string;
  startTime: string;
  endTime: string;
  notes?: string;
}

/** Draft-only edit. Staff identity and department are immutable after create. */
export async function updateShift(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  input: UpdateShiftInput
): Promise<{ shiftId: string; status: ShiftStatus; duplicate: boolean }> {
  if (!isValidIsoDate(input.shiftDate)) throw new Error("SHIFT_DATE_INVALID");
  if (!isValidShiftTimeRange(input.startTime, input.endTime)) {
    throw new Error("SHIFT_TIME_RANGE_INVALID");
  }
  const requestId = validateWorkforceRequestId(input.requestId);
  const notes = boundedNotes(input.notes);
  const initial = await loadShiftRow(input.shiftId);
  assertCanPerform(context, "shift.manage", initial.record.department);

  return withMutationLock(`workforce-shift:${initial.record.staffId}`, async () => {
    const { headers, dataRows, rowIndex, record } = await loadShiftRow(input.shiftId);
    assertCanPerform(context, "shift.manage", record.department);
    const audit = await readDataAuditSheet();
    const requestUse = findWorkforceRequest(
      workforceRequestLedger(audit.headers, audit.dataRows),
      requestId
    );
    if (requestUse) {
      if (requestUse.action === "shift.update" && requestUse.entityId === record.shiftId && requestUse.actorId === context.staffId) {
        return { shiftId: record.shiftId, status: "Draft", duplicate: true };
      }
      throw new Error("WORKFORCE_REQUEST_ID_CONFLICT");
    }
    if (record.status !== "Draft") throw new Error("SHIFT_INVALID_TRANSITION");
    const records = dataRows.map((row) => parseShiftRow(headers, row));
    if (shiftOverlaps({
      staffId: record.staffId,
      shiftDate: input.shiftDate,
      startTime: input.startTime,
      endTime: input.endTime,
    }, records, record.shiftId)) {
      throw new Error("SHIFT_OVERLAP");
    }

    const rowNumber = rowIndex + 2;
    const idx = (name: string) => headerIndex(headers, name);
    const now = dhakaClockParts();
    const ids = await workforceSheetIdMap();
    const shiftSheetId = requireSheetId(ids, STAFF_SHIFTS_SHEET);
    const auditSheetId = requireSheetId(ids, DATA_AUDIT_SHEET);
    const auditRow = buildWorkforceAuditRow(audit.headers, {
      context,
      action: "shift.update",
      entityType: "Shift",
      entityId: record.shiftId,
      department: record.department,
      requestId,
      afterValue: {
        staffId: record.staffId,
        shiftDate: input.shiftDate,
        startTime: input.startTime,
        endTime: input.endTime,
        status: "Draft",
      },
      reason: "Draft shift updated",
      now,
      organizationId,
      clinicId,
    });
    await commitWorkforceBatch([
      updateCellRequest(shiftSheetId, rowNumber, idx("Shift_Date") + 1, input.shiftDate),
      updateCellRequest(shiftSheetId, rowNumber, idx("Start_Time") + 1, input.startTime),
      updateCellRequest(shiftSheetId, rowNumber, idx("End_Time") + 1, input.endTime),
      updateCellRequest(shiftSheetId, rowNumber, idx("Notes") + 1, notes),
      updateCellRequest(shiftSheetId, rowNumber, idx("Updated_By") + 1, context.staffId),
      updateCellRequest(shiftSheetId, rowNumber, idx("Updated_At") + 1, now.timestamp),
      appendRowRequest(auditSheetId, auditRow),
    ]);
    return { shiftId: record.shiftId, status: "Draft", duplicate: false };
  });
}

export interface ShiftActionInput {
  shiftId: string;
  requestId: string;
}

/**
 * Draft -> Published. Fails closed against an Approved leave range for the
 * same staff member (issue #153) — checked at publish time, not at Draft
 * creation, since a Draft is provisional.
 */
export async function publishShift(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  input: ShiftActionInput
): Promise<{ shiftId: string; status: ShiftStatus; duplicate: boolean }> {
  const requestId = validateWorkforceRequestId(input.requestId);

  return withMutationLock(`workforce-shift-row:${normalize(input.shiftId)}`, async () => {
    const { headers, rowIndex, record } = await loadShiftRow(input.shiftId);
    assertCanPerform(context, "shift.manage", record.department);
    const audit = await readDataAuditSheet();
    const requestUse = findWorkforceRequest(
      workforceRequestLedger(audit.headers, audit.dataRows),
      requestId
    );
    if (requestUse) {
      if (requestUse.action === "shift.publish" && requestUse.entityId === record.shiftId && requestUse.actorId === context.staffId) {
        return { shiftId: record.shiftId, status: "Published", duplicate: true };
      }
      throw new Error("WORKFORCE_REQUEST_ID_CONFLICT");
    }
    if (!isValidShiftTransition(record.status, "Published")) {
      throw new Error("SHIFT_INVALID_TRANSITION");
    }
    const approvedLeave = await readApprovedLeaveRangesForStaff(record.staffId);
    const conflict = approvedLeave.some((range) =>
      shiftDateWithinLeaveRange(record.shiftDate, range.startDate, range.endDate)
    );
    if (conflict) throw new Error("SHIFT_LEAVE_CONFLICT");

    await writeShiftTransition({
      context,
      headers,
      rowIndex,
      record,
      requestId,
      auditHeaders: audit.headers,
      status: "Published",
      action: "shift.publish",
      reason: "Shift published",
      organizationId,
      clinicId,
    });
    return { shiftId: record.shiftId, status: "Published", duplicate: false };
  });
}

/** Draft or Published -> Cancelled. Preserves history; never a hard delete. */
export async function cancelShift(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  input: ShiftActionInput
): Promise<{ shiftId: string; status: ShiftStatus; duplicate: boolean }> {
  const requestId = validateWorkforceRequestId(input.requestId);

  return withMutationLock(`workforce-shift-row:${normalize(input.shiftId)}`, async () => {
    const { headers, rowIndex, record } = await loadShiftRow(input.shiftId);
    assertCanPerform(context, "shift.manage", record.department);
    const audit = await readDataAuditSheet();
    const requestUse = findWorkforceRequest(
      workforceRequestLedger(audit.headers, audit.dataRows),
      requestId
    );
    if (requestUse) {
      if (requestUse.action === "shift.cancel" && requestUse.entityId === record.shiftId && requestUse.actorId === context.staffId) {
        return { shiftId: record.shiftId, status: "Cancelled", duplicate: true };
      }
      throw new Error("WORKFORCE_REQUEST_ID_CONFLICT");
    }
    if (!isValidShiftTransition(record.status, "Cancelled")) {
      throw new Error("SHIFT_INVALID_TRANSITION");
    }
    await writeShiftTransition({
      context,
      headers,
      rowIndex,
      record,
      requestId,
      auditHeaders: audit.headers,
      status: "Cancelled",
      action: "shift.cancel",
      reason: "Shift cancelled",
      organizationId,
      clinicId,
    });
    return { shiftId: record.shiftId, status: "Cancelled", duplicate: false };
  });
}

export { isWorkforceManagerTier };
