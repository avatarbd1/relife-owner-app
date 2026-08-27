import "server-only";

import { randomUUID } from "node:crypto";
import {
  appendSheetValues,
  batchUpdateSpreadsheet,
  fetchSheetRanges,
  getSheetProperties,
  type SpreadsheetBatchRequest,
  type Workbook,
} from "@/lib/data/googleSheets";
import type { Scope } from "@/lib/types";
import { recordCashReconciliationGamification } from "@/lib/domain/gamification/events";
import { assertCanPerform, canPerform, type AccessContext } from "@/lib/webos/access";

type ClinicDepartment = "Physio" | "Dental";
type SheetValue = string | number | boolean;

export interface PendingCashMovement {
  movementId: string;
  date: string;
  department: ClinicDepartment;
  fromCustodian: string;
  toCustodian: string;
  requestedAmount: number;
  movedBy: string;
  note: string;
  requestedAt: string;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase();
}

function money(value: unknown): number {
  const parsed = Number(normalize(value).replace(/[৳,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function headerIndex(headers: string[], ...names: string[]): number {
  const values = headers.map(normalized);
  for (const name of names) {
    const index = values.indexOf(name.toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
}

function scopeAllows(scope: Scope, department: ClinicDepartment): boolean {
  if (scope === "combined") return true;
  return department === (scope === "physio" ? "Physio" : "Dental");
}

function workbookForDepartment(department: ClinicDepartment): Workbook {
  return department === "Dental" ? "dental" : "physio";
}

function cellValue(value: SheetValue): Record<string, unknown> {
  if (typeof value === "boolean") return { userEnteredValue: { boolValue: value } };
  if (typeof value === "number") return { userEnteredValue: { numberValue: value } };
  return { userEnteredValue: { stringValue: String(value) } };
}

function updateCellRequest(sheetId: number, rowNumber: number, columnNumber: number, value: SheetValue): SpreadsheetBatchRequest {
  return {
    updateCells: {
      range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: columnNumber - 1, endColumnIndex: columnNumber },
      rows: [{ values: [cellValue(value)] }],
      fields: "userEnteredValue",
    },
  };
}

function dhakaNow(ref = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(ref);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  return { timestamp: `${date} ${values.hour}:${values.minute}`, provenance: ref.toISOString() };
}

function parsePending(rows: string[][], fallback: ClinicDepartment): PendingCashMovement[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idx = (...names: string[]) => headerIndex(headers, ...names);
  return rows.slice(1).flatMap((row) => {
    const movementId = at(row, idx("Movement_ID"));
    if (!movementId || normalized(at(row, idx("Status")) || "Pending") !== "pending") return [];
    const departmentText = at(row, idx("Department"));
    const department = (departmentText || fallback) as ClinicDepartment;
    if (department !== "Physio" && department !== "Dental") return [];
    const requestedAmount = money(at(row, idx("Requested_Amount")) || at(row, idx("Amount")));
    return [{
      movementId,
      date: at(row, idx("Date")),
      department,
      fromCustodian: at(row, idx("From_Custodian")) || at(row, idx("From_Custodian_ID")),
      toCustodian: at(row, idx("To_Custodian")) || at(row, idx("To_Custodian_ID")),
      requestedAmount,
      movedBy: at(row, idx("Moved_By", "From_Staff_ID")),
      note: at(row, idx("Note")),
      requestedAt: at(row, idx("Requested_At", "Timestamp")),
    }];
  });
}

export async function getPendingCashMovements(context: AccessContext, scope: Scope): Promise<PendingCashMovement[]> {
  const departments = (["Physio", "Dental"] as ClinicDepartment[]).filter(
    (department) => scopeAllows(scope, department) && canPerform(context, "cash.accept", department)
  );
  const groups = await Promise.all(departments.map(async (department) => {
    const workbook = workbookForDepartment(department);
    const snapshot = await fetchSheetRanges(workbook, ["21_Cash_Movement"]);
    return parsePending(snapshot["21_Cash_Movement"] || [], department);
  }));
  return groups.flat().sort((a, b) => `${b.date}|${b.movementId}`.localeCompare(`${a.date}|${a.movementId}`));
}

export async function finalizeCashMovement(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  input: { movementId: string; department: ClinicDepartment | string; decision: "Accepted" | "Rejected" | string; receivedAmount?: number }
): Promise<{ movementId: string; decision: "Accepted" | "Rejected"; difference: number }> {
  const department = normalize(input.department) as ClinicDepartment;
  if (department !== "Physio" && department !== "Dental") throw new Error("INVALID_DEPARTMENT");
  assertCanPerform(context, "cash.accept", department);

  const movementId = normalize(input.movementId);
  const decision = normalize(input.decision) as "Accepted" | "Rejected";
  if (!movementId) throw new Error("CASH_MOVEMENT_NOT_FOUND");
  if (decision !== "Accepted" && decision !== "Rejected") throw new Error("INVALID_DECISION");

  const workbook = workbookForDepartment(department);
  const snapshot = await fetchSheetRanges(workbook, ["21_Cash_Movement"]);
  const rows = snapshot["21_Cash_Movement"] || [];
  if (rows.length < 2) throw new Error("CASH_MOVEMENT_NOT_FOUND");
  const headers = rows[0];
  const idIdx = headerIndex(headers, "Movement_ID");
  const statusIdx = headerIndex(headers, "Status");
  const confirmedByIdx = headerIndex(headers, "Confirmed_By");
  const confirmedAtIdx = headerIndex(headers, "Confirmed_At");
  const departmentIdx = headerIndex(headers, "Department");
  const requestedIdx = headerIndex(headers, "Requested_Amount", "Amount");
  const receivedIdx = headerIndex(headers, "Received_Amount");
  const differenceIdx = headerIndex(headers, "Difference");
  const updatedIdx = headerIndex(headers, "Updated_At");
  const movedByIdx = headerIndex(headers, "Moved_By", "From_Staff_ID");
  if ([idIdx, statusIdx, confirmedByIdx, confirmedAtIdx].some((idx) => idx < 0)) throw new Error("SCHEMA_MISMATCH");

  const offset = rows.slice(1).findIndex((row) => at(row, idIdx) === movementId);
  if (offset < 0) throw new Error("CASH_MOVEMENT_NOT_FOUND");
  const row = rows[offset + 1];
  const rowDepartment = at(row, departmentIdx);
  if (rowDepartment && normalized(rowDepartment) !== normalized(department)) throw new Error("DEPARTMENT_MISMATCH");
  const currentStatus = normalize(at(row, statusIdx)) || "Pending";
  if (normalized(currentStatus) !== "pending") throw new Error("CASH_MOVEMENT_ALREADY_DECIDED");
  const movedBy = at(row, movedByIdx);

  const requestedAmount = money(at(row, requestedIdx));
  const receivedAmount = decision === "Accepted" ? Number(input.receivedAmount ?? requestedAmount) : 0;
  if (!Number.isFinite(receivedAmount) || receivedAmount < 0) throw new Error("INVALID_RECEIVED_AMOUNT");
  const difference = decision === "Accepted" ? receivedAmount - requestedAmount : 0;

  const properties = await getSheetProperties(workbook);
  const sheetId = properties.find((item) => item.title === "21_Cash_Movement")?.sheetId;
  if (typeof sheetId !== "number") throw new Error("SCHEMA_MISMATCH");
  const rowNumber = offset + 2;
  const now = dhakaNow();
  const requests: SpreadsheetBatchRequest[] = [
    updateCellRequest(sheetId, rowNumber, statusIdx + 1, decision),
    updateCellRequest(sheetId, rowNumber, confirmedByIdx + 1, context.staffId),
    updateCellRequest(sheetId, rowNumber, confirmedAtIdx + 1, now.timestamp),
  ];
  if (receivedIdx >= 0) requests.push(updateCellRequest(sheetId, rowNumber, receivedIdx + 1, receivedAmount));
  if (differenceIdx >= 0) requests.push(updateCellRequest(sheetId, rowNumber, differenceIdx + 1, difference));
  if (updatedIdx >= 0) requests.push(updateCellRequest(sheetId, rowNumber, updatedIdx + 1, now.timestamp));
  await batchUpdateSpreadsheet(workbook, requests);

  try {
    await appendSheetValues(workbook, "'20_Data_Audit'!A:W", [[
      `AUD-${randomUUID()}`, now.timestamp, context.staffId, "cash.movement.finalize", "CashMovement", movementId, "", currentStatus, decision,
      `Requested ${requestedAmount}; received ${receivedAmount}; difference ${difference}`,
      organizationId, clinicId, "AMTALI-01", `${clinicId}:${movementId}`, "", context.staffId, "web_pwa", "human_entry", false, true,
      "relife-uda-v1", now.provenance, department,
    ]]);
  } catch (error) {
    console.error("Cash finalization audit append failed", error);
  }

  if (decision === "Accepted" && movedBy) {
    await recordCashReconciliationGamification({
      tenant: { organizationId, clinicId },
      movementId,
      department,
      staffReference: movedBy,
      reconciledAt: now.provenance,
      difference,
      actorContext: context,
    });
  }

  return { movementId, decision, difference };
}
