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
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";

type ClinicDepartment = "Physio" | "Dental";
type SheetValue = string | number | boolean;

export interface ExpenseRequestInput {
  department: ClinicDepartment;
  category: string;
  amount: number;
  note?: string;
  expenseType?: "Clinic Expense" | "Household Withdrawal";
  requestId: string;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeLower(value: unknown): string {
  return normalize(value).toLowerCase();
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

function clinicId(department: ClinicDepartment): string {
  return department === "Dental" ? "RELIFE-DENTAL" : "RELIFE-PHYSIO";
}

function dhakaParts(ref = new Date()): {
  date: string;
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

async function expenseSheetId(workbook: Workbook): Promise<number> {
  const properties = await getSheetProperties(workbook);
  const sheet = properties.find((item) => item.title === "07_Expenses");
  if (!sheet) throw new Error("SCHEMA_MISMATCH");
  return sheet.sheetId;
}

async function appendAudit(
  workbook: Workbook,
  context: AccessContext,
  expenseId: string,
  department: ClinicDepartment,
  category: string,
  amount: number,
  expenseType: string
): Promise<void> {
  const now = dhakaParts();
  const clinic = clinicId(department);
  try {
    await appendSheetValues(workbook, "'20_Data_Audit'!A:W", [
      [
        `AUD-${randomUUID()}`,
        now.timestamp,
        context.staffId,
        "EXPENSE_REQUESTED",
        "Expense",
        expenseId,
        "",
        "",
        JSON.stringify({ category, amount, expenseType }),
        "Web OS W3 finance action",
        "RELIFE",
        clinic,
        "AMTALI-01",
        `${clinic}:${expenseId}`,
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

export async function requestExpense(
  context: AccessContext,
  input: ExpenseRequestInput
): Promise<{ expenseId: string; duplicate: boolean }> {
  const department = input.department;
  if (!["Physio", "Dental"].includes(department)) {
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
  const snapshot = await fetchSheetRanges(workbook, ["07_Expenses"]);
  const rows = snapshot["07_Expenses"] || [];
  if (rows.length < 1) throw new Error("SCHEMA_MISMATCH");

  const headers = rows[0];
  ensureHeaders(headers, [
    "Expense_ID",
    "Date",
    "Category",
    "Amount",
    "Status",
    "Requested_By",
    "Department",
  ]);
  const noteIdx = headerIndex(headers, "Note");
  const idIdx = headerIndex(headers, "Expense_ID");
  if (noteIdx < 0 || idIdx < 0) throw new Error("SCHEMA_MISMATCH");

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
    Organization_ID: "RELIFE",
    Clinic_ID: clinicId(department),
    Branch_ID: "AMTALI-01",
    Record_ID: `${clinicId(department)}:${expenseId}`,
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

  const sheetId = await expenseSheetId(workbook);
  await batchUpdateSpreadsheet(workbook, [appendRowRequest(sheetId, newRow)]);
  await appendAudit(
    workbook,
    context,
    expenseId,
    department,
    category,
    amount,
    expenseType
  );
  return { expenseId, duplicate: false };
}
