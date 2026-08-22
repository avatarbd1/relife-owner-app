import "server-only";

import { randomUUID } from "node:crypto";
import {
  batchUpdateSpreadsheet,
  fetchSheetRanges,
  getSheetProperties,
  type SpreadsheetBatchRequest,
  type Workbook,
} from "@/lib/data/googleSheets";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import { APPOINTMENT_STATUSES, type AppointmentStatus } from "@/lib/webos/appointmentStatus";

type ClinicDepartment = "Physio" | "Dental";
type SheetValue = string | number | boolean;

function normalize(value: unknown): string { return String(value ?? "").trim(); }
function normalized(value: unknown): string { return normalize(value).toLowerCase(); }
function headerIndex(headers: string[], ...names: string[]): number {
  const values = headers.map(normalized);
  for (const name of names) {
    const index = values.indexOf(name.toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}
function at(row: string[], index: number): string { return index >= 0 ? normalize(row[index]) : ""; }
function workbookForDepartment(department: ClinicDepartment): Workbook { return department === "Dental" ? "dental" : "physio"; }
function clinicId(department: ClinicDepartment): string { return department === "Dental" ? "RELIFE-DENTAL" : "RELIFE-PHYSIO"; }
function dhakaNow(ref = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(ref);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  return { timestamp: `${date} ${values.hour}:${values.minute}`, provenance: ref.toISOString() };
}
function cellValue(value: SheetValue) {
  if (typeof value === "number") return { userEnteredValue: { numberValue: value } };
  if (typeof value === "boolean") return { userEnteredValue: { boolValue: value } };
  return { userEnteredValue: { stringValue: value } };
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
function appendRowRequest(sheetId: number, row: SheetValue[]): SpreadsheetBatchRequest {
  return {
    appendCells: {
      sheetId,
      rows: [{ values: row.map(cellValue) }],
      fields: "userEnteredValue",
    },
  };
}
function rowForHeaders(headers: string[], values: Record<string, SheetValue>): SheetValue[] {
  const map = new Map(Object.entries(values).map(([key, value]) => [normalized(key), value]));
  return headers.map((header) => map.get(normalized(header)) ?? "");
}

/**
 * Reverts a non-completion appointment status only when the canonical current
 * status still equals the state produced by the just-finished UI action.
 * Completed is excluded because completion projects gamification evidence.
 */
export async function undoAppointmentStatus(
  context: AccessContext,
  input: {
    appointmentId: string;
    department: string;
    expectedCurrentStatus: string;
    restoreStatus: string;
  }
): Promise<{ appointmentId: string; status: AppointmentStatus }> {
  const appointmentId = normalize(input.appointmentId);
  const department = normalize(input.department) as ClinicDepartment;
  const expectedCurrentStatus = normalize(input.expectedCurrentStatus) as AppointmentStatus;
  const restoreStatus = normalize(input.restoreStatus) as AppointmentStatus;
  if (!appointmentId) throw new Error("APPOINTMENT_NOT_FOUND");
  if (!(["Physio", "Dental"] as string[]).includes(department)) throw new Error("INVALID_DEPARTMENT");
  if (!APPOINTMENT_STATUSES.includes(expectedCurrentStatus) || !APPOINTMENT_STATUSES.includes(restoreStatus)) {
    throw new Error("INVALID_APPOINTMENT_STATUS");
  }
  if (expectedCurrentStatus === "Completed" || restoreStatus === "Completed") {
    throw new Error("APPOINTMENT_COMPLETION_CORRECTION_REQUIRED");
  }
  assertCanPerform(context, "appointment.update", department);

  const workbook = workbookForDepartment(department);
  const [snapshot, properties] = await Promise.all([
    fetchSheetRanges(workbook, ["04_Appointments", "20_Data_Audit"]),
    getSheetProperties(workbook),
  ]);
  const rows = snapshot["04_Appointments"] || [];
  const auditRows = snapshot["20_Data_Audit"] || [];
  if (rows.length < 1 || auditRows.length < 1) throw new Error("SCHEMA_MISMATCH");
  const headers = rows[0];
  const idIdx = headerIndex(headers, "Appointment_ID");
  const statusIdx = headerIndex(headers, "Status");
  const departmentIdx = headerIndex(headers, "Department");
  const patientIdx = headerIndex(headers, "Patient_ID");
  const updatedIdx = headerIndex(headers, "Last_Updated", "Updated_At");
  if (idIdx < 0 || statusIdx < 0) throw new Error("SCHEMA_MISMATCH");

  const rowOffset = rows.slice(1).findIndex((row) => at(row, idIdx) === appointmentId);
  if (rowOffset < 0) throw new Error("APPOINTMENT_NOT_FOUND");
  const row = rows[rowOffset + 1];
  const rowDepartment = at(row, departmentIdx);
  if (rowDepartment && normalized(rowDepartment) !== normalized(department)) throw new Error("DEPARTMENT_MISMATCH");
  const currentStatus = (at(row, statusIdx) || "Scheduled") as AppointmentStatus;
  if (currentStatus !== expectedCurrentStatus) throw new Error("APPOINTMENT_UNDO_CONFLICT");

  const idMap = new Map(properties.map((item) => [item.title, item.sheetId]));
  const appointmentSheetId = idMap.get("04_Appointments");
  const auditSheetId = idMap.get("20_Data_Audit");
  if (typeof appointmentSheetId !== "number" || typeof auditSheetId !== "number") {
    throw new Error("SCHEMA_MISMATCH");
  }

  const rowNumber = rowOffset + 2;
  const now = dhakaNow();
  const clinic = clinicId(department);
  const auditId = `AUD-${randomUUID()}`;
  const auditRow = rowForHeaders(auditRows[0], {
    Audit_ID: auditId,
    Timestamp: now.timestamp,
    Actor_ID: context.staffId,
    Action: "appointment.status.undo",
    Entity_Type: "Appointment",
    Entity_ID: appointmentId,
    Patient_ID: at(row, patientIdx),
    Before_Value: expectedCurrentStatus,
    After_Value: restoreStatus,
    Reason: "User undo of recent appointment status change",
    Organization_ID: "RELIFE",
    Clinic_ID: clinic,
    Branch_ID: "AMTALI-01",
    Record_ID: `${clinic}:${appointmentId}`,
    Provider_ID: context.staffId,
    Source_System: "web_pwa",
    Source_Type: "human_entry",
    AI_Generated: false,
    Human_Verified: true,
    Schema_Version: "relife-uda-v1",
    Provenance_Timestamp: now.provenance,
    Department: department,
  });

  const requests: SpreadsheetBatchRequest[] = [
    updateCellRequest(appointmentSheetId, rowNumber, statusIdx + 1, restoreStatus),
  ];
  if (updatedIdx >= 0) {
    requests.push(updateCellRequest(appointmentSheetId, rowNumber, updatedIdx + 1, now.timestamp));
  }
  requests.push(appendRowRequest(auditSheetId, auditRow));
  await batchUpdateSpreadsheet(workbook, requests);

  return { appointmentId, status: restoreStatus };
}
