import "server-only";

import type { Scope } from "@/lib/types";
import { canPerform, type AccessContext } from "@/lib/webos/access";
import {
  readTenantPayments,
  type FinanceTenantContext,
} from "@/lib/webos/tenantFinanceData";

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

export async function getDailyRegisterSnapshot(
  context: AccessContext,
  scope: Scope,
  tenant: FinanceTenantContext,
  requestedDate?: string
) {
  const date = registerDate(requestedDate);
  const departments = (["Physio", "Dental"] as ClinicDepartment[]).filter(
    (department) =>
      scopeAllows(scope, department) &&
      canPerform(context, "register.read", department)
  );
  const payments = await readTenantPayments(tenant, scope);

  const rows: WebDailyRegisterRow[] = payments.flatMap((payment) => {
    if (payment.date !== date) return [];
    if (payment.department !== "Physio" && payment.department !== "Dental") return [];
    const department = payment.department;
    if (!departments.includes(department)) return [];
    const remarks = normalize(payment.remarks);
    const sessionsMatch = /Sessions:\s*(\d+)/i.exec(remarks);
    const serviceMatch = /Service:\s*([^|]+)/i.exec(remarks);
    const sessions = Number(sessionsMatch?.[1] || (department === "Physio" ? 1 : 0));
    return [{
      receiptNo: payment.receiptNo,
      sl: "",
      date: payment.date,
      patientId: payment.patientId,
      patientName: payment.patientName,
      department,
      sessions: Number.isFinite(sessions) ? sessions : 0,
      service: serviceMatch?.[1]?.trim() || "",
      amount: payment.amount,
      discount: payment.discount,
      due: payment.due,
      paymentMethod: payment.paymentMethod,
      receivedBy: payment.receivedBy,
      status: payment.due <= 0 ? "Paid" : payment.amount > 0 ? "Partial" : "Due",
    }];
  }).sort((a, b) => a.receiptNo.localeCompare(b.receiptNo));

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
