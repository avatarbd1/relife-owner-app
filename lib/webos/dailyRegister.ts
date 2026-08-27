import "server-only";

import { fetchSheetRanges, type Workbook } from "@/lib/data/googleSheets";
import type { Scope } from "@/lib/types";
import { canPerform, type AccessContext } from "@/lib/webos/access";

type ClinicDepartment = "Physio" | "Dental";

export interface WebDailyRegisterRow {
  receiptNo: string;
  sl: string;
  date: string;
  patientId: string;
  patientName: string;
  department: ClinicDepartment;
  sessions: number;
  service: string;
  amount: number;
  discount: number;
  due: number;
  paymentMethod: string;
  receivedBy: string;
  status: "Paid" | "Partial" | "Due";
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function numberValue(value: unknown): number {
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

function todayDhaka(ref = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ref);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function registerDate(value?: string): string {
  const candidate = normalize(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : todayDhaka();
}

function scopeAllows(scope: Scope, department: ClinicDepartment): boolean {
  if (scope === "combined") return true;
  return department === (scope === "physio" ? "Physio" : "Dental");
}

function parseRows(
  rows: string[][],
  department: ClinicDepartment,
  date: string,
  clinicId: string
): WebDailyRegisterRow[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idx = (...names: string[]) => headerIndex(headers, ...names);
  const departmentIdx = idx("Department");
  const clinicIdIdx = idx("Clinic_ID");

  return rows.slice(1).flatMap((row) => {
    if (at(row, idx("Date")) !== date) return [];
    const rowDepartment = at(row, departmentIdx);
    if (rowDepartment && normalized(rowDepartment) !== normalized(department)) return [];
    const rowClinicId = at(row, clinicIdIdx);
    if (rowClinicId && rowClinicId !== clinicId) return [];
    const receiptNo = at(row, idx("Receipt_No", "Receipt"));
    if (!receiptNo) return [];
    const remarks = at(row, idx("Remarks"));
    const sessionsMatch = /Sessions:\s*(\d+)/i.exec(remarks);
    const serviceMatch = /Service:\s*([^|]+)/i.exec(remarks);
    const amount = numberValue(at(row, idx("Amount")));
    const due = numberValue(at(row, idx("Due")));
    const sessionText = at(row, idx("Sessions"));
    const sessions = Number(sessionText || sessionsMatch?.[1] || (department === "Physio" ? 1 : 0));

    return [{
      receiptNo,
      sl: at(row, idx("SL")),
      date,
      patientId: at(row, idx("Patient_ID")),
      patientName: at(row, idx("Patient_Name")),
      department,
      sessions: Number.isFinite(sessions) ? sessions : 0,
      service:
        serviceMatch?.[1]?.trim() ||
        at(row, idx("Session_Type", "Service", "Procedure")),
      amount,
      discount: numberValue(at(row, idx("Discount"))),
      due,
      paymentMethod: at(row, idx("Payment_Method")),
      receivedBy: at(row, idx("Received_By")),
      status: due <= 0 ? "Paid" : amount > 0 ? "Partial" : "Due",
    }];
  });
}

async function readDepartment(
  context: AccessContext,
  department: ClinicDepartment,
  date: string,
  clinicId: string
): Promise<WebDailyRegisterRow[]> {
  if (!canPerform(context, "register.read", department)) return [];
  const workbook: Workbook = department === "Dental" ? "dental" : "physio";
  const snapshot = await fetchSheetRanges(workbook, ["06_Payments"]);
  return parseRows(snapshot["06_Payments"] || [], department, date, clinicId);
}

export async function getDailyRegisterSnapshot(
  context: AccessContext,
  scope: Scope,
  clinicId: string,
  requestedDate?: string
) {
  const date = registerDate(requestedDate);
  const departments = (["Physio", "Dental"] as ClinicDepartment[]).filter(
    (department) =>
      scopeAllows(scope, department) &&
      canPerform(context, "register.read", department)
  );

  const groups = await Promise.all(
    departments.map((department) => readDepartment(context, department, date, clinicId))
  );
  const rows = groups
    .flat()
    .sort((a, b) => {
      const slA = Number(a.sl || 0);
      const slB = Number(b.sl || 0);
      if (slA && slB && slA !== slB) return slA - slB;
      return a.receiptNo.localeCompare(b.receiptNo);
    });

  const moneyVisible = new Set(
    departments.filter((department) =>
      canPerform(context, "payment.read_amount", department)
    )
  );

  const visibleRows = rows.map((row) => ({
    ...row,
    amount: moneyVisible.has(row.department) ? row.amount : 0,
    discount: moneyVisible.has(row.department) ? row.discount : 0,
    due: moneyVisible.has(row.department) ? row.due : 0,
    moneyVisible: moneyVisible.has(row.department),
  }));

  return {
    date,
    rows: visibleRows,
    departments,
    totals: {
      entries: visibleRows.length,
      sessions: visibleRows.reduce((sum, row) => sum + row.sessions, 0),
      amount: visibleRows.reduce((sum, row) => sum + row.amount, 0),
      discount: visibleRows.reduce((sum, row) => sum + row.discount, 0),
      due: visibleRows.reduce((sum, row) => sum + row.due, 0),
    },
    hasMoneyAccess: moneyVisible.size > 0,
  };
}
