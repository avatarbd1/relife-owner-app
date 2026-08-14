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

/** Convert the top-nav Scope ("combined" | "physio" | "dental") into the
 * Department value(s) it corresponds to, for filtering rows. */
function departmentsForScope(scope: Scope): Department[] {
  if (scope === "physio") return ["Physio"];
  if (scope === "dental") return ["Dental"];
  return ["Physio", "Dental"];
}

function inScope<T extends { department: Department }>(
  rows: T[],
  scope: Scope
): T[] {
  const depts = departmentsForScope(scope);
  return rows.filter((r) => depts.includes(r.department));
}

function isSameMonth(dateStr: string, ref: Date): boolean {
  const d = new Date(dateStr);
  return (
    d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth()
  );
}

function isSameDay(dateStr: string, ref: Date): boolean {
  const d = new Date(dateStr);
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

// ---------------------------------------------------------------------
// Current Cash Position (all-time, never resets monthly)
// Source: 21_Cash_Movement
// ---------------------------------------------------------------------
export interface CashPosition {
  reception: number;
  homeTreasury: number;
  bank: number;
  total: number;
}

export async function getCashPosition(): Promise<CashPosition> {
  const movements = await getCashMovements();
  const position: CashPosition = {
    reception: 0,
    homeTreasury: 0,
    bank: 0,
    total: 0,
  };
  for (const m of movements) {
    if (m.bucket === "Reception") position.reception += m.amount;
    else if (m.bucket === "HomeTreasury") position.homeTreasury += m.amount;
    else if (m.bucket === "Bank") position.bank += m.amount;
  }
  position.total = position.reception + position.homeTreasury + position.bank;
  return position;
}

// ---------------------------------------------------------------------
// Today's Collection (আজকের আদায়)
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
// This Month's Business Position (এই মাসের ব্যবসার অবস্থা)
// ---------------------------------------------------------------------
export interface MonthBusinessPosition {
  monthCollection: number;
  variableClinicExpense: number;
  fixedOverhead: number;
  fixedSalaryCommitment: number;
  totalBusinessLiability: number;
  surplusOrUncovered: number; // positive = surplus, negative = uncovered
}

/**
 * Fixed overhead (rent, recurring non-salary fixed costs) is not yet
 * mapped to a sheet/tab in the data contract provided. Until that
 * source is confirmed, this returns 0 rather than guessing a number.
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
    .filter((e) => isSameMonth(e.date, now) && !e.isHouseholdWithdrawal)
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
// Fixed commitment source: 08_Staff.Salary
// Paid/advance source: 13_Salary
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
    .filter((sp) => isSameMonth(sp.date, now))
    .reduce((sum, sp) => sum + sp.amount, 0);

  return {
    fixedCommitment,
    paidOrAdvance,
    remainingDue: fixedCommitment - paidOrAdvance,
  };
}

export type { Payment, Expense, StaffMember, SalaryPayment, CashMovement };
