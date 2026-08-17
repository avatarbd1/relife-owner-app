import "server-only";

import { randomUUID } from "node:crypto";
import {
  RELIFE_SYSTEM,
  departmentForWorkbook,
  dhakaClockParts,
  ledgerClinicId,
  relifeRecordId,
  workbookForDepartment,
} from "@/lib/config/relifeSystem";
import {
  appendSheetValues,
  batchUpdateSpreadsheet,
  fetchSheetRanges,
  getSheetProperties,
  type SpreadsheetBatchRequest,
  type Workbook,
} from "@/lib/data/googleSheets";
import { cashBusinessDate } from "@/lib/domain/finance/cashBusinessDay";
import type { ClinicDepartment } from "@/lib/domain/finance/expenses";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";

type SheetValue = string | number | boolean;
export type CashDestination = "Home Treasury" | "Bank";
export type CashDecision = "accept" | "reject";

export interface CashRequestInput {
  department: ClinicDepartment;
  amount: number;
  toCustodian: CashDestination;
  note?: string;
  requestId: string;
}

export interface PendingCashMovement {
  workbook: Workbook;
  id: string;
  date: string;
  from: string;
  to: string;
  amount: number;
  movedBy: string;
  note: string;
  department: string;
}

const PENDING_STATUSES = new Set([
  "pending",
  "pending approval",
  "requested",
  "awaiting confirmation",
  "awaiting acceptance",
]);

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase();
}

function money(value: unknown): number {
  const parsed = Number.parseFloat(normalize(value).replace(/৳|,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function headerIndex(headers: string[], ...names: string[]): number {
  const lookup = headers.map(normalized);
  for (const name of names) {
    const index = lookup.indexOf(name.toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
}

function ensureHeaders(headers: string[], required: string[]): void {
  const present = new Set(headers.map(normalized));
  if (required.some((header) => !present.has(header.toLowerCase()))) {
    throw new Error("SCHEMA_MISMATCH");
  }
}

function rowForHeaders(
  headers: string[],
  values: Record<string, SheetValue>
): SheetValue[] {
  const mapped = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value])
  );
  return headers.map((header) => mapped.get(normalized(header)) ?? "");
}

function validateRequestId(value: string): string {
  const requestId = normalize(value);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) {
    throw new Error("INVALID_REQUEST_ID");
  }
  return requestId;
}

function nextEntityId(existing: Set<string>): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = `CMW${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    if (!existing.has(id)) return id;
  }
  throw new Error("ID_ALLOCATION_FAILED");
}

function cellValue(value: SheetValue): Record<string, unknown> {
  if (typeof value === "boolean") return { userEnteredValue: { boolValue: value } };
  if (typeof value === "number") return { userEnteredValue: { numberValue: value } };
  return { userEnteredValue: { stringValue: String(value) } };
}

function appendRowRequest(sheetId: number, row: SheetValue[]): SpreadsheetBatchRequest {
  return {
    appendCells: {
      sheetId,
      rows: [{ values: row.map(cellValue) }],
      fields: "userEnteredValue",
    },
  };
}

function updateCellRequest(
  sheetId: number,
  rowNumber: number,
  columnNumber: number,
  value: SheetValue
): SpreadsheetBatchRequest {
  return {
    updateCells: {
      range: {
        sheetId,
        startRowIndex: rowNumber - 1,
        endRowIndex: rowNumber,
        startColumnIndex: columnNumber - 1,
        endColumnIndex: columnNumber,
      },
      rows: [{ values: [cellValue(value)] }],
      fields: "userEnteredValue",
    },
  };
}

async function movementSheetId(workbook: Workbook): Promise<number> {
  const properties = await getSheetProperties(workbook);
  const sheet = properties.find((item) => item.title === "21_Cash_Movement");
  if (!sheet) throw new Error("SCHEMA_MISMATCH");
  return sheet.sheetId;
}

async function appendCashAudit(input: {
  workbook: Workbook;
  actorId: string;
  action: string;
  movementId: string;
  department: ClinicDepartment;
  beforeValue?: string;
  afterValue?: string;
}): Promise<void> {
  const now = dhakaClockParts();
  const clinic = ledgerClinicId(input.department);
  try {
    await appendSheetValues(input.workbook, "'20_Data_Audit'!A:W", [[
      `AUD-${randomUUID()}`,
      now.timestamp,
      input.actorId,
      input.action,
      "CashMovement",
      input.movementId,
      "",
      input.beforeValue || "",
      input.afterValue || "",
      "Finance domain action",
      RELIFE_SYSTEM.organizationId,
      clinic,
      RELIFE_SYSTEM.branchId,
      relifeRecordId(input.department, input.movementId),
      "",
      input.actorId,
      RELIFE_SYSTEM.sourceSystem,
      RELIFE_SYSTEM.sourceType,
      false,
      true,
      RELIFE_SYSTEM.schemaVersion,
      now.provenance,
      input.department,
    ]]);
  } catch (error) {
    console.error("Finance cash audit append failed:", error);
  }
}

export async function requestCashMovement(
  context: AccessContext,
  input: CashRequestInput
): Promise<{ movementId: string; duplicate: boolean }> {
  const department = input.department;
  if (department !== "Physio" && department !== "Dental") {
    throw new Error("INVALID_DEPARTMENT");
  }
  assertCanPerform(context, "cash.request", department);
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("INVALID_AMOUNT");
  if (input.toCustodian !== "Home Treasury" && input.toCustodian !== "Bank") {
    throw new Error("INVALID_CUSTODIAN");
  }

  const requestId = validateRequestId(input.requestId);
  const marker = `WEBREQ:${requestId}`;
  const workbook = workbookForDepartment(department);
  const snapshot = await fetchSheetRanges(workbook, ["21_Cash_Movement"]);
  const rows = snapshot["21_Cash_Movement"] || [];
  if (rows.length < 1) throw new Error("SCHEMA_MISMATCH");
  const headers = rows[0];
  ensureHeaders(headers, [
    "Movement_ID",
    "Date",
    "From_Custodian",
    "To_Custodian",
    "Amount",
    "Status",
    "Department",
    "Note",
  ]);
  const noteIdx = headerIndex(headers, "Note");
  const idIdx = headerIndex(headers, "Movement_ID");
  const existing = rows.slice(1).find((row) => at(row, noteIdx).includes(marker));
  if (existing) return { movementId: at(existing, idIdx), duplicate: true };

  const existingIds = new Set(rows.slice(1).map((row) => at(row, idIdx)).filter(Boolean));
  const movementId = nextEntityId(existingIds);
  const clockRef = new Date();
  const now = dhakaClockParts(clockRef);
  const businessDate = cashBusinessDate(clockRef);
  const note = [normalize(input.note), marker].filter(Boolean).join(" | ");
  const row = rowForHeaders(headers, {
    Movement_ID: movementId,
    Date: businessDate,
    From_Custodian: "Reception",
    To_Custodian: input.toCustodian,
    Amount: amount,
    Moved_By: context.staffId,
    Note: note,
    Timestamp: now.timestamp,
    Organization_ID: RELIFE_SYSTEM.organizationId,
    Clinic_ID: ledgerClinicId(department),
    Branch_ID: RELIFE_SYSTEM.branchId,
    Record_ID: relifeRecordId(department, movementId),
    Provider_ID: context.staffId,
    Source_System: RELIFE_SYSTEM.sourceSystem,
    Source_Type: RELIFE_SYSTEM.sourceType,
    AI_Generated: false,
    Human_Verified: true,
    Schema_Version: RELIFE_SYSTEM.schemaVersion,
    Provenance_Timestamp: now.provenance,
    Status: "Pending",
    Department: department,
    From_Custodian_ID: `${department} Reception Cash`,
    From_Staff_ID: context.staffId,
    To_Custodian_ID: input.toCustodian,
    Requested_Amount: amount,
    Requested_At: now.timestamp,
    Updated_At: now.timestamp,
  });
  const sheetId = await movementSheetId(workbook);
  await batchUpdateSpreadsheet(workbook, [appendRowRequest(sheetId, row)]);
  await appendCashAudit({
    workbook,
    actorId: context.staffId,
    action: "CASH_MOVEMENT_REQUESTED",
    movementId,
    department,
    afterValue: JSON.stringify({ from: "Reception", to: input.toCustodian, amount }),
  });
  return { movementId, duplicate: false };
}

export async function listPendingCashMovements(): Promise<PendingCashMovement[]> {
  const [physio, dental] = await Promise.all([
    fetchSheetRanges("physio", ["21_Cash_Movement"]),
    fetchSheetRanges("dental", ["21_Cash_Movement"]),
  ]);

  const parse = (workbook: Workbook, rows: string[][]): PendingCashMovement[] => {
    if (rows.length < 2) return [];
    const headers = rows[0];
    const idIdx = headerIndex(headers, "Movement_ID");
    const dateIdx = headerIndex(headers, "Date");
    const fromIdx = headerIndex(headers, "From_Custodian");
    const toIdx = headerIndex(headers, "To_Custodian");
    const amountIdx = headerIndex(headers, "Requested_Amount", "Amount");
    const movedByIdx = headerIndex(headers, "Moved_By");
    const noteIdx = headerIndex(headers, "Note");
    const departmentIdx = headerIndex(headers, "Department");
    const statusIdx = headerIndex(headers, "Status");
    if (idIdx < 0 || statusIdx < 0) throw new Error("SCHEMA_MISMATCH");

    return rows.slice(1).flatMap((row) => {
      const id = at(row, idIdx);
      if (!id || !PENDING_STATUSES.has(normalized(at(row, statusIdx)))) return [];
      return [{
        workbook,
        id,
        date: at(row, dateIdx),
        from: at(row, fromIdx),
        to: at(row, toIdx),
        amount: money(at(row, amountIdx)),
        movedBy: at(row, movedByIdx),
        note: at(row, noteIdx),
        department: at(row, departmentIdx) || departmentForWorkbook(workbook),
      }];
    });
  };

  return [
    ...parse("physio", physio["21_Cash_Movement"] || []),
    ...parse("dental", dental["21_Cash_Movement"] || []),
  ];
}

export async function decideCashMovement(input: {
  workbook: Workbook;
  movementId: string;
  decision: CashDecision;
  actorId: string;
  receivedAmount?: number;
}): Promise<void> {
  const { workbook, movementId, decision } = input;
  if (workbook !== "physio" && workbook !== "dental") throw new Error("INVALID_WORKBOOK");
  if (decision !== "accept" && decision !== "reject") throw new Error("INVALID_DECISION");
  if (
    input.receivedAmount !== undefined &&
    (!Number.isFinite(input.receivedAmount) || input.receivedAmount < 0)
  ) {
    throw new Error("INVALID_RECEIVED_AMOUNT");
  }

  const snapshot = await fetchSheetRanges(workbook, ["21_Cash_Movement"]);
  const rows = snapshot["21_Cash_Movement"] || [];
  if (rows.length < 2) throw new Error("CONTROL_NOT_FOUND");
  const headers = rows[0];
  ensureHeaders(headers, [
    "Movement_ID",
    "Status",
    "Department",
    "Amount",
    "Confirmed_By",
    "Confirmed_At",
    "Received_Amount",
    "Difference",
    "Accepted_By",
    "Accepted_At",
    "Completed_At",
    "Updated_At",
  ]);

  const idIdx = headerIndex(headers, "Movement_ID");
  const statusIdx = headerIndex(headers, "Status");
  const departmentIdx = headerIndex(headers, "Department");
  const amountIdx = headerIndex(headers, "Requested_Amount", "Amount");
  const confirmedByIdx = headerIndex(headers, "Confirmed_By");
  const confirmedAtIdx = headerIndex(headers, "Confirmed_At");
  const receivedAmountIdx = headerIndex(headers, "Received_Amount");
  const differenceIdx = headerIndex(headers, "Difference");
  const acceptedByIdx = headerIndex(headers, "Accepted_By");
  const acceptedAtIdx = headerIndex(headers, "Accepted_At");
  const completedAtIdx = headerIndex(headers, "Completed_At");
  const updatedAtIdx = headerIndex(headers, "Updated_At");

  const dataIndex = rows.slice(1).findIndex((row) => at(row, idIdx) === normalize(movementId));
  if (dataIndex < 0) throw new Error("CONTROL_NOT_FOUND");
  const row = rows[dataIndex + 1];
  const currentStatus = at(row, statusIdx);
  if (!PENDING_STATUSES.has(normalized(currentStatus))) throw new Error("CONTROL_ALREADY_DECIDED");

  const requested = money(at(row, amountIdx));
  const rowNumber = dataIndex + 2;
  const now = dhakaClockParts();
  const sheetId = await movementSheetId(workbook);
  const requests: SpreadsheetBatchRequest[] = [
    updateCellRequest(sheetId, rowNumber, statusIdx + 1, decision === "accept" ? "Accepted" : "Rejected"),
    updateCellRequest(sheetId, rowNumber, confirmedByIdx + 1, input.actorId),
    updateCellRequest(sheetId, rowNumber, confirmedAtIdx + 1, now.timestamp),
    updateCellRequest(sheetId, rowNumber, updatedAtIdx + 1, now.timestamp),
  ];

  if (decision === "accept") {
    const received = input.receivedAmount ?? requested;
    requests.push(
      updateCellRequest(sheetId, rowNumber, receivedAmountIdx + 1, received),
      updateCellRequest(sheetId, rowNumber, differenceIdx + 1, received - requested),
      updateCellRequest(sheetId, rowNumber, acceptedByIdx + 1, input.actorId),
      updateCellRequest(sheetId, rowNumber, acceptedAtIdx + 1, now.timestamp),
      updateCellRequest(sheetId, rowNumber, completedAtIdx + 1, now.timestamp)
    );
  }

  await batchUpdateSpreadsheet(workbook, requests);
  const departmentRaw = at(row, departmentIdx);
  const department: ClinicDepartment =
    departmentRaw === "Dental" || departmentRaw === "Physio"
      ? departmentRaw
      : departmentForWorkbook(workbook);
  await appendCashAudit({
    workbook,
    actorId: input.actorId,
    action: decision === "accept" ? "CASH_MOVEMENT_ACCEPTED" : "CASH_MOVEMENT_REJECTED",
    movementId,
    department,
    beforeValue: currentStatus,
    afterValue: decision === "accept"
      ? JSON.stringify({ status: "Accepted", requested, received: input.receivedAmount ?? requested })
      : "Rejected",
  });
}
