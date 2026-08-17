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

async function sheetIds(workbook: Workbook): Promise<Map<string, number>> {
  const properties = await getSheetProperties(workbook);
  const map = new Map<string, number>();
  for (const prop of properties) {
    map.set(prop.title, prop.sheetId);
  }
  return map;
}

function requireSheetId(map: Map<string, number>, title: string): number {
  const id = map.get(title);
  if (id === undefined) throw new Error("SCHEMA_MISMATCH");
  return id;
}

function buildSalaryAuditRow(
  headers: string[],
  input: {
    now: ReturnType<typeof dhakaClockParts>;
    actorId: string;
    paymentId: string;
    staffId: string;
    department: ClinicDepartment;
    amount: number;
    paidFrom: string;
  }
): SheetValue[] {
  const clinic = ledgerClinicId(input.department);
  return rowForHeaders(headers, {
    Audit_ID: `AUD-${randomUUID()}`,
    Timestamp: input.now.timestamp,
    Actor_ID: input.actorId,
    Action: "SALARY_PAID",
    Entity_Type: "SalaryPayment",
    Entity_ID: input.paymentId,
    Patient_ID: "",
    Before_Value: "",
    After_Value: JSON.stringify({
      staffId: input.staffId,
      amount: input.amount,
      paidFrom: input.paidFrom,
    }),
    Reason: "Finance domain action",
    Organization_ID: RELIFE_SYSTEM.organizationId,
    Clinic_ID: clinic,
    Branch_ID: RELIFE_SYSTEM.branchId,
    Record_ID: relifeRecordId(input.department, input.paymentId),
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
  const ids = await sheetIds(workbook);
  const salarySheetIdVal = requireSheetId(ids, "13_Salary");
  const auditSheetIdVal = requireSheetId(ids, "20_Data_Audit");

  const [salarySnapshot, auditSnapshot] = await Promise.all([
    fetchSheetRanges(workbook, ["13_Salary"]),
    fetchSheetRanges(workbook, ["20_Data_Audit"]),
  ]);
  const rows = salarySnapshot["13_Salary"] || [];
  const auditRows = auditSnapshot["20_Data_Audit"] || [];
  if (rows.length < 1 || auditRows.length < 1) throw new Error("SCHEMA_MISMATCH");
  const headers = rows[0];
  const auditHeaders = auditRows[0];
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

  const auditRow = buildSalaryAuditRow(auditHeaders, {
    now,
    actorId: context.staffId,
    paymentId,
    staffId: staff.staffId,
    department,
    amount,
    paidFrom: input.paidFrom,
  });

  const requests: SpreadsheetBatchRequest[] = [
    appendRowRequest(salarySheetIdVal, row),
    appendRowRequest(auditSheetIdVal, auditRow),
  ];
  await batchUpdateSpreadsheet(workbook, requests);
  return { paymentId, duplicate: false };
}
