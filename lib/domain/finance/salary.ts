import "server-only";

import { randomUUID } from "node:crypto";
import {
  RELIFE_SYSTEM,
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
import type { ClinicDepartment, ExpensePaidFrom } from "@/lib/domain/finance/expenses";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import { getWebStaffDirectory } from "@/lib/webos/staffDirectory";

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
  const now = dhakaClockParts();
  const clinic = ledgerClinicId(input.department);
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
      RELIFE_SYSTEM.organizationId,
      clinic,
      RELIFE_SYSTEM.branchId,
      relifeRecordId(input.department, input.paymentId),
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
  const now = dhakaClockParts();
  const month = now.date.slice(0, 7);
  const note = [normalize(input.note), marker].filter(Boolean).join(" | ");
  const row = rowForHeaders(headers, {
    Payment_ID: paymentId,
    Date: now.date,
    Month: month,
    Staff_ID: staff.staffId,
    Amount: amount,
    Paid_By: context.staffId,
    Timestamp: now.timestamp,
    Note: note,
    Organization_ID: RELIFE_SYSTEM.organizationId,
    Clinic_ID: ledgerClinicId(department),
    Branch_ID: RELIFE_SYSTEM.branchId,
    Record_ID: relifeRecordId(department, paymentId),
    Provider_ID: context.staffId,
    Source_System: RELIFE_SYSTEM.sourceSystem,
    Source_Type: RELIFE_SYSTEM.sourceType,
    AI_Generated: false,
    Human_Verified: true,
    Schema_Version: RELIFE_SYSTEM.schemaVersion,
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
