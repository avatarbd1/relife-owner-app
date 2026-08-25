import "server-only";

import { randomUUID } from "node:crypto";
import {
  RELIFE_SYSTEM,
  dhakaClockParts,
  workbookForDepartment,
} from "@/lib/config/relifeSystem";
import {
  batchUpdateSpreadsheet,
  fetchSheetRanges,
  getSheetProperties,
  type SpreadsheetBatchRequest,
  type Workbook,
} from "@/lib/data/googleSheets";
import type { ClinicDepartment } from "@/lib/domain/finance/expenses";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";

type SheetValue = string | number | boolean;
export type PaymentMethod = "Cash" | "bKash" | "Nagad" | "Bank" | "Card";

export interface PaymentCreateInput {
  patientId: string;
  amount: number;
  discount?: number;
  paymentMethod: PaymentMethod;
  sessions?: number;
  sessionType?: string;
  remarks?: string;
  requestId: string;
}

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

function departmentFromPatientId(patientId: string): ClinicDepartment {
  const id = normalize(patientId).toUpperCase();
  if (id.startsWith("DT")) return "Dental";
  if (id.startsWith("PT")) return "Physio";
  throw new Error("INVALID_PATIENT_ID");
}

function validateRequestId(value: string): string {
  const requestId = normalize(value);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) throw new Error("INVALID_REQUEST_ID");
  return requestId;
}

function nextReceiptId(existing: Set<string>): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = `RCW${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
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

async function sheetIds(workbook: Workbook): Promise<Map<string, number>> {
  const properties = await getSheetProperties(workbook);
  return new Map(properties.map((item) => [item.title, item.sheetId]));
}

function requireSheetId(map: Map<string, number>, title: string): number {
  const id = map.get(title);
  if (typeof id !== "number") throw new Error("SCHEMA_MISMATCH");
  return id;
}

export async function createPayment(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  input: PaymentCreateInput
): Promise<{ receiptNo: string; due: number; duplicate: boolean }> {
  const patientId = normalize(input.patientId).toUpperCase();
  const department = departmentFromPatientId(patientId);
  assertCanPerform(context, "payment.create", department);

  const amount = Number(input.amount);
  const discount = Number(input.discount || 0);
  const sessions = Math.max(0, Math.trunc(Number(input.sessions || 0)));
  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(discount) || discount < 0) {
    throw new Error("INVALID_AMOUNT");
  }
  if (amount === 0 && sessions === 0) throw new Error("EMPTY_PAYMENT");
  const method = input.paymentMethod;
  if (!["Cash", "bKash", "Nagad", "Bank", "Card"].includes(method)) {
    throw new Error("INVALID_PAYMENT_METHOD");
  }

  const requestId = validateRequestId(input.requestId);
  const marker = `WEBREQ:${requestId}`;
  const workbook = workbookForDepartment(department);
  const snapshot = await fetchSheetRanges(workbook, ["02_Patients", "06_Payments"]);
  const patientRows = snapshot["02_Patients"] || [];
  const paymentRows = snapshot["06_Payments"] || [];
  if (patientRows.length < 2 || paymentRows.length < 1) throw new Error("SCHEMA_MISMATCH");

  const paymentHeaders = paymentRows[0];
  const remarksIdx = headerIndex(paymentHeaders, "Remarks");
  const receiptIdx = headerIndex(paymentHeaders, "Receipt_No");
  const duePaymentIdx = headerIndex(paymentHeaders, "Due");
  const existingRequest = paymentRows.slice(1).find((row) => at(row, remarksIdx).includes(marker));
  if (existingRequest) {
    return {
      receiptNo: at(existingRequest, receiptIdx),
      due: money(at(existingRequest, duePaymentIdx)),
      duplicate: true,
    };
  }

  const ids = await sheetIds(workbook);
  const patientSheetId = requireSheetId(ids, "02_Patients");
  const paymentSheetId = requireSheetId(ids, "06_Payments");
  const auditSheetId = requireSheetId(ids, "20_Data_Audit");
  const auditSnapshot = await fetchSheetRanges(workbook, ["20_Data_Audit"]);
  const auditRows = auditSnapshot["20_Data_Audit"] || [];
  if (auditRows.length < 1) throw new Error("SCHEMA_MISMATCH");
  const auditHeaders = auditRows[0];

  const patientHeaders = patientRows[0];
  ensureHeaders(patientHeaders, [
    "Patient_ID",
    "Full_Name",
    "Department",
    "Paid",
    "Due",
    "Payment_Status",
    "Last_Updated",
  ]);
  ensureHeaders(paymentHeaders, [
    "Receipt_No",
    "Date",
    "Patient_ID",
    "Patient_Name",
    "Department",
    "Amount",
    "Discount",
    "Due",
    "Payment_Method",
    "Received_By",
    "Remarks",
  ]);
  ensureHeaders(auditHeaders, [
    "Audit_ID",
    "Timestamp",
    "Actor_ID",
    "Action",
    "Entity_Type",
    "Entity_ID",
    "Patient_ID",
    "Before_Value",
    "After_Value",
    "Reason",
    "Organization_ID",
    "Clinic_ID",
    "Branch_ID",
    "Record_ID",
    "Encounter_ID",
    "Provider_ID",
    "Source_System",
    "Source_Type",
    "AI_Generated",
    "Human_Verified",
    "Schema_Version",
    "Provenance_Timestamp",
    "Department",
  ]);

  const patientIdIdx = headerIndex(patientHeaders, "Patient_ID");
  const dataIndex = patientRows.slice(1).findIndex(
    (row) => at(row, patientIdIdx).toUpperCase() === patientId
  );
  if (dataIndex < 0) throw new Error("PATIENT_NOT_FOUND");
  const patientRow = patientRows[dataIndex + 1];
  const rowNumber = dataIndex + 2;
  const nameIdx = headerIndex(patientHeaders, "Full_Name");
  const departmentIdx = headerIndex(patientHeaders, "Department");
  const paidIdx = headerIndex(patientHeaders, "Paid");
  const dueIdx = headerIndex(patientHeaders, "Due");
  const totalBillIdx = headerIndex(patientHeaders, "Total_Bill");
  const paymentStatusIdx = headerIndex(patientHeaders, "Payment_Status");
  const updatedIdx = headerIndex(patientHeaders, "Last_Updated");
  const advanceIdx = headerIndex(patientHeaders, "Advance_Balance");
  const actualDepartment = at(patientRow, departmentIdx);
  if (actualDepartment !== department) throw new Error("DEPARTMENT_MISMATCH");

  const currentPaid = money(at(patientRow, paidIdx));
  const currentDue = Math.max(0, money(at(patientRow, dueIdx)));
  const totalBill = Math.max(0, money(at(patientRow, totalBillIdx)));
  const currentAdvance = Math.max(0, money(at(patientRow, advanceIdx)));
  const discountedDue = Math.max(0, currentDue - discount);
  const newDue = Math.max(0, discountedDue - amount);
  const newPaid = currentPaid + amount;
  const overpayment = currentDue > 0 ? Math.max(0, amount - discountedDue) : 0;
  const newAdvance = currentAdvance + overpayment;
  const paymentStatus = newDue <= 0 ? "Paid" : "Due";
  const now = dhakaClockParts();

  const existingReceipts = new Set(
    paymentRows.slice(1).map((row) => at(row, receiptIdx)).filter(Boolean)
  );
  const receiptNo = nextReceiptId(existingReceipts);
  const dateIdx = headerIndex(paymentHeaders, "Date");
  const slIdx = headerIndex(paymentHeaders, "SL");
  const dailySl =
    paymentRows
      .slice(1)
      .filter((row) => at(row, dateIdx) === now.date)
      .reduce((max, row) => Math.max(max, money(at(row, slIdx))), 0) + 1;
  const remarks = [
    normalize(input.remarks),
    sessions > 0 ? `Sessions: ${sessions}` : "",
    marker,
  ]
    .filter(Boolean)
    .join(" | ");

  const recordId = `${clinicId}:${receiptNo}`;
  const paymentRow = rowForHeaders(paymentHeaders, {
    Receipt_No: receiptNo,
    Date: now.date,
    SL: dailySl,
    Patient_ID: patientId,
    Patient_Name: at(patientRow, nameIdx),
    Department: department,
    Amount: amount,
    Discount: discount,
    Due: newDue,
    Payment_Method: method,
    Received_By: context.staffId,
    Remarks: remarks,
    Time: now.time,
    Session_Type: normalize(input.sessionType),
    Organization_ID: organizationId,
    Clinic_ID: clinicId,
    Branch_ID: RELIFE_SYSTEM.branchId,
    Record_ID: recordId,
    Provider_ID: context.staffId,
    Source_System: RELIFE_SYSTEM.sourceSystem,
    Source_Type: RELIFE_SYSTEM.sourceType,
    AI_Generated: false,
    Human_Verified: true,
    Schema_Version: RELIFE_SYSTEM.schemaVersion,
    Provenance_Timestamp: now.provenance,
  });
  const auditRow = rowForHeaders(auditHeaders, {
    Audit_ID: `AUD-${randomUUID()}`,
    Timestamp: now.timestamp,
    Actor_ID: context.staffId,
    Action: "PAYMENT_CREATED",
    Entity_Type: "Payment",
    Entity_ID: receiptNo,
    Patient_ID: patientId,
    Before_Value: "",
    After_Value: JSON.stringify({
      amount,
      discount,
      due: newDue,
      paymentMethod: method,
    }),
    Reason: "Finance domain action",
    Organization_ID: organizationId,
    Clinic_ID: clinicId,
    Branch_ID: RELIFE_SYSTEM.branchId,
    Record_ID: recordId,
    Encounter_ID: "",
    Provider_ID: context.staffId,
    Source_System: RELIFE_SYSTEM.sourceSystem,
    Source_Type: RELIFE_SYSTEM.sourceType,
    AI_Generated: false,
    Human_Verified: true,
    Schema_Version: RELIFE_SYSTEM.schemaVersion,
    Provenance_Timestamp: now.provenance,
    Department: department,
  });

  const requests: SpreadsheetBatchRequest[] = [
    updateCellRequest(patientSheetId, rowNumber, paidIdx + 1, newPaid),
    updateCellRequest(patientSheetId, rowNumber, dueIdx + 1, newDue),
    updateCellRequest(patientSheetId, rowNumber, paymentStatusIdx + 1, paymentStatus),
    updateCellRequest(patientSheetId, rowNumber, updatedIdx + 1, now.timestamp),
  ];
  if (advanceIdx >= 0 && totalBill > 0) {
    requests.push(updateCellRequest(patientSheetId, rowNumber, advanceIdx + 1, newAdvance));
  }
  requests.push(appendRowRequest(paymentSheetId, paymentRow));
  requests.push(appendRowRequest(auditSheetId, auditRow));

  await batchUpdateSpreadsheet(workbook, requests);
  return { receiptNo, due: newDue, duplicate: false };
}
