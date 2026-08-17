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
  batchUpdateSpreadsheet,
  fetchSheetRanges,
  getSheetProperties,
  type SpreadsheetBatchRequest,
  type Workbook,
} from "@/lib/data/googleSheets";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";

export type ClinicDepartment = "Physio" | "Dental";
export type ExpenseType = "Clinic Expense" | "Household Withdrawal";
export type ExpensePaidFrom = "Reception" | "Home Treasury" | "Bank";
export type ExpenseDecision = "approve" | "reject";
type SheetValue = string | number | boolean;

export interface ExpenseRequestInput {
  department: ClinicDepartment;
  category: string;
  amount: number;
  note?: string;
  expenseType?: ExpenseType;
  requestId: string;
}

export interface ExpensePayInput {
  department: ClinicDepartment;
  expenseId: string;
  paidFrom: ExpensePaidFrom;
}

export interface PendingExpense {
  workbook: Workbook;
  id: string;
  date: string;
  category: string;
  amount: number;
  requestedBy: string;
  paidFrom: string;
  note: string;
  department: string;
}

const PENDING_STATUSES = new Set(["pending", "pending approval", "requested"]);

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

function nextEntityId(prefix: string, existing: Set<string>): string {
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

async function expenseSheetId(workbook: Workbook): Promise<number> {
  const properties = await getSheetProperties(workbook);
  const sheet = properties.find((item) => item.title === "07_Expenses");
  if (!sheet) throw new Error("SCHEMA_MISMATCH");
  return sheet.sheetId;
}

function buildExpenseAuditRow(
  headers: string[],
  input: {
    now: ReturnType<typeof dhakaClockParts>;
    actorId: string;
    action: string;
    expenseId: string;
    department: ClinicDepartment;
    beforeValue?: string;
    afterValue?: string;
    reason?: string;
  }
): SheetValue[] {
  const clinic = ledgerClinicId(input.department);
  return rowForHeaders(headers, {
    Audit_ID: `AUD-${randomUUID()}`,
    Timestamp: input.now.timestamp,
    Actor_ID: input.actorId,
    Action: input.action,
    Entity_Type: "Expense",
    Entity_ID: input.expenseId,
    Patient_ID: "",
    Before_Value: input.beforeValue || "",
    After_Value: input.afterValue || "",
    Reason: input.reason || "Finance domain action",
    Organization_ID: RELIFE_SYSTEM.organizationId,
    Clinic_ID: clinic,
    Branch_ID: RELIFE_SYSTEM.branchId,
    Record_ID: relifeRecordId(input.department, input.expenseId),
    Encounter_ID: "",
    Provider_ID: input.actorId,
    Source_System: RELIFE_SYSTEM.sourceSystem,
    Source_Type: RELIFE_SYSTEM.sourceType,
    AI_Generated: false,
    Human_Verified: true,
    Schema_Version: RELIFE_SYSTEM.schemaVersion,
    Provenance_Timestamp: input.now.provenance,
    Department: input.department,
  });
}

export async function requestExpense(
  context: AccessContext,
  input: ExpenseRequestInput
): Promise<{ expenseId: string; duplicate: boolean }> {
  const department = input.department;
  if (department !== "Physio" && department !== "Dental") {
    throw new Error("INVALID_DEPARTMENT");
  }
  assertCanPerform(context, "expense.request", department);

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
  const ids = await sheetIds(workbook);
  const expenseSheetIdVal = requireSheetId(ids, "07_Expenses");
  const auditSheetIdVal = requireSheetId(ids, "20_Data_Audit");

  const [expenseSnapshot, auditSnapshot] = await Promise.all([
    fetchSheetRanges(workbook, ["07_Expenses"]),
    fetchSheetRanges(workbook, ["20_Data_Audit"]),
  ]);
  const expenseRows = expenseSnapshot["07_Expenses"] || [];
  const auditRows = auditSnapshot["20_Data_Audit"] || [];
  if (expenseRows.length < 1 || auditRows.length < 1) throw new Error("SCHEMA_MISMATCH");

  const headers = expenseRows[0];
  const auditHeaders = auditRows[0];
  ensureHeaders(headers, [
    "Expense_ID",
    "Date",
    "Category",
    "Amount",
    "Status",
    "Requested_By",
    "Department",
    "Note",
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

  const noteIdx = headerIndex(headers, "Note");
  const idIdx = headerIndex(headers, "Expense_ID");
  const existing = expenseRows.slice(1).find((row) => at(row, noteIdx).includes(marker));
  if (existing) return { expenseId: at(existing, idIdx), duplicate: true };

  const existingIds = new Set(expenseRows.slice(1).map((row) => at(row, idIdx)).filter(Boolean));
  const expenseId = nextEntityId("EX", existingIds);
  const now = dhakaClockParts();
  const note = [normalize(input.note), marker].filter(Boolean).join(" | ");
  const row = rowForHeaders(headers, {
    Expense_ID: expenseId,
    Date: now.date,
    Category: category,
    Amount: amount,
    Added_By: context.staffId,
    Timestamp: now.timestamp,
    Note: note,
    Organization_ID: RELIFE_SYSTEM.organizationId,
    Clinic_ID: ledgerClinicId(department),
    Branch_ID: RELIFE_SYSTEM.branchId,
    Record_ID: relifeRecordId(department, expenseId),
    Provider_ID: context.staffId,
    Source_System: RELIFE_SYSTEM.sourceSystem,
    Source_Type: RELIFE_SYSTEM.sourceType,
    AI_Generated: false,
    Human_Verified: true,
    Schema_Version: RELIFE_SYSTEM.schemaVersion,
    Provenance_Timestamp: now.provenance,
    Type: expenseType,
    Status: "Pending",
    Requested_By: context.staffId,
    Department: department,
  });

  const auditRow = buildExpenseAuditRow(auditHeaders, {
    now,
    actorId: context.staffId,
    action: "EXPENSE_REQUESTED",
    expenseId,
    department,
    afterValue: JSON.stringify({ category, amount, expenseType }),
  });

  const requests: SpreadsheetBatchRequest[] = [
    appendRowRequest(expenseSheetIdVal, row),
    appendRowRequest(auditSheetIdVal, auditRow),
  ];
  await batchUpdateSpreadsheet(workbook, requests);
  return { expenseId, duplicate: false };
}

export async function listPendingExpenses(): Promise<PendingExpense[]> {
  const [physio, dental] = await Promise.all([
    fetchSheetRanges("physio", ["07_Expenses"]),
    fetchSheetRanges("dental", ["07_Expenses"]),
  ]);

  const parse = (workbook: Workbook, rows: string[][]): PendingExpense[] => {
    if (rows.length < 2) return [];
    const headers = rows[0];
    const idIdx = headerIndex(headers, "Expense_ID");
    const dateIdx = headerIndex(headers, "Date");
    const categoryIdx = headerIndex(headers, "Category");
    const amountIdx = headerIndex(headers, "Amount");
    const requestedByIdx = headerIndex(headers, "Requested_By", "Added_By");
    const paidFromIdx = headerIndex(headers, "Paid_From");
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
        category: at(row, categoryIdx),
        amount: money(at(row, amountIdx)),
        requestedBy: at(row, requestedByIdx),
        paidFrom: at(row, paidFromIdx),
        note: at(row, noteIdx),
        department: at(row, departmentIdx) || departmentForWorkbook(workbook),
      }];
    });
  };

  return [
    ...parse("physio", physio["07_Expenses"] || []),
    ...parse("dental", dental["07_Expenses"] || []),
  ];
}

export async function decideExpense(input: {
  workbook: Workbook;
  expenseId: string;
  decision: ExpenseDecision;
  actorId: string;
  reason?: string;
}): Promise<void> {
  const { workbook, expenseId, decision } = input;
  if (workbook !== "physio" && workbook !== "dental") throw new Error("INVALID_WORKBOOK");
  if (decision !== "approve" && decision !== "reject") throw new Error("INVALID_DECISION");
  const reason = normalize(input.reason);
  if (decision === "reject" && reason.length < 3) throw new Error("REJECTION_REASON_REQUIRED");

  const ids = await sheetIds(workbook);
  const expenseSheetIdVal = requireSheetId(ids, "07_Expenses");
  const auditSheetIdVal = requireSheetId(ids, "20_Data_Audit");

  const [expenseSnapshot, auditSnapshot] = await Promise.all([
    fetchSheetRanges(workbook, ["07_Expenses"]),
    fetchSheetRanges(workbook, ["20_Data_Audit"]),
  ]);
  const expenseRows = expenseSnapshot["07_Expenses"] || [];
  const auditRows = auditSnapshot["20_Data_Audit"] || [];
  if (expenseRows.length < 2 || auditRows.length < 1) throw new Error("CONTROL_NOT_FOUND");

  const headers = expenseRows[0];
  const auditHeaders = auditRows[0];
  ensureHeaders(headers, ["Expense_ID", "Status", "Requested_By", "Approved_By", "Approved_At", "Department"]);
  ensureHeaders(auditHeaders, [
    "Audit_ID", "Timestamp", "Actor_ID", "Action", "Entity_Type", "Entity_ID", "Patient_ID",
    "Before_Value", "After_Value", "Reason", "Organization_ID", "Clinic_ID", "Branch_ID",
    "Record_ID", "Encounter_ID", "Provider_ID", "Source_System", "Source_Type", "AI_Generated",
    "Human_Verified", "Schema_Version", "Provenance_Timestamp", "Department",
  ]);

  const idIdx = headerIndex(headers, "Expense_ID");
  const statusIdx = headerIndex(headers, "Status");
  const requestedByIdx = headerIndex(headers, "Requested_By", "Added_By");
  const approvedByIdx = headerIndex(headers, "Approved_By");
  const approvedAtIdx = headerIndex(headers, "Approved_At");
  const departmentIdx = headerIndex(headers, "Department");

  const dataIndex = expenseRows.slice(1).findIndex((row) => at(row, idIdx) === normalize(expenseId));
  if (dataIndex < 0) throw new Error("CONTROL_NOT_FOUND");
  const row = expenseRows[dataIndex + 1];
  const currentStatus = at(row, statusIdx);
  if (!PENDING_STATUSES.has(normalized(currentStatus))) throw new Error("CONTROL_ALREADY_DECIDED");

  const rowNumber = dataIndex + 2;
  const nextStatus = decision === "approve" ? "Approved" : "Rejected";
  const now = dhakaClockParts();

  const departmentRaw = at(row, departmentIdx);
  const department: ClinicDepartment =
    departmentRaw === "Dental" || departmentRaw === "Physio"
      ? departmentRaw
      : departmentForWorkbook(workbook);

  const auditRow = buildExpenseAuditRow(auditHeaders, {
    now,
    actorId: input.actorId,
    action: decision === "approve" ? "EXPENSE_APPROVED" : "EXPENSE_REJECTED",
    expenseId,
    department,
    beforeValue: currentStatus,
    afterValue: nextStatus,
    reason: decision === "reject" ? reason : undefined,
  });

  const requests: SpreadsheetBatchRequest[] = [
    updateCellRequest(expenseSheetIdVal, rowNumber, statusIdx + 1, nextStatus),
    updateCellRequest(expenseSheetIdVal, rowNumber, requestedByIdx + 1, at(row, requestedByIdx)),
    updateCellRequest(expenseSheetIdVal, rowNumber, approvedByIdx + 1, input.actorId),
    updateCellRequest(expenseSheetIdVal, rowNumber, approvedAtIdx + 1, now.timestamp),
    appendRowRequest(auditSheetIdVal, auditRow),
  ];
  await batchUpdateSpreadsheet(workbook, requests);
}

export async function payApprovedExpense(
  context: AccessContext,
  input: ExpensePayInput
): Promise<{ alreadyPaid: boolean }> {
  const department = input.department;
  if (department !== "Physio" && department !== "Dental") throw new Error("INVALID_DEPARTMENT");
  assertCanPerform(context, "expense.pay", department);
  if (!["Reception", "Home Treasury", "Bank"].includes(input.paidFrom)) {
    throw new Error("INVALID_CUSTODIAN");
  }
  if (!context.roles.includes("Owner") && input.paidFrom !== "Reception") {
    throw new Error("ACCESS_DENIED");
  }

  const workbook = workbookForDepartment(department);
  const ids = await sheetIds(workbook);
  const expenseSheetIdVal = requireSheetId(ids, "07_Expenses");
  const auditSheetIdVal = requireSheetId(ids, "20_Data_Audit");

  const [expenseSnapshot, auditSnapshot] = await Promise.all([
    fetchSheetRanges(workbook, ["07_Expenses"]),
    fetchSheetRanges(workbook, ["20_Data_Audit"]),
  ]);
  const expenseRows = expenseSnapshot["07_Expenses"] || [];
  const auditRows = auditSnapshot["20_Data_Audit"] || [];
  if (expenseRows.length < 2 || auditRows.length < 1) throw new Error("EXPENSE_NOT_FOUND");

  const headers = expenseRows[0];
  const auditHeaders = auditRows[0];
  ensureHeaders(headers, ["Expense_ID", "Status", "Department", "Paid_From", "Paid_By", "Paid_At"]);
  ensureHeaders(auditHeaders, [
    "Audit_ID", "Timestamp", "Actor_ID", "Action", "Entity_Type", "Entity_ID", "Patient_ID",
    "Before_Value", "After_Value", "Reason", "Organization_ID", "Clinic_ID", "Branch_ID",
    "Record_ID", "Encounter_ID", "Provider_ID", "Source_System", "Source_Type", "AI_Generated",
    "Human_Verified", "Schema_Version", "Provenance_Timestamp", "Department",
  ]);

  const idIdx = headerIndex(headers, "Expense_ID");
  const statusIdx = headerIndex(headers, "Status");
  const departmentIdx = headerIndex(headers, "Department");
  const paidFromIdx = headerIndex(headers, "Paid_From");
  const paidByIdx = headerIndex(headers, "Paid_By");
  const paidAtIdx = headerIndex(headers, "Paid_At");

  const dataIndex = expenseRows.slice(1).findIndex((row) => at(row, idIdx) === normalize(input.expenseId));
  if (dataIndex < 0) throw new Error("EXPENSE_NOT_FOUND");
  const row = expenseRows[dataIndex + 1];
  if (at(row, departmentIdx) !== department) throw new Error("DEPARTMENT_MISMATCH");
  const status = normalized(at(row, statusIdx));
  if (status === "paid") return { alreadyPaid: true };
  if (status !== "approved") throw new Error("EXPENSE_NOT_APPROVED");

  const rowNumber = dataIndex + 2;
  const now = dhakaClockParts();
  const beforeStatus = at(row, statusIdx);

  const auditRow = buildExpenseAuditRow(auditHeaders, {
    now,
    actorId: context.staffId,
    action: "EXPENSE_PAID",
    expenseId: input.expenseId,
    department,
    beforeValue: beforeStatus,
    afterValue: `Paid from ${input.paidFrom}`,
  });

  const requests: SpreadsheetBatchRequest[] = [
    updateCellRequest(expenseSheetIdVal, rowNumber, paidFromIdx + 1, input.paidFrom),
    updateCellRequest(expenseSheetIdVal, rowNumber, statusIdx + 1, "Paid"),
    updateCellRequest(expenseSheetIdVal, rowNumber, paidByIdx + 1, context.staffId),
    updateCellRequest(expenseSheetIdVal, rowNumber, paidAtIdx + 1, now.timestamp),
    appendRowRequest(auditSheetIdVal, auditRow),
  ];
  await batchUpdateSpreadsheet(workbook, requests);
  return { alreadyPaid: false };
}
