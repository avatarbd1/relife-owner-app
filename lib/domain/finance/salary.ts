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
import { getWebStaffDirectory } from "@/lib/webos/staffDirectory";
import type { ClinicDepartment, ExpensePaidFrom } from "@/lib/domain/finance/expenses";

type SheetValue = string | number | boolean;

export interface SalaryPayInput {
  staffId: string;
  amount: number;
  paidFrom: ExpensePaidFrom;
  note?: string;
  requestId: string;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase();
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

function clinicId(department: ClinicDepartment): string {
  return department === "Dental" ? "RELIFE-DENTAL" : "RELIFE-PHYSIO";
}

function workbookForDepartment(department: ClinicDepartment): Workbook {
  return department === "Dental" ? "dental" : "physio";
}

function dhakaParts(ref = new Date()): {
  date: string;
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
    month: `${values.year}-${values.month}`,
    timestamp: `${date} ${time}`,
    provenance: ref.toISOString(),
  };
}

function validateRequestId(value: string): string {
  const requestId = normalize(value);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) throw new Error("INVALID_REQUEST_ID");
  return requestId;
}

function nextPaymentId(existing: Set<string>): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = `SPW${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
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

async function salarySheetId(workbook: Workbook): Promise<number> {
  const properties = await getSheetProperties(workbook);
  const sheet = properties.find((item) => item.title === "13_Salary");
  if (!sheet) throw new Error("SCHEMA_MISMATCH");
  return sheet.sheetId;
}

async function appendSalaryAudit(input: {
  workbook: Workbook;
  actorId: string;
  paymentId: string;
  staffId: string;
  department: ClinicDepartment;
  amount: number;
  paidFrom: string;
}): Promise<void> {
  const now = dhakaParts();
  const clinic = clinicId(input.department);
  try {
    await appendSheetValues(input.workbook, "'20_Data_Audit'!A:W", [[
      `AUD-${randomUUID()}`,
      now.timestamp,
      input.actorId,
      "SALARY_PAID",
      "SalaryPayment",
      input.paymentId,
      "",
      "",
      JSON.stringify({ staffId: input.staffId, amount: input.amount, paidFrom: input.paidFrom }),
      "Finance domain action",
      "RELIFE",
      clinic,
      "AMTALI-01",
      `${clinic}:${input.paymentId}`,
      "",
      input.actorId,
      "web_pwa",
      "human_entry",
      false,
      true,
      "relife-uda-v1",
      now.provenance,
      input.department,
    ]]);
  } catch (error) {
    console.error("Finance salary audit append failed:", error);
  }
}

export async function paySalary(
  context: AccessContext,
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
  if (!staff) throw new Error("STAFF_NOT_FOUND");
  if (staff.roles.includes("Owner")) throw new Error("OWNER_SALARY_FORBIDDEN");
  if (staff.primaryDepartment !== "Physio" && staff.primaryDepartment !== "Dental") {
    throw new Error("STAFF_DEPARTMENT_UNSUPPORTED");
  }

  const department: ClinicDepartment = staff.primaryDepartment;
  assertCanPerform(context, "salary.pay", department);
  const workbook = workbookForDepartment(department);
  const snapshot = await fetchSheetRanges(workbook, ["13_Salary"]);
  const rows = snapshot["13_Salary"] || [];
  if (rows.length < 1) throw new Error("SCHEMA_MISMATCH");
  const headers = rows[0];
  ensureHeaders(headers, [
    "Payment_ID",
    "Date",
    "Month",
    "Staff_ID",
    "Amount",
    "Department",
    "Paid_From",
    "Status",
    "Paid_At",
    "Note",
  ]);

  const noteIdx = headerIndex(headers, "Note");
  const idIdx = headerIndex(headers, "Payment_ID");
  const marker = `WEBREQ:${requestId}`;
  const existing = rows.slice(1).find((row) => at(row, noteIdx).includes(marker));
  if (existing) return { paymentId: at(existing, idIdx), duplicate: true };

  const existingIds = new Set(rows.slice(1).map((row) => at(row, idIdx)).filter(Boolean));
  const paymentId = nextPaymentId(existingIds);
  const now = dhakaParts();
  const note = [normalize(input.note), marker].filter(Boolean).join(" | ");
  const row = rowForHeaders(headers, {
    Payment_ID: paymentId,
    Date: now.date,
    Month: now.month,
    Staff_ID: staff.staffId,
    Amount: amount,
    Paid_By: context.staffId,
    Timestamp: now.timestamp,
    Note: note,
    Organization_ID: "RELIFE",
    Clinic_ID: clinicId(department),
    Branch_ID: "AMTALI-01",
    Record_ID: `${clinicId(department)}:${paymentId}`,
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

  const sheetId = await salarySheetId(workbook);
  await batchUpdateSpreadsheet(workbook, [appendRowRequest(sheetId, row)]);
  await appendSalaryAudit({
    workbook,
    actorId: context.staffId,
    paymentId,
    staffId: staff.staffId,
    department,
    amount,
    paidFrom: input.paidFrom,
  });
  return { paymentId, duplicate: false };
}
