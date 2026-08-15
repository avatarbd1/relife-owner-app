import "server-only";

import { randomUUID } from "node:crypto";
import {
  batchUpdateSpreadsheet,
  fetchSheetRanges,
  getSheetProperties,
  type SpreadsheetBatchRequest,
  type Workbook,
} from "@/lib/data/googleSheets";
import { assertCanPerform, canPerform, type AccessContext } from "@/lib/webos/access";
import { getActiveWebStaffById } from "@/lib/webos/staffDirectory";

type ClinicDepartment = "Physio" | "Dental";
type SheetValue = string | number | boolean;

export interface OwnTodayCorrectionEntry {
  receiptNo: string;
  department: ClinicDepartment;
  patientId: string;
  patientName: string;
  amount: number;
  discount: number;
  due: number;
  sessions: number;
  receivedBy: string;
  paymentMethod: string;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function num(value: unknown): number {
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

function workbookFor(department: ClinicDepartment): Workbook {
  return department === "Dental" ? "dental" : "physio";
}

function clinicId(department: ClinicDepartment): string {
  return department === "Dental" ? "RELIFE-DENTAL" : "RELIFE-PHYSIO";
}

function dhakaNow(ref = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(ref);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  return {
    date,
    timestamp: `${date} ${values.hour}:${values.minute}`,
    provenance: ref.toISOString(),
  };
}

function sessionsFrom(row: string[], headers: string[]): number {
  const explicit = at(row, headerIndex(headers, "Sessions"));
  if (explicit) return Math.max(0, Number(explicit) || 0);
  const remarks = at(row, headerIndex(headers, "Remarks"));
  const match = /Sessions:\s*(\d+)/i.exec(remarks);
  return match ? Math.max(0, Number(match[1]) || 0) : 0;
}

function identityMatches(value: string, staffId: string, fullName: string): boolean {
  const needle = normalized(value);
  return Boolean(
    needle &&
      (needle === normalized(staffId) || needle === normalized(fullName))
  );
}

function rowForHeaders(headers: string[], values: Record<string, SheetValue>): SheetValue[] {
  const map = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value])
  );
  return headers.map((header) => map.get(normalized(header)) ?? "");
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

function deleteRowRequest(sheetId: number, rowNumber: number): SpreadsheetBatchRequest {
  return {
    deleteDimension: {
      range: {
        sheetId,
        dimension: "ROWS",
        startIndex: rowNumber - 1,
        endIndex: rowNumber,
      },
    },
  };
}

function requireSheetId(map: Map<string, number>, title: string): number {
  const id = map.get(title);
  if (typeof id !== "number") throw new Error("CORRECTION_SCHEMA_MISMATCH");
  return id;
}

async function listDepartmentEntries(
  context: AccessContext,
  department: ClinicDepartment,
  staffId: string,
  fullName: string,
  today: string
): Promise<OwnTodayCorrectionEntry[]> {
  if (!canPerform(context, "payment.correct_own_today", department)) return [];
  const workbook = workbookFor(department);
  const snapshot = await fetchSheetRanges(workbook, ["06_Payments"]);
  const rows = snapshot["06_Payments"] || [];
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idx = (...names: string[]) => headerIndex(headers, ...names);
  const dateIdx = idx("Date");
  const receiptIdx = idx("Receipt_No", "Receipt");
  const departmentIdx = idx("Department");
  const receivedByIdx = idx("Received_By", "Created_By", "Staff", "Staff_Name");
  if (dateIdx < 0 || receiptIdx < 0 || receivedByIdx < 0) return [];

  return rows
    .slice(1)
    .flatMap((row) => {
      if (at(row, dateIdx) !== today) return [];
      const rowDepartment = at(row, departmentIdx);
      if (rowDepartment && normalized(rowDepartment) !== normalized(department)) return [];
      const receivedBy = at(row, receivedByIdx);
      if (!identityMatches(receivedBy, staffId, fullName)) return [];
      const receiptNo = at(row, receiptIdx);
      if (!receiptNo) return [];
      return [{
        receiptNo,
        department,
        patientId: at(row, idx("Patient_ID")),
        patientName: at(row, idx("Patient_Name")),
        amount: num(at(row, idx("Amount"))),
        discount: num(at(row, idx("Discount"))),
        due: num(at(row, idx("Due"))),
        sessions: sessionsFrom(row, headers),
        receivedBy,
        paymentMethod: at(row, idx("Payment_Method")),
      }];
    })
    .reverse();
}

export async function listOwnTodayCorrectionEntries(
  context: AccessContext
): Promise<OwnTodayCorrectionEntry[]> {
  const identity = await getActiveWebStaffById(context.staffId);
  if (!identity) throw new Error("ACCESS_DENIED");
  const today = dhakaNow().date;
  const groups = await Promise.all(
    (["Physio", "Dental"] as ClinicDepartment[]).map((department) =>
      listDepartmentEntries(
        context,
        department,
        identity.staffId,
        identity.fullName,
        today
      )
    )
  );
  return groups.flat();
}

export async function deleteOwnLatestTodayPayment(
  context: AccessContext,
  input: { department: ClinicDepartment | string; receiptNo: string }
): Promise<{
  receiptNo: string;
  department: ClinicDepartment;
  patientId: string;
  reversedAmount: number;
  reversedSessions: number;
}> {
  const department = normalize(input.department) as ClinicDepartment;
  if (department !== "Physio" && department !== "Dental") {
    throw new Error("INVALID_DEPARTMENT");
  }
  assertCanPerform(context, "payment.correct_own_today", department);
  const identity = await getActiveWebStaffById(context.staffId);
  if (!identity) throw new Error("ACCESS_DENIED");

  const receiptNo = normalize(input.receiptNo);
  if (!receiptNo) throw new Error("RECEIPT_REQUIRED");
  const workbook = workbookFor(department);
  const ranges = [
    "02_Patients",
    "06_Payments",
    "16_Delete_Log",
    "20_Data_Audit",
    ...(department === "Physio" ? ["11_Packages"] : []),
  ];
  const [snapshot, properties] = await Promise.all([
    fetchSheetRanges(workbook, ranges),
    getSheetProperties(workbook),
  ]);
  const ids = new Map(properties.map((item) => [item.title, item.sheetId]));
  const patientRows = snapshot["02_Patients"] || [];
  const paymentRows = snapshot["06_Payments"] || [];
  const packageRows = snapshot["11_Packages"] || [];
  const deleteRows = snapshot["16_Delete_Log"] || [];
  const auditRows = snapshot["20_Data_Audit"] || [];
  if (
    patientRows.length < 1 ||
    paymentRows.length < 1 ||
    deleteRows.length < 1 ||
    auditRows.length < 1
  ) {
    throw new Error("CORRECTION_SCHEMA_MISMATCH");
  }

  const ph = paymentRows[0];
  const pidx = (...names: string[]) => headerIndex(ph, ...names);
  const receiptIdx = pidx("Receipt_No", "Receipt");
  const departmentIdx = pidx("Department");
  const patientIdIdx = pidx("Patient_ID");
  const dateIdx = pidx("Date");
  const amountIdx = pidx("Amount");
  const discountIdx = pidx("Discount");
  const duePaymentIdx = pidx("Due");
  const receivedByIdx = pidx("Received_By", "Created_By", "Staff", "Staff_Name");
  if ([receiptIdx, patientIdIdx, dateIdx, receivedByIdx].some((index) => index < 0)) {
    throw new Error("CORRECTION_SCHEMA_MISMATCH");
  }

  const dataIndex = paymentRows
    .slice(1)
    .findIndex((row) => at(row, receiptIdx) === receiptNo);
  if (dataIndex < 0) throw new Error("PAYMENT_NOT_FOUND");
  const paymentRow = paymentRows[dataIndex + 1];
  const paymentRowNumber = dataIndex + 2;
  const rowDepartment = at(paymentRow, departmentIdx);
  if (rowDepartment && normalized(rowDepartment) !== normalized(department)) {
    throw new Error("ACCESS_DENIED");
  }
  const now = dhakaNow();
  if (at(paymentRow, dateIdx) !== now.date) throw new Error("TODAY_ONLY_CORRECTION");
  if (
    !identityMatches(
      at(paymentRow, receivedByIdx),
      identity.staffId,
      identity.fullName
    )
  ) {
    throw new Error("OWN_ENTRY_REQUIRED");
  }

  const patientId = at(paymentRow, patientIdIdx);
  if (!patientId) throw new Error("PAYMENT_PATIENT_MISSING");
  const laterForPatient = paymentRows
    .slice(dataIndex + 2)
    .some((row) => at(row, patientIdIdx) === patientId);
  if (laterForPatient) throw new Error("PAYMENT_NOT_LATEST_FOR_PATIENT");

  const patientHeaders = patientRows[0];
  const hidx = (...names: string[]) => headerIndex(patientHeaders, ...names);
  const masterIdIdx = hidx("Patient_ID");
  const masterDeptIdx = hidx("Department");
  const paidIdx = hidx("Paid");
  const dueIdx = hidx("Due");
  const billIdx = hidx("Total_Bill");
  const statusIdx = hidx("Payment_Status");
  const updatedIdx = hidx("Last_Updated");
  const advanceIdx = hidx("Advance_Balance");
  if ([masterIdIdx, paidIdx, dueIdx].some((index) => index < 0)) {
    throw new Error("CORRECTION_SCHEMA_MISMATCH");
  }
  const patientDataIndex = patientRows
    .slice(1)
    .findIndex((row) => at(row, masterIdIdx) === patientId);
  if (patientDataIndex < 0) throw new Error("PATIENT_NOT_FOUND");
  const patientRow = patientRows[patientDataIndex + 1];
  const patientDepartment = at(patientRow, masterDeptIdx);
  if (patientDepartment && normalized(patientDepartment) !== normalized(department)) {
    throw new Error("ACCESS_DENIED");
  }
  const patientRowNumber = patientDataIndex + 2;

  const amount = num(at(paymentRow, amountIdx));
  const discount = num(at(paymentRow, discountIdx));
  const paymentPostDue = Math.max(0, num(at(paymentRow, duePaymentIdx)));
  const currentDue = Math.max(0, num(at(patientRow, dueIdx)));
  if (Math.abs(currentDue - paymentPostDue) > 0.01) {
    throw new Error("STALE_PAYMENT_STATE");
  }
  const currentPaid = Math.max(0, num(at(patientRow, paidIdx)));
  const totalBill = Math.max(0, num(at(patientRow, billIdx)));
  const newPaid = Math.max(0, currentPaid - amount);
  const restoredDueRaw = currentDue + amount + discount;
  const newDue = totalBill > 0 ? Math.min(totalBill, restoredDueRaw) : restoredDueRaw;
  const newAdvance = Math.max(0, totalBill > 0 ? newPaid - totalBill : 0);
  const newStatus = newDue <= 0 ? "Paid" : "Due";
  const sessions = sessionsFrom(paymentRow, ph);

  const patientSheetId = requireSheetId(ids, "02_Patients");
  const paymentSheetId = requireSheetId(ids, "06_Payments");
  const deleteSheetId = requireSheetId(ids, "16_Delete_Log");
  const auditSheetId = requireSheetId(ids, "20_Data_Audit");
  const requests: SpreadsheetBatchRequest[] = [
    updateCellRequest(patientSheetId, patientRowNumber, paidIdx + 1, newPaid),
    updateCellRequest(patientSheetId, patientRowNumber, dueIdx + 1, newDue),
  ];
  if (statusIdx >= 0) {
    requests.push(updateCellRequest(patientSheetId, patientRowNumber, statusIdx + 1, newStatus));
  }
  if (updatedIdx >= 0) {
    requests.push(updateCellRequest(patientSheetId, patientRowNumber, updatedIdx + 1, now.timestamp));
  }
  if (advanceIdx >= 0) {
    requests.push(updateCellRequest(patientSheetId, patientRowNumber, advanceIdx + 1, newAdvance));
  }

  if (department === "Physio" && sessions > 0 && packageRows.length >= 2) {
    const kh = packageRows[0];
    const kidx = (...names: string[]) => headerIndex(kh, ...names);
    const packagePatientIdx = kidx("Patient_ID");
    const packageDeptIdx = kidx("Department");
    const usedIdx = kidx("Sessions_Used");
    const remainingIdx = kidx("Sessions_Remaining");
    const packageStatusIdx = kidx("Status");
    const packageDataIndex = packageRows
      .slice(1)
      .map((row, index) => ({ row, index }))
      .reverse()
      .find(
        ({ row }) =>
          at(row, packagePatientIdx) === patientId &&
          (!at(row, packageDeptIdx) || at(row, packageDeptIdx) === "Physio") &&
          (!at(row, packageStatusIdx) || normalized(at(row, packageStatusIdx)) === "active")
      )?.index;
    if (
      typeof packageDataIndex === "number" &&
      usedIdx >= 0 &&
      remainingIdx >= 0
    ) {
      const packageSheetId = requireSheetId(ids, "11_Packages");
      const packageRow = packageRows[packageDataIndex + 1];
      const packageRowNumber = packageDataIndex + 2;
      const used = Math.max(0, num(at(packageRow, usedIdx)));
      const remaining = Math.max(0, num(at(packageRow, remainingIdx)));
      requests.push(
        updateCellRequest(
          packageSheetId,
          packageRowNumber,
          usedIdx + 1,
          Math.max(0, used - sessions)
        )
      );
      requests.push(
        updateCellRequest(
          packageSheetId,
          packageRowNumber,
          remainingIdx + 1,
          remaining + sessions
        )
      );
    }
  }

  const clinic = clinicId(department);
  const rawData = JSON.stringify(
    Object.fromEntries(ph.map((header, index) => [header, paymentRow[index] ?? ""]))
  ).slice(0, 30000);
  const deleteId = `DELW${randomUUID().replace(/-/g, "").slice(0, 9).toUpperCase()}`;
  requests.push(
    appendRowRequest(
      deleteSheetId,
      rowForHeaders(deleteRows[0], {
        Timestamp: now.timestamp,
        Deleted_By: context.staffId,
        Type: amount > 0 ? "Payment" : "Session",
        Receipt_No: receiptNo,
        Patient_ID: patientId,
        Patient_Name: at(paymentRow, pidx("Patient_Name")),
        Amount: amount,
        Sessions: sessions,
        Raw_Data_JSON: rawData,
        Organization_ID: "RELIFE",
        Clinic_ID: clinic,
        Branch_ID: "AMTALI-01",
        Record_ID: `${clinic}:${deleteId}`,
        Provider_ID: context.staffId,
        Source_System: "web_pwa",
        Source_Type: "own_same_day_correction",
        AI_Generated: false,
        Human_Verified: true,
        Schema_Version: "relife-uda-v1",
        Provenance_Timestamp: now.provenance,
        Department: department,
      })
    )
  );
  const auditId = `AUD-${randomUUID()}`;
  requests.push(
    appendRowRequest(
      auditSheetId,
      rowForHeaders(auditRows[0], {
        Audit_ID: auditId,
        Timestamp: now.timestamp,
        Actor_ID: context.staffId,
        Action: "payment.delete_own_today_with_reversal",
        Entity_Type: "Payment",
        Entity_ID: receiptNo,
        Patient_ID: patientId,
        Before_Value: rawData,
        After_Value: JSON.stringify({
          newPaid,
          newDue,
          newAdvance,
          reversedSessions: sessions,
        }),
        Reason: "Telegram parity: own same-day latest-entry correction",
        Organization_ID: "RELIFE",
        Clinic_ID: clinic,
        Branch_ID: "AMTALI-01",
        Record_ID: `${clinic}:${auditId}`,
        Provider_ID: context.staffId,
        Source_System: "web_pwa",
        Source_Type: "own_same_day_correction",
        AI_Generated: false,
        Human_Verified: true,
        Schema_Version: "relife-uda-v1",
        Provenance_Timestamp: now.provenance,
        Department: department,
      })
    )
  );
  requests.push(deleteRowRequest(paymentSheetId, paymentRowNumber));
  await batchUpdateSpreadsheet(workbook, requests);

  return {
    receiptNo,
    department,
    patientId,
    reversedAmount: amount,
    reversedSessions: sessions,
  };
}
