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
  getPayments,
  getExpenses,
  getStaff,
  getSalaryPayments,
  getCashMovements,
} from "@/lib/data";
import {
  isPaidLedgerStatus,
  isSalaryCommitmentStaff,
  isVariableClinicExpense,
} from "@/lib/domain/finance/policy";
import {
  acceptedCashHandoverTotal,
  financeScopeAllowsDepartment,
} from "@/lib/domain/finance/reconciliation";
import {
  expensePaidInMonth,
  expensePaidInRange,
  fixedOverheadForDepartment,
  salaryPaidInMonth,
  salaryPaidInRange,
} from "@/lib/domain/finance/reportingDates";
import { cashBusinessDate } from "@/lib/domain/finance/cashBusinessDay";
import {
  dateRangeMonthSegments,
  prorateMonthlyAmount,
  roundMoney,
} from "@/lib/domain/finance/dateRange";
import { getScopedCashPosition } from "@/lib/scopedCash";
import { reconcileLegacyPayrollExpenses } from "@/lib/domain/finance/legacyPayroll";

function inScope<T extends { department: Department }>(
  rows: T[],
  scope: Scope
): T[] {
  return rows.filter((row) => financeScopeAllowsDepartment(scope, row.department));
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

export interface CashPosition {
  reception: number;
  homeTreasury: number;
  bank: number;
  total: number;
}

/**
 * Compatibility reader for the combined Owner view. The canonical custody
 * calculation lives in getScopedCashPosition(), so month boundaries cannot
 * silently reset Reception/Home Treasury/Bank here.
 */
export async function getCashPosition(
  now: Date = new Date()
): Promise<CashPosition> {
  return getScopedCashPosition("combined", now);
}

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

export async function getMonthCashHandover(
  scope: Scope,
  now: Date = new Date()
): Promise<number> {
  const cashMovements = await getCashMovements();
  const today = cashBusinessDate(now);
  const month = today.slice(0, 7);
  return acceptedCashHandoverTotal({
    scope,
    cashMovements,
    dateIncluded: (date) => {
      const key = normalizedDate(date);
      return key.startsWith(month) && key <= today;
    },
  });
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
  const [payments, expenses, staff, salaryPayments] = await Promise.all([
    getPayments(),
    getExpenses(),
    getStaff(),
    getSalaryPayments(),
  ]);

  const legacyPayroll = reconcileLegacyPayrollExpenses({
    expenses: inScope(expenses, scope),
    staff: inScope(staff, scope),
    salaryPayments: inScope(salaryPayments, scope),
    expenseIncluded: (expense) => expensePaidInMonth(expense, now),
    salaryIncluded: (payment) => salaryPaidInMonth(payment, now),
  });

  const monthCollection = inScope(payments, scope)
    .filter((p) => isSameMonth(p.date, now))
    .reduce((sum, p) => sum + p.amount, 0);

  const variableClinicExpense = inScope(expenses, scope)
    .filter(
      (e) =>
        expensePaidInMonth(e, now) &&
        isVariableClinicExpense(e) &&
        !legacyPayroll.matchedExpenseIds.has(e.expenseId)
    )
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
  const [payments, expenses, staff, salaryPayments] = await Promise.all([
    getPayments(),
    getExpenses(),
    getStaff(),
    getSalaryPayments(),
  ]);

  const rangeFilter = (date: string) =>
    normalizedDate(date) >= startDate && normalizedDate(date) <= endDate;

  const legacyPayroll = reconcileLegacyPayrollExpenses({
    expenses: inScope(expenses, scope),
    staff: inScope(staff, scope),
    salaryPayments: inScope(salaryPayments, scope),
    expenseIncluded: (expense) => expensePaidInRange(expense, startDate, endDate),
    salaryIncluded: (payment) => salaryPaidInRange(payment, startDate, endDate),
  });

  const monthCollection = inScope(payments, scope)
    .filter((p) => rangeFilter(p.date))
    .reduce((sum, p) => sum + p.amount, 0);

  const variableClinicExpense = inScope(expenses, scope)
    .filter(
      (e) =>
        expensePaidInRange(e, startDate, endDate) &&
        isVariableClinicExpense(e) &&
        !legacyPayroll.matchedExpenseIds.has(e.expenseId)
    )
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
  salaryPaid: number;
  salaryAdvance: number;
  legacyUnclassified: number;
  /** Verified legacy 07_Expenses payroll settlement, kept separate from 13_Salary. */
  legacyExpenseSettlement?: number;
  /** Ambiguous legacy payroll rows remain expenses and require manual review. */
  legacyPayrollConflictCount?: number;
  /** Total of (salaryPaid + salaryAdvance), excludes legacy */
  settlementTotal: number;
  /** @deprecated Use settlementTotal for calculations. Kept for temporary compat. */
  ledgerPaid: number;
  /** @deprecated Source rows do not reliably classify Salary vs Advance. */
  paidOrAdvance: number;
  remainingDue: number;
  excessAmount: number;
}

export async function getSalaryStatus(
  scope: Scope,
  now: Date = new Date()
): Promise<SalaryStatus> {
  const [staff, salaryPayments, expenses] = await Promise.all([
    getStaff(),
    getSalaryPayments(),
    getExpenses(),
  ]);

  const fixedCommitment = inScope(staff, scope)
    .filter(isSalaryCommitmentStaff)
    .reduce((sum, s) => sum + s.salary, 0);

  const paidThisMonth = inScope(salaryPayments, scope).filter(
    (sp) =>
      salaryPaidInMonth(sp, now) &&
      isPaidLedgerStatus(sp.status)
  );

  let salaryPaid = 0;
  let salaryAdvance = 0;
  let legacyUnclassified = 0;

  for (const payment of paidThisMonth) {
    if (payment.type === "Salary") {
      salaryPaid += payment.amount;
    } else if (payment.type === "Advance") {
      salaryAdvance += payment.amount;
    } else {
      legacyUnclassified += payment.amount;
    }
  }

  const legacyPayroll = reconcileLegacyPayrollExpenses({
    expenses: inScope(expenses, scope),
    staff: inScope(staff, scope),
    salaryPayments: inScope(salaryPayments, scope),
    expenseIncluded: (expense) => expensePaidInMonth(expense, now),
    salaryIncluded: (payment) => salaryPaidInMonth(payment, now),
  });

  const settlementTotal = salaryPaid + salaryAdvance;
  const legacyExpenseSettlement = legacyPayroll.settlementTotal;
  const ledgerPaid =
    settlementTotal + legacyUnclassified + legacyExpenseSettlement;
  const remainingDue = Math.max(0, fixedCommitment - ledgerPaid);
  const excessAmount = Math.max(0, ledgerPaid - fixedCommitment);

  return {
    fixedCommitment,
    salaryPaid,
    salaryAdvance,
    legacyUnclassified,
    legacyExpenseSettlement,
    legacyPayrollConflictCount: legacyPayroll.conflicts.length,
    settlementTotal,
    ledgerPaid,
    paidOrAdvance: ledgerPaid,
    remainingDue,
    excessAmount,
  };
}

export type { Payment, Expense, StaffMember, SalaryPayment, CashMovement };
