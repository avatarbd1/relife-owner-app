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
import { getPayments } from "@/lib/data";
import type { Department, Scope } from "@/lib/types";
import {
  assertCanPerform,
  canPerform,
  type AccessContext,
} from "@/lib/webos/access";
import { getVisiblePatients } from "@/lib/webos/reception";
import { getWebStaffDirectory } from "@/lib/webos/staffDirectory";

type ClinicDepartment = "Physio" | "Dental";
type SheetValue = string | number | boolean;
type PaymentMethod = "Cash" | "bKash" | "Nagad" | "Bank" | "Card";
type PaidFrom = "Reception" | "Home Treasury" | "Bank";

export interface FinancePatientOption {
  patientId: string;
  fullName: string;
  department: ClinicDepartment;
  due: number;
}

export interface FinanceStaffOption {
  staffId: string;
  fullName: string;
  department: Department;
  salary: number;
}

export interface ApprovedExpenseOption {
  id: string;
  department: ClinicDepartment;
  date: string;
  category: string;
  amount: number;
  note: string;
  requestedBy: string;
}

export interface RecentPaymentOption {
  receiptNo: string;
  date: string;
  patientId: string;
  patientName: string;
  department: ClinicDepartment;
  amount: number;
  method: string;
}

export interface FinanceOperationsSnapshot {
  patients: FinancePatientOption[];
  staff: FinanceStaffOption[];
  approvedExpenses: ApprovedExpenseOption[];
  recentPayments: RecentPaymentOption[];
  departments: ClinicDepartment[];
  capabilities: {
    paymentCreate: boolean;
    expenseRequest: boolean;
    expensePay: boolean;
    cashRequest: boolean;
    salaryPay: boolean;
    householdWithdrawal: boolean;
  };
}

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

export interface ExpenseRequestInput {
  department: ClinicDepartment;
  category: string;
  amount: number;
  note?: string;
  expenseType?: "Clinic Expense" | "Household Withdrawal";
  requestId: string;
}

export interface ExpensePayInput {
  department: ClinicDepartment;
  expenseId: string;
  paidFrom: PaidFrom;
}

export interface CashRequestInput {
  department: ClinicDepartment;
  amount: number;
  toCustodian: "Home Treasury" | "Bank";
  note?: string;
  requestId: string;
}

export interface SalaryPayInput {
  staffId: string;
  amount: number;
  paidFrom: PaidFrom;
  note?: string;
  requestId: string;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeLower(value: unknown): string {
  return normalize(value).toLowerCase();
}

function money(value: unknown): number {
  const parsed = Number.parseFloat(normalize(value).replace(/৳|,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function headerIndex(headers: string[], ...names: string[]): number {
  const normalized = headers.map((value) => normalizeLower(value));
  for (const name of names) {
    const index = normalized.indexOf(name.toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
}

function rowForHeaders(
  headers: string[],
  values: Record<string, SheetValue>
): SheetValue[] {
  const map = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value])
  );
  return headers.map((header) => map.get(normalizeLower(header)) ?? "");
}

function ensureHeaders(headers: string[], required: string[]): void {
  const set = new Set(headers.map((value) => normalizeLower(value)));
  if (required.some((value) => !set.has(value.toLowerCase()))) {
    throw new Error("SCHEMA_MISMATCH");
  }
}

function workbookForDepartment(department: ClinicDepartment): Workbook {
  return department === "Dental" ? "dental" : "physio";
}

function departmentFromPatientId(patientId: string): ClinicDepartment {
  const id = normalize(patientId).toUpperCase();
  if (id.startsWith("DT")) return "Dental";
  if (id.startsWith("PT")) return "Physio";
  throw new Error("INVALID_PATIENT_ID");
}

function scopeAllows(scope: Scope, department: ClinicDepartment): boolean {
  if (scope === "combined") return true;
  return scope === "physio" ? department === "Physio" : department === "Dental";
}

function dhakaParts(ref = new Date()): {
  date: string;
  time: string;
  month: string;
  timestamp: string;
  provenance: string;
} {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ref);
  const values = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(ref);
  return {
    date,
    time,
    month: `${values.year}-${values.month}`,
    timestamp: `${date} ${time}`,
    provenance: ref.toISOString(),
  };
}

function validateRequestId(value: string): string {
  const requestId = normalize(value);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) {
    throw new Error("INVALID_REQUEST_ID");
  }
  return requestId;
}

function webId(prefix: string, existing: Set<string>): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = `${prefix}W${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    if (!existing.has(id)) return id;
  }
  throw new Error("ID_ALLOCATION_FAILED");
}

function cellValue(value: SheetValue): Record<string, unknown> {
  if (typeof value === "boolean") return { userEnteredValue: { boolValue: value } };
  if (typeof value === "number") return { userEnteredValue: { numberValue: value } };
  return { userEnteredValue: { stringValue: String(value) } };
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

function appendRowRequest(
  sheetId: number,
  row: SheetValue[]
): SpreadsheetBatchRequest {
  return {
    appendCells: {
      sheetId,
      rows: [{ values: row.map(cellValue) }],
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

function departmentAllowedByContext(
  context: AccessContext,
  department: ClinicDepartment,
  action:
    | "payment.create"
    | "expense.request"
    | "expense.pay"
    | "cash.request"
    | "salary.pay"
): void {
  assertCanPerform(context, action, department);
}

async function appendAudit(
  workbook: Workbook,
  context: AccessContext,
  action: string,
  entityType: string,
  entityId: string,
  department: Department,
  afterValue: string,
  patientId = ""
): Promise<void> {
  const now = dhakaParts();
  try {
    const clinic = department === "Dental" ? "RELIFE-DENTAL" : "RELIFE-PHYSIO";
    await appendSheetValues(workbook, "'20_Data_Audit'!A:W", [
      [
        `AUD-${randomUUID()}`,
        now.timestamp,
        context.staffId,
        action,
        entityType,
        entityId,
        patientId,
        "",
        afterValue,
        "Web OS W3 finance action",
        "RELIFE",
        clinic,
        "AMTALI-01",
        `${clinic}:${entityId}`,
        "",
        context.staffId,
        "web_pwa",
        "human_entry",
        false,
        true,
        "relife-uda-v1",
        now.provenance,
        department,
      ],
    ]);
  } catch (error) {
    console.error("W3 audit append failed:", error);
  }
}

export async function createPayment(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  input: PaymentCreateInput
): Promise<{ receiptNo: string; due: number; duplicate: boolean }> {
  const patientId = normalize(input.patientId).toUpperCase();
  const department = departmentFromPatientId(patientId);
  departmentAllowedByContext(context, department, "payment.create");

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

  const patientIdIdx = headerIndex(patientHeaders, "Patient_ID");
  const dataIndex = patientRows.slice(1).findIndex(
    (row) => at(row, patientIdIdx).toUpperCase() === patientId
  );
  if (dataIndex < 0) throw new Error("PATIENT_NOT_FOUND");
  const row = patientRows[dataIndex + 1];
  const rowNumber = dataIndex + 2;
  const nameIdx = headerIndex(patientHeaders, "Full_Name");
  const deptIdx = headerIndex(patientHeaders, "Department");
  const paidIdx = headerIndex(patientHeaders, "Paid");
  const dueIdx = headerIndex(patientHeaders, "Due");
  const totalBillIdx = headerIndex(patientHeaders, "Total_Bill");
  const paymentStatusIdx = headerIndex(patientHeaders, "Payment_Status");
  const updatedIdx = headerIndex(patientHeaders, "Last_Updated");
  const advanceIdx = headerIndex(patientHeaders, "Advance_Balance");
  const actualDepartment = normalize(at(row, deptIdx)) as ClinicDepartment;
  if (actualDepartment !== department) throw new Error("DEPARTMENT_MISMATCH");

  const currentPaid = money(at(row, paidIdx));
  const currentDue = Math.max(0, money(at(row, dueIdx)));
  const totalBill = Math.max(0, money(at(row, totalBillIdx)));
  const currentAdvance = Math.max(0, money(at(row, advanceIdx)));
  const discountedDue = Math.max(0, currentDue - discount);
  const newDue = Math.max(0, discountedDue - amount);
  const newPaid = currentPaid + amount;
  const overpayment = currentDue > 0 ? Math.max(0, amount - discountedDue) : 0;
  const newAdvance = currentAdvance + overpayment;
  const paymentStatus = newDue <= 0 ? "Paid" : "Due";
  const now = dhakaParts();

  const existingReceipts = new Set(
    paymentRows.slice(1).map((paymentRow) => at(paymentRow, receiptIdx)).filter(Boolean)
  );
  const receiptNo = webId("RC", existingReceipts);
  const dateIdx = headerIndex(paymentHeaders, "Date");
  const slIdx = headerIndex(paymentHeaders, "SL");
  const dailySl =
    paymentRows
      .slice(1)
      .filter((paymentRow) => at(paymentRow, dateIdx) === now.date)
      .reduce((max, paymentRow) => Math.max(max, money(at(paymentRow, slIdx))), 0) + 1;
  const remarks = [
    normalize(input.remarks),
    sessions > 0 ? `Sessions: ${sessions}` : "",
    marker,
  ]
    .filter(Boolean)
    .join(" | ");

  const paymentRow = rowForHeaders(paymentHeaders, {
    Receipt_No: receiptNo,
    Date: now.date,
    SL: dailySl,
    Patient_ID: patientId,
    Patient_Name: at(row, nameIdx),
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
    Branch_ID: "AMTALI-01",
    Record_ID: `${clinicId}:${receiptNo}`,
    Provider_ID: context.staffId,
    Source_System: "web_pwa",
    Source_Type: "human_entry",
    AI_Generated: false,
    Human_Verified: true,
    Schema_Version: "relife-uda-v1",
    Provenance_Timestamp: now.provenance,
  });

  const ids = await sheetIds(workbook);
  const patientSheetId = requireSheetId(ids, "02_Patients");
  const paymentSheetId = requireSheetId(ids, "06_Payments");
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
  await batchUpdateSpreadsheet(workbook, requests);

  await appendAudit(
    workbook,
    context,
    "PAYMENT_CREATED",
    "Payment",
    receiptNo,
    department,
    JSON.stringify({ amount, discount, due: newDue, paymentMethod: method }),
    patientId
  );
  return { receiptNo, due: newDue, duplicate: false };
}

export async function requestExpense(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  input: ExpenseRequestInput
): Promise<{ expenseId: string; duplicate: boolean }> {
  const department = input.department;
  if (!["Physio", "Dental"].includes(department)) throw new Error("INVALID_DEPARTMENT");
  departmentAllowedByContext(context, department, "expense.request");
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("INVALID_AMOUNT");
  const category = normalize(input.category);
  if (!category) throw new Error("INVALID_CATEGORY");
  const expenseType = input.expenseType || "Clinic Expense";
  if (expenseType === "Household Withdrawal" && !context.roles.includes("Owner")) {
    throw new Error("ACCESS_DENIED");
  }
  const requestId = validateRequestId(input.requestId);
  const marker = `WEBREQ:${requestId}`;
  const workbook = workbookForDepartment(department);
  const snapshot = await fetchSheetRanges(workbook, ["07_Expenses"]);
  const rows = snapshot["07_Expenses"] || [];
  if (rows.length < 1) throw new Error("SCHEMA_MISMATCH");
  const headers = rows[0];
  ensureHeaders(headers, ["Expense_ID", "Date", "Category", "Amount", "Status", "Department"]);
  const noteIdx = headerIndex(headers, "Note");
  const idIdx = headerIndex(headers, "Expense_ID");
  const existing = rows.slice(1).find((row) => at(row, noteIdx).includes(marker));
  if (existing) return { expenseId: at(existing, idIdx), duplicate: true };

  const existingIds = new Set(rows.slice(1).map((row) => at(row, idIdx)).filter(Boolean));
  const expenseId = webId("EX", existingIds);
  const now = dhakaParts();
  const note = [normalize(input.note), marker].filter(Boolean).join(" | ");
  const newRow = rowForHeaders(headers, {
    Expense_ID: expenseId,
    Date: now.date,
    Category: category,
    Amount: amount,
    Added_By: context.staffId,
    Timestamp: now.timestamp,
    Note: note,
    Organization_ID: organizationId,
    Clinic_ID: clinicId,
    Branch_ID: "AMTALI-01",
    Record_ID: `${clinicId}:${expenseId}`,
    Provider_ID: context.staffId,
    Source_System: "web_pwa",
    Source_Type: "human_entry",
    AI_Generated: false,
    Human_Verified: true,
    Schema_Version: "relife-uda-v1",
    Provenance_Timestamp: now.provenance,
    Type: expenseType,
    Status: "Pending",
    Requested_By: context.staffId,
    Department: department,
  });
  await appendSheetValues(workbook, "'07_Expenses'!A:AB", [newRow]);
  await appendAudit(
    workbook,
    context,
    "EXPENSE_REQUESTED",
    "Expense",
    expenseId,
    department,
    JSON.stringify({ category, amount, expenseType })
  );
  return { expenseId, duplicate: false };
}

export async function payApprovedExpense(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  input: ExpensePayInput
): Promise<{ alreadyPaid: boolean }> {
  const department = input.department;
  departmentAllowedByContext(context, department, "expense.pay");
  if (!["Reception", "Home Treasury", "Bank"].includes(input.paidFrom)) {
    throw new Error("INVALID_CUSTODIAN");
  }
  if (!context.roles.includes("Owner") && input.paidFrom !== "Reception") {
    throw new Error("ACCESS_DENIED");
  }
  const workbook = workbookForDepartment(department);
  const snapshot = await fetchSheetRanges(workbook, ["07_Expenses"]);
  const rows = snapshot["07_Expenses"] || [];
  if (rows.length < 2) throw new Error("EXPENSE_NOT_FOUND");
  const headers = rows[0];
  const idIdx = headerIndex(headers, "Expense_ID");
  const statusIdx = headerIndex(headers, "Status");
  const deptIdx = headerIndex(headers, "Department");
  const paidFromIdx = headerIndex(headers, "Paid_From");
  const paidByIdx = headerIndex(headers, "Paid_By");
  const paidAtIdx = headerIndex(headers, "Paid_At");
  if ([idIdx, statusIdx, deptIdx, paidFromIdx, paidByIdx, paidAtIdx].some((idx) => idx < 0)) {
    throw new Error("SCHEMA_MISMATCH");
  }
  const dataIndex = rows.slice(1).findIndex((row) => at(row, idIdx) === normalize(input.expenseId));
  if (dataIndex < 0) throw new Error("EXPENSE_NOT_FOUND");
  const row = rows[dataIndex + 1];
  if (at(row, deptIdx) !== department) throw new Error("DEPARTMENT_MISMATCH");
  const status = normalizeLower(at(row, statusIdx));
  if (status === "paid") return { alreadyPaid: true };
  if (status !== "approved") throw new Error("EXPENSE_NOT_APPROVED");

  const ids = await sheetIds(workbook);
  const expenseSheetId = requireSheetId(ids, "07_Expenses");
  const rowNumber = dataIndex + 2;
  const now = dhakaParts();
  await batchUpdateSpreadsheet(workbook, [
    updateCellRequest(expenseSheetId, rowNumber, paidFromIdx + 1, input.paidFrom),
    updateCellRequest(expenseSheetId, rowNumber, statusIdx + 1, "Paid"),
    updateCellRequest(expenseSheetId, rowNumber, paidByIdx + 1, context.staffId),
    updateCellRequest(expenseSheetId, rowNumber, paidAtIdx + 1, now.timestamp),
  ]);
  await appendAudit(
    workbook,
    context,
    "EXPENSE_PAID",
    "Expense",
    normalize(input.expenseId),
    department,
    JSON.stringify({ paidFrom: input.paidFrom })
  );
  return { alreadyPaid: false };
}

export async function requestCashMovement(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  input: CashRequestInput
): Promise<{ movementId: string; duplicate: boolean }> {
  const department = input.department;
  departmentAllowedByContext(context, department, "cash.request");
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("INVALID_AMOUNT");
  if (!["Home Treasury", "Bank"].includes(input.toCustodian)) {
    throw new Error("INVALID_CUSTODIAN");
  }
  const requestId = validateRequestId(input.requestId);
  const marker = `WEBREQ:${requestId}`;
  const workbook = workbookForDepartment(department);
  const snapshot = await fetchSheetRanges(workbook, ["21_Cash_Movement"]);
  const rows = snapshot["21_Cash_Movement"] || [];
  if (rows.length < 1) throw new Error("SCHEMA_MISMATCH");
  const headers = rows[0];
  ensureHeaders(headers, ["Movement_ID", "Date", "From_Custodian", "To_Custodian", "Amount", "Status", "Department"]);
  const noteIdx = headerIndex(headers, "Note");
  const idIdx = headerIndex(headers, "Movement_ID");
  const existing = rows.slice(1).find((row) => at(row, noteIdx).includes(marker));
  if (existing) return { movementId: at(existing, idIdx), duplicate: true };

  const existingIds = new Set(rows.slice(1).map((row) => at(row, idIdx)).filter(Boolean));
  const movementId = webId("CM", existingIds);
  const now = dhakaParts();
  const note = [normalize(input.note), marker].filter(Boolean).join(" | ");
  const newRow = rowForHeaders(headers, {
    Movement_ID: movementId,
    Date: now.date,
    From_Custodian: "Reception",
    To_Custodian: input.toCustodian,
    Amount: amount,
    Moved_By: context.staffId,
    Note: note,
    Timestamp: now.timestamp,
    Organization_ID: organizationId,
    Clinic_ID: clinicId,
    Branch_ID: "AMTALI-01",
    Record_ID: `${clinicId}:${movementId}`,
    Provider_ID: context.staffId,
    Source_System: "web_pwa",
    Source_Type: "human_entry",
    AI_Generated: false,
    Human_Verified: true,
    Schema_Version: "relife-uda-v1",
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
  await appendSheetValues(workbook, "'21_Cash_Movement'!A:AI", [newRow]);
  await appendAudit(
    workbook,
    context,
    "CASH_MOVEMENT_REQUESTED",
    "CashMovement",
    movementId,
    department,
    JSON.stringify({ from: "Reception", to: input.toCustodian, amount })
  );
  return { movementId, duplicate: false };
}

export async function paySalary(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  input: SalaryPayInput
): Promise<{ paymentId: string; duplicate: boolean }> {
  if (!context.roles.includes("Owner")) throw new Error("ACCESS_DENIED");
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("INVALID_AMOUNT");
  if (!["Reception", "Home Treasury", "Bank"].includes(input.paidFrom)) {
    throw new Error("INVALID_CUSTODIAN");
  }
  const requestId = validateRequestId(input.requestId);
  const directory = await getWebStaffDirectory();
  const staff = directory.find(
    (item) => item.staffId === normalize(input.staffId) && item.status === "Active"
  );
  if (!staff || !staff.primaryDepartment) throw new Error("STAFF_NOT_FOUND");
  const department: Department = staff.primaryDepartment;
  const authorizationDepartment: ClinicDepartment =
    department === "Dental" ? "Dental" : "Physio";
  departmentAllowedByContext(context, authorizationDepartment, "salary.pay");
  const workbook: Workbook = department === "Dental" ? "dental" : "physio";
  const snapshot = await fetchSheetRanges(workbook, ["13_Salary"]);
  const rows = snapshot["13_Salary"] || [];
  if (rows.length < 1) throw new Error("SCHEMA_MISMATCH");
  const headers = rows[0];
  ensureHeaders(headers, ["Payment_ID", "Date", "Month", "Staff_ID", "Amount", "Department", "Paid_From", "Status"]);
  const noteIdx = headerIndex(headers, "Note");
  const idIdx = headerIndex(headers, "Payment_ID");
  const marker = `WEBREQ:${requestId}`;
  const existing = rows.slice(1).find((row) => at(row, noteIdx).includes(marker));
  if (existing) return { paymentId: at(existing, idIdx), duplicate: true };

  const existingIds = new Set(rows.slice(1).map((row) => at(row, idIdx)).filter(Boolean));
  const paymentId = webId("SP", existingIds);
  const now = dhakaParts();
  const note = [normalize(input.note), marker].filter(Boolean).join(" | ");
  const newRow = rowForHeaders(headers, {
    Payment_ID: paymentId,
    Date: now.date,
    Month: now.month,
    Staff_ID: staff.staffId,
    Amount: amount,
    Paid_By: context.staffId,
    Timestamp: now.timestamp,
    Note: note,
    Organization_ID: organizationId,
    Clinic_ID: clinicId,
    Branch_ID: "AMTALI-01",
    Record_ID: `${clinicId}:${paymentId}`,
    Provider_ID: context.staffId,
    Source_System: "web_pwa",
    Source_Type: "human_entry",
    AI_Generated: false,
    Human_Verified: true,
    Schema_Version: "relife-uda-v1",
    Provenance_Timestamp: now.provenance,
    Department: department,
    Paid_From: input.paidFrom,
    Status: "Paid",
    Paid_At: now.timestamp,
  });
  await appendSheetValues(workbook, "'13_Salary'!A:AC", [newRow]);
  await appendAudit(
    workbook,
    context,
    "SALARY_PAID",
    "SalaryPayment",
    paymentId,
    department,
    JSON.stringify({ staffId: staff.staffId, amount, paidFrom: input.paidFrom })
  );
  return { paymentId, duplicate: false };
}

function parseApprovedExpenses(
  rows: string[][],
  fallback: ClinicDepartment
): ApprovedExpenseOption[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idIdx = headerIndex(headers, "Expense_ID");
  const dateIdx = headerIndex(headers, "Date");
  const categoryIdx = headerIndex(headers, "Category");
  const amountIdx = headerIndex(headers, "Amount");
  const noteIdx = headerIndex(headers, "Note");
  const requestedIdx = headerIndex(headers, "Requested_By", "Added_By");
  const statusIdx = headerIndex(headers, "Status");
  const departmentIdx = headerIndex(headers, "Department");
  return rows.slice(1).flatMap((row) => {
    if (normalizeLower(at(row, statusIdx)) !== "approved") return [];
    const department = (at(row, departmentIdx) || fallback) as ClinicDepartment;
    if (department !== "Physio" && department !== "Dental") return [];
    return [{
      id: at(row, idIdx),
      department,
      date: at(row, dateIdx),
      category: at(row, categoryIdx),
      amount: money(at(row, amountIdx)),
      note: at(row, noteIdx),
      requestedBy: at(row, requestedIdx),
    }];
  });
}

export async function getFinanceOperationsSnapshot(
  context: AccessContext,
  scope: Scope
): Promise<FinanceOperationsSnapshot> {
  const allowedDepartments = (["Physio", "Dental"] as ClinicDepartment[]).filter(
    (department) =>
      scopeAllows(scope, department) &&
      (canPerform(context, "payment.create", department) ||
        canPerform(context, "expense.request", department) ||
        canPerform(context, "cash.request", department) ||
        canPerform(context, "salary.pay", department))
  );

  const [visiblePatients, directory, payments, physio, dental] = await Promise.all([
    getVisiblePatients(context, scope),
    getWebStaffDirectory(),
    getPayments(),
    allowedDepartments.includes("Physio")
      ? fetchSheetRanges("physio", ["07_Expenses"])
      : Promise.resolve({ "07_Expenses": [] as string[][] }),
    allowedDepartments.includes("Dental")
      ? fetchSheetRanges("dental", ["07_Expenses"])
      : Promise.resolve({ "07_Expenses": [] as string[][] }),
  ]);

  const patients = visiblePatients.flatMap((patient) => {
    if (patient.department !== "Physio" && patient.department !== "Dental") return [];
    if (!canPerform(context, "payment.create", patient.department)) return [];
    return [{
      patientId: patient.patientId,
      fullName: patient.fullName,
      department: patient.department,
      due: patient.due,
    }];
  });

  const staff = directory.flatMap((item) => {
    if (item.status !== "Active" || !item.primaryDepartment) return [];
    const dept = item.primaryDepartment;
    if (dept !== "All" && !scopeAllows(scope, dept)) return [];
    return [{
      staffId: item.staffId,
      fullName: item.fullName,
      department: dept,
      salary: 0,
    }];
  });

  // Salary master values live in 08_Staff. The finance page remains the
  // authoritative place for commitment totals; the W3 form only needs staff IDs.
  const approvedExpenses = [
    ...parseApprovedExpenses(physio["07_Expenses"] || [], "Physio"),
    ...parseApprovedExpenses(dental["07_Expenses"] || [], "Dental"),
  ].filter(
    (expense) =>
      scopeAllows(scope, expense.department) &&
      canPerform(context, "expense.pay", expense.department)
  );

  const recentPayments = payments
    .flatMap((payment) => {
      if (payment.department !== "Physio" && payment.department !== "Dental") return [];
      if (!scopeAllows(scope, payment.department)) return [];
      if (!canPerform(context, "payment.read_amount", payment.department)) return [];
      return [{
        receiptNo: payment.receiptNo,
        date: payment.date,
        patientId: payment.patientId,
        patientName: payment.patientName,
        department: payment.department,
        amount: payment.amount,
        method: payment.paymentMethod,
      }];
    })
    .slice(-12)
    .reverse();

  const any = (
    action: "payment.create" | "expense.request" | "expense.pay" | "cash.request" | "salary.pay"
  ) => allowedDepartments.some((department) => canPerform(context, action, department));

  return {
    patients,
    staff,
    approvedExpenses,
    recentPayments,
    departments: allowedDepartments,
    capabilities: {
      paymentCreate: any("payment.create"),
      expenseRequest: any("expense.request"),
      expensePay: any("expense.pay"),
      cashRequest: any("cash.request"),
      salaryPay: any("salary.pay"),
      householdWithdrawal: context.roles.includes("Owner"),
    },
  };
}
