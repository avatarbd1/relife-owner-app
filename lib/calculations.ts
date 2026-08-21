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
import {
  FIXED_MONTHLY_OVERHEAD,
  isAcceptedCashMovementStatus,
  isPaidLedgerStatus,
  isSalaryCommitmentStaff,
  isVariableClinicExpense,
  type FinanceDepartment,
} from "@/lib/domain/finance/policy";
import {
  dateRangeMonthSegments,
  prorateMonthlyAmount,
  roundMoney,
} from "@/lib/domain/finance/dateRange";

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

function effectivePaidDate(row: { date: string; paidAt?: string }): string {
  return normalizedDate(row.paidAt || row.date);
}

function fixedOverheadForDepartment(
  department: FinanceDepartment,
  expenses: Expense[],
  now: Date
): number {
  const commitments = FIXED_MONTHLY_OVERHEAD[department];
  let total = 0;

  for (const [category, commitment] of Object.entries(commitments)) {
    const actual = expenses
      .filter(
        (expense) =>
          expense.department === department &&
          expense.category.trim() === category &&
          isSameMonth(expense.date, now) &&
          isPaidLedgerStatus(expense.status) &&
          !expense.isHouseholdWithdrawal &&
          String(expense.expenseType || "Clinic Expense").trim() ===
            "Clinic Expense"
      )
      .reduce((sum, expense) => sum + expense.amount, 0);
    total += Math.max(commitment, actual);
  }

  return total;
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

// CONSOLIDATED: Cash position calculation removed; use getScopedCashPosition() from lib/scopedCash.ts
// getCashPosition() was unused and used month-to-date filter (drift from canonical custody ledger cutover).
// getScopedCashPosition() is the authoritative implementation per P0-05 reconciliation.

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

export async function getDateRangeCollection(
  startDate: string,
  endDate: string,
  scope: Scope
): Promise<TodaysCollection> {
  dateRangeMonthSegments(startDate, endDate);
  const payments = await getPayments();
  const inRange = payments.filter(
    (p) => normalizedDate(p.date) >= startDate && normalizedDate(p.date) <= endDate
  );
  const scoped = inScope(inRange, scope);
  const physio = scoped
    .filter((p) => p.department === "Physio")
    .reduce((sum, p) => sum + p.amount, 0);
  const dental = scoped
    .filter((p) => p.department === "Dental")
    .reduce((sum, p) => sum + p.amount, 0);
  return { physio, dental, combined: physio + dental };
}

export interface MonthBusinessPosition {
  monthCollection: number;
  variableClinicExpense: number;
  fixedOverhead: number;
  fixedSalaryCommitment: number;
  totalBusinessLiability: number;
  surplusOrUncovered: number;
}

async function getFixedOverhead(
  scope: Scope,
  expenses: Expense[],
  now: Date
): Promise<number> {
  if (scope === "physio") {
    return fixedOverheadForDepartment("Physio", expenses, now);
  }
  if (scope === "dental") {
    return fixedOverheadForDepartment("Dental", expenses, now);
  }
  return (
    fixedOverheadForDepartment("Physio", expenses, now) +
    fixedOverheadForDepartment("Dental", expenses, now)
  );
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
    .filter((e) => isSameMonth(e.date, now) && isVariableClinicExpense(e))
    .reduce((sum, e) => sum + e.amount, 0);

  const fixedSalaryCommitment = inScope(staff, scope)
    .filter(isSalaryCommitmentStaff)
    .reduce((sum, s) => sum + s.salary, 0);

  const fixedOverhead = await getFixedOverhead(scope, expenses, now);
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

export async function getDateRangeBusinessPosition(
  startDate: string,
  endDate: string,
  scope: Scope
): Promise<MonthBusinessPosition> {
  const segments = dateRangeMonthSegments(startDate, endDate);
  const [payments, expenses, staff] = await Promise.all([
    getPayments(),
    getExpenses(),
    getStaff(),
  ]);

  const rangeFilter = (date: string) =>
    normalizedDate(date) >= startDate && normalizedDate(date) <= endDate;

  const monthCollection = inScope(payments, scope)
    .filter((p) => rangeFilter(p.date))
    .reduce((sum, p) => sum + p.amount, 0);

  const variableClinicExpense = inScope(expenses, scope)
    .filter((e) => rangeFilter(e.date) && isVariableClinicExpense(e))
    .reduce((sum, e) => sum + e.amount, 0);

  const monthlySalaryCommitment = inScope(staff, scope)
    .filter(isSalaryCommitmentStaff)
    .reduce((sum, s) => sum + s.salary, 0);

  const fixedSalaryCommitment = prorateMonthlyAmount(
    monthlySalaryCommitment,
    segments
  );

  const monthlyOverheads = await Promise.all(
    segments.map((segment) => getFixedOverhead(scope, expenses, segment.ref))
  );
  const fixedOverhead = roundMoney(
    monthlyOverheads.reduce(
      (sum, monthlyOverhead, index) =>
        sum +
        (monthlyOverhead * segments[index].days) / segments[index].daysInMonth,
      0
    )
  );

  const totalBusinessLiability = roundMoney(
    variableClinicExpense + fixedOverhead + fixedSalaryCommitment
  );

  return {
    monthCollection: roundMoney(monthCollection),
    variableClinicExpense: roundMoney(variableClinicExpense),
    fixedOverhead,
    fixedSalaryCommitment,
    totalBusinessLiability,
    surplusOrUncovered: roundMoney(monthCollection - totalBusinessLiability),
  };
}

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
    .filter(isSalaryCommitmentStaff)
    .reduce((sum, s) => sum + s.salary, 0);

  const paidOrAdvance = inScope(salaryPayments, scope)
    .filter(
      (sp) =>
        isSameMonth(effectivePaidDate(sp), now) &&
        isPaidLedgerStatus(sp.status)
    )
    .reduce((sum, sp) => sum + sp.amount, 0);

  return {
    fixedCommitment,
    paidOrAdvance,
    remainingDue: fixedCommitment - paidOrAdvance,
  };
}

export type { Payment, Expense, StaffMember, SalaryPayment, CashMovement };
