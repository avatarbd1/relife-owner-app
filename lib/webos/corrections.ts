import "server-only";

import { randomUUID } from "node:crypto";
import {
  batchUpdateSpreadsheet,
  fetchSheetRanges,
  getSheetProperties,
  type SpreadsheetBatchRequest,
} from "@/lib/data/googleSheets";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";

type SheetValue = string | number | boolean;

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

function headerIndex(headers: string[], name: string): number {
  return headers.findIndex((header) => normalized(header) === name.toLowerCase());
}

function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
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
  const v = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${v.year}-${v.month}-${v.day}`;
  return { date, timestamp: `${date} ${v.hour}:${v.minute}`, provenance: ref.toISOString() };
}

async function sheetIds(): Promise<Map<string, number>> {
  const properties = await getSheetProperties("physio");
  return new Map(properties.map((item) => [item.title, item.sheetId]));
}

function requireSheetId(map: Map<string, number>, title: string): number {
  const id = map.get(title);
  if (typeof id !== "number") throw new Error("CORRECTION_SCHEMA_MISMATCH");
  return id;
}

function sessionsFromRemarks(remarks: string): number {
  const match = /Sessions:\s*(\d+)/i.exec(remarks);
  return match ? Math.max(0, Number(match[1]) || 0) : 0;
}

export async function deleteLatestTodayPhysioPayment(
  context: AccessContext,
  receiptInput: string
): Promise<{
  receiptNo: string;
  patientId: string;
  reversedAmount: number;
  reversedSessions: number;
}> {
  assertCanPerform(context, "payment.void", "Physio");
  const receiptNo = normalize(receiptInput);
  if (!receiptNo) throw new Error("RECEIPT_REQUIRED");

  const [snapshot, ids] = await Promise.all([
    fetchSheetRanges("physio", [
      "02_Patients",
      "06_Payments",
      "11_Packages",
      "16_Delete_Log",
      "20_Data_Audit",
    ]),
    sheetIds(),
  ]);
  const patientRows = snapshot["02_Patients"] || [];
  const paymentRows = snapshot["06_Payments"] || [];
  const packageRows = snapshot["11_Packages"] || [];
  const deleteRows = snapshot["16_Delete_Log"] || [];
  const auditRows = snapshot["20_Data_Audit"] || [];
  if (
    patientRows.length < 1 ||
    paymentRows.length < 1 ||
    packageRows.length < 1 ||
    deleteRows.length < 1 ||
    auditRows.length < 1
  ) {
    throw new Error("CORRECTION_SCHEMA_MISMATCH");
  }

  const ph = paymentRows[0];
  const pidx = (name: string) => headerIndex(ph, name);
  const receiptIdx = pidx("Receipt_No");
  const departmentIdx = pidx("Department");
  const patientIdIdx = pidx("Patient_ID");
  const dateIdx = pidx("Date");
  const amountIdx = pidx("Amount");
  const discountIdx = pidx("Discount");
  const duePaymentIdx = pidx("Due");
  const remarksIdx = pidx("Remarks");
  if ([receiptIdx, departmentIdx, patientIdIdx, dateIdx].some((index) => index < 0)) {
    throw new Error("CORRECTION_SCHEMA_MISMATCH");
  }

  const dataIndex = paymentRows.slice(1).findIndex((row) => at(row, receiptIdx) === receiptNo);
  if (dataIndex < 0) throw new Error("PAYMENT_NOT_FOUND");
  const paymentRow = paymentRows[dataIndex + 1];
  const paymentRowNumber = dataIndex + 2;
  if (at(paymentRow, departmentIdx) !== "Physio") throw new Error("ACCESS_DENIED");
  const now = dhakaNow();
  if (at(paymentRow, dateIdx) !== now.date) throw new Error("TODAY_ONLY_CORRECTION");
  const patientId = at(paymentRow, patientIdIdx);
  if (!patientId) throw new Error("PAYMENT_PATIENT_MISSING");

  const laterForPatient = paymentRows
    .slice(dataIndex + 2)
    .some((row) => at(row, patientIdIdx) === patientId);
  if (laterForPatient) throw new Error("PAYMENT_NOT_LATEST_FOR_PATIENT");

  const patientHeaders = patientRows[0];
  const hidx = (name: string) => headerIndex(patientHeaders, name);
  const masterIdIdx = hidx("Patient_ID");
  const masterDeptIdx = hidx("Department");
  const paidIdx = hidx("Paid");
  const dueIdx = hidx("Due");
  const billIdx = hidx("Total_Bill");
  const statusIdx = hidx("Payment_Status");
  const updatedIdx = hidx("Last_Updated");
  const advanceIdx = hidx("Advance_Balance");
  const patientDataIndex = patientRows
    .slice(1)
    .findIndex((row) => at(row, masterIdIdx) === patientId);
  if (patientDataIndex < 0) throw new Error("PATIENT_NOT_FOUND");
  const patientRow = patientRows[patientDataIndex + 1];
  if (at(patientRow, masterDeptIdx) !== "Physio") throw new Error("ACCESS_DENIED");
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
  const sessions = sessionsFromRemarks(at(paymentRow, remarksIdx));

  const requests: SpreadsheetBatchRequest[] = [];
  const patientSheetId = requireSheetId(ids, "02_Patients");
  const paymentSheetId = requireSheetId(ids, "06_Payments");
  const packageSheetId = requireSheetId(ids, "11_Packages");
  const deleteSheetId = requireSheetId(ids, "16_Delete_Log");
  const auditSheetId = requireSheetId(ids, "20_Data_Audit");
  requests.push(updateCellRequest(patientSheetId, patientRowNumber, paidIdx + 1, newPaid));
  requests.push(updateCellRequest(patientSheetId, patientRowNumber, dueIdx + 1, newDue));
  requests.push(updateCellRequest(patientSheetId, patientRowNumber, statusIdx + 1, newStatus));
  if (updatedIdx >= 0) {
    requests.push(updateCellRequest(patientSheetId, patientRowNumber, updatedIdx + 1, now.timestamp));
  }
  if (advanceIdx >= 0) {
    requests.push(updateCellRequest(patientSheetId, patientRowNumber, advanceIdx + 1, newAdvance));
  }

  if (sessions > 0 && packageRows.length >= 2) {
    const kh = packageRows[0];
    const kidx = (name: string) => headerIndex(kh, name);
    const packagePatientIdx = kidx("Patient_ID");
    const packageDeptIdx = kidx("Department");
    const usedIdx = kidx("Sessions_Used");
    const remainingIdx = kidx("Sessions_Remaining");
    const statusPackageIdx = kidx("Status");
    const packageDataIndex = packageRows
      .slice(1)
      .map((row, index) => ({ row, index }))
      .reverse()
      .find(
        ({ row }) =>
          at(row, packagePatientIdx) === patientId &&
          at(row, packageDeptIdx) === "Physio" &&
          (!at(row, statusPackageIdx) || at(row, statusPackageIdx).toLowerCase() === "active")
      )?.index;
    if (typeof packageDataIndex === "number" && usedIdx >= 0 && remainingIdx >= 0) {
      const packageRow = packageRows[packageDataIndex + 1];
      const packageRowNumber = packageDataIndex + 2;
      const used = Math.max(0, num(at(packageRow, usedIdx)));
      const remaining = Math.max(0, num(at(packageRow, remainingIdx)));
      requests.push(
        updateCellRequest(packageSheetId, packageRowNumber, usedIdx + 1, Math.max(0, used - sessions))
      );
      requests.push(
        updateCellRequest(packageSheetId, packageRowNumber, remainingIdx + 1, remaining + sessions)
      );
    }
  }

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
        Clinic_ID: "RELIFE-PHYSIO",
        Branch_ID: "AMTALI-01",
        Record_ID: `RELIFE-PHYSIO:${deleteId}`,
        Provider_ID: context.staffId,
        Source_System: "web_pwa",
        Source_Type: "owner_correction",
        AI_Generated: false,
        Human_Verified: true,
        Schema_Version: "relife-uda-v1",
        Provenance_Timestamp: now.provenance,
        Department: "Physio",
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
        Action: "payment.delete_with_reversal",
        Entity_Type: "Payment",
        Entity_ID: receiptNo,
        Patient_ID: patientId,
        Before_Value: rawData,
        After_Value: JSON.stringify({ newPaid, newDue, newAdvance, reversedSessions: sessions }),
        Reason: "Owner same-day latest-entry correction; bot-compatible reversal",
        Organization_ID: "RELIFE",
        Clinic_ID: "RELIFE-PHYSIO",
        Branch_ID: "AMTALI-01",
        Record_ID: `RELIFE-PHYSIO:${auditId}`,
        Provider_ID: context.staffId,
        Source_System: "web_pwa",
        Source_Type: "owner_correction",
        AI_Generated: false,
        Human_Verified: true,
        Schema_Version: "relife-uda-v1",
        Provenance_Timestamp: now.provenance,
        Department: "Physio",
      })
    )
  );
  requests.push(deleteRowRequest(paymentSheetId, paymentRowNumber));
  await batchUpdateSpreadsheet("physio", requests);

  return {
    receiptNo,
    patientId,
    reversedAmount: amount,
    reversedSessions: sessions,
  };
}
