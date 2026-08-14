import "server-only";
import type {
  Payment,
  Expense,
  StaffMember,
  SalaryPayment,
  CashMovement,
  Scope,
  Department,
} from "@/lib/types";
import {
  IS_LIVE_DATA,
  getPayments,
  getExpenses,
  getStaff,
  getSalaryPayments,
  getCashMovements,
} from "@/lib/data";

function inScope<T extends { department: Department }>(
  rows: T[],
  scope: Scope
): T[] {
  if (scope === "combined") {
    return rows.filter((r) =>
      ["Physio", "Dental", "All"].includes(r.department)
    );
  }
  const department: Department = scope === "physio" ? "Physio" : "Dental";
  return rows.filter((r) => r.department === department);
}

function bdDateKey(ref: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ref);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function normalizedDate(value: string | undefined): string {
  return String(value || "").trim().slice(0, 10);
}

function isSameMonth(dateStr: string, ref: Date): boolean {
  return normalizedDate(dateStr).startsWith(bdDateKey(ref).slice(0, 7));
}

function isSameDay(dateStr: string, ref: Date): boolean {
  return normalizedDate(dateStr) === bdDateKey(ref);
}

function isPaid(status: string | undefined): boolean {
  const value = String(status || "").trim().toLowerCase();
  return value === "" || value === "paid";
}

function effectivePaidDate(row: { date: string; paidAt?: string }): string {
  return normalizedDate(row.paidAt || row.date);
}

type Custodian = "Reception" | "HomeTreasury" | "Bank";

function normalizeCustodian(value: string | undefined): Custodian | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    ["reception", "physio reception cash", "dental reception cash"].includes(
      normalized
    )
  ) {
    return "Reception";
  }
  if (normalized === "home treasury") return "HomeTreasury";
  if (["bank", "digital/bank", "digital"].includes(normalized)) return "Bank";
  return null;
}

// ---------------------------------------------------------------------
// Current Cash Position — current month, carried from every cash effect.
// Mirrors the production bot custody rules:
// payment -> Reception or Digital/Bank; paid expense/salary -> subtract from
// Paid_From; accepted transfer -> subtract source and add destination.
// ---------------------------------------------------------------------
export interface CashPosition {
  reception: number;
  homeTreasury: number;
  bank: number;
  total: number;
}

export async function getCashPosition(
  now: Date = new Date()
): Promise<CashPosition> {
  const position: CashPosition = {
    reception: 0,
    homeTreasury: 0,
    bank: 0,
    total: 0,
  };

  const movements = await getCashMovements();

  // Preserve the old seed-only development behavior. Production does not use
  // these bucket-delta seed rows once private Sheets credentials are active.
  if (!IS_LIVE_DATA) {
    for (const movement of movements as unknown as Array<{
      bucket?: string;
      amount: number;
    }>) {
      if (movement.bucket === "Reception") position.reception += movement.amount;
      else if (movement.bucket === "HomeTreasury")
        position.homeTreasury += movement.amount;
      else if (movement.bucket === "Bank") position.bank += movement.amount;
    }
    position.total = position.reception + position.homeTreasury + position.bank;
    return position;
  }

  const [payments, expenses, salaryPayments] = await Promise.all([
    getPayments(),
    getExpenses(),
    getSalaryPayments(),
  ]);
  const today = bdDateKey(now);
  const month = today.slice(0, 7);
  const inCurrentMonthToDate = (date: string) => {
    const key = normalizedDate(date);
    return key.startsWith(month) && key <= today;
  };

  for (const payment of payments) {
    if (!inCurrentMonthToDate(payment.date)) continue;
    if (payment.department === "All") continue;
    if (payment.paymentMethod === "Cash") position.reception += payment.amount;
    else position.bank += payment.amount;
  }

  for (const expense of expenses) {
    if (!inCurrentMonthToDate(expense.date) || !isPaid(expense.status)) continue;
    if (expense.department === "All") continue;
    const source = normalizeCustodian(expense.paidFrom || expense.paymentMethod);
    if (source === "Reception") position.reception -= expense.amount;
    else if (source === "HomeTreasury") position.homeTreasury -= expense.amount;
    else if (source === "Bank") position.bank -= expense.amount;
  }

  for (const salary of salaryPayments) {
    if (!inCurrentMonthToDate(effectivePaidDate(salary)) || !isPaid(salary.status))
      continue;
    if (salary.department === "All") continue;
    const source = normalizeCustodian(salary.paidFrom);
    if (source === "Reception") position.reception -= salary.amount;
    else if (source === "HomeTreasury") position.homeTreasury -= salary.amount;
    else if (source === "Bank") position.bank -= salary.amount;
  }

  for (const movement of movements) {
    if (!inCurrentMonthToDate(movement.date)) continue;
    if (movement.department === "All") continue;
    if (String(movement.status || "").trim().toLowerCase() !== "accepted")
      continue;
    const amount = movement.receivedAmount ?? movement.amount;
    const source = normalizeCustodian(movement.fromCustodian);
    const target = normalizeCustodian(movement.toCustodian);
    if (source === "Reception") position.reception -= amount;
    else if (source === "HomeTreasury") position.homeTreasury -= amount;
    else if (source === "Bank") position.bank -= amount;
    if (target === "Reception") position.reception += amount;
    else if (target === "HomeTreasury") position.homeTreasury += amount;
    else if (target === "Bank") position.bank += amount;
  }

  position.reception = Math.round(position.reception * 100) / 100;
  position.homeTreasury = Math.round(position.homeTreasury * 100) / 100;
  position.bank = Math.round(position.bank * 100) / 100;
  position.total =
    Math.round(
      (position.reception + position.homeTreasury + position.bank) * 100
    ) / 100;
  return position;
}

// ---------------------------------------------------------------------
// Today's Collection
// Source: 06_Payments only. Treatment status is NOT used for collection.
// ---------------------------------------------------------------------
export interface TodaysCollection {
  physio: number;
  dental: number;
  combined: number;
}

export async function getTodaysCollection(
  now: Date = new Date()
): Promise<TodaysCollection> {
  const payments = await getPayments();
  const today = payments.filter((p) => isSameDay(p.date, now));
  const physio = today
    .filter((p) => p.department === "Physio")
    .reduce((sum, p) => sum + p.amount, 0);
  const dental = today
    .filter((p) => p.department === "Dental")
    .reduce((sum, p) => sum + p.amount, 0);
  return { physio, dental, combined: physio + dental };
}

// ---------------------------------------------------------------------
// This Month's Business Position
// ---------------------------------------------------------------------
export interface MonthBusinessPosition {
  monthCollection: number;
  variableClinicExpense: number;
  fixedOverhead: number;
  fixedSalaryCommitment: number;
  totalBusinessLiability: number;
  surplusOrUncovered: number;
}

/**
 * Fixed overhead will be wired to its confirmed owner source separately.
 * Until then, return 0 rather than inventing a number.
 */
async function getFixedOverhead(_scope: Scope): Promise<number> {
  return 0;
}

export async function getMonthBusinessPosition(
  scope: Scope,
  now: Date = new Date()
): Promise<MonthBusinessPosition> {
  const [payments, expenses, staff] = await Promise.all([
    getPayments(),
    getExpenses(),
    getStaff(),
  ]);

  const monthCollection = inScope(payments, scope)
    .filter((p) => isSameMonth(p.date, now))
    .reduce((sum, p) => sum + p.amount, 0);

  const variableClinicExpense = inScope(expenses, scope)
    .filter(
      (e) =>
        isSameMonth(e.date, now) &&
        isPaid(e.status) &&
        !e.isHouseholdWithdrawal &&
        String(e.expenseType || "Clinic Expense").trim() === "Clinic Expense"
    )
    .reduce((sum, e) => sum + e.amount, 0);

  const fixedSalaryCommitment = inScope(staff, scope)
    .filter((s) => s.status === "Active")
    .reduce((sum, s) => sum + s.salary, 0);

  const fixedOverhead = await getFixedOverhead(scope);
  const totalBusinessLiability =
    variableClinicExpense + fixedOverhead + fixedSalaryCommitment;

  return {
    monthCollection,
    variableClinicExpense,
    fixedOverhead,
    fixedSalaryCommitment,
    totalBusinessLiability,
    surplusOrUncovered: monthCollection - totalBusinessLiability,
  };
}

// ---------------------------------------------------------------------
// Salary card
// Fixed commitment: 08_Staff.Salary (single master staff sheet)
// Paid/advance: department-specific 13_Salary rows.
// ---------------------------------------------------------------------
export interface SalaryStatus {
  fixedCommitment: number;
  paidOrAdvance: number;
  remainingDue: number;
}

export async function getSalaryStatus(
  scope: Scope,
  now: Date = new Date()
): Promise<SalaryStatus> {
  const [staff, salaryPayments] = await Promise.all([
    getStaff(),
    getSalaryPayments(),
  ]);

  const fixedCommitment = inScope(staff, scope)
    .filter((s) => s.status === "Active")
    .reduce((sum, s) => sum + s.salary, 0);

  const paidOrAdvance = inScope(salaryPayments, scope)
    .filter(
      (sp) => isSameMonth(effectivePaidDate(sp), now) && isPaid(sp.status)
    )
    .reduce((sum, sp) => sum + sp.amount, 0);

  return {
    fixedCommitment,
    paidOrAdvance,
    remainingDue: fixedCommitment - paidOrAdvance,
  };
}

export type { Payment, Expense, StaffMember, SalaryPayment, CashMovement };
