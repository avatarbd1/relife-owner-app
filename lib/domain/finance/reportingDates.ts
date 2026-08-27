import type { Expense, SalaryPayment } from "../../types.ts";
import {
  effectiveExpensePaidDate,
  effectiveSalaryPaidDate,
} from "./reconciliation.ts";
import {
  FIXED_MONTHLY_OVERHEAD,
  isPaidLedgerStatus,
  type FinanceDepartment,
} from "./policy.ts";

function normalizedDate(value: string | undefined): string {
  return String(value || "").trim().slice(0, 10);
}

function dhakaMonthKey(ref: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(ref);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}`;
}

export function expensePaidInMonth(expense: Expense, ref: Date): boolean {
  return effectiveExpensePaidDate(expense).startsWith(dhakaMonthKey(ref));
}

export function expensePaidInRange(
  expense: Expense,
  startDate: string,
  endDate: string
): boolean {
  const paidDate = normalizedDate(effectiveExpensePaidDate(expense));
  return paidDate >= startDate && paidDate <= endDate;
}

export function salaryPaidInMonth(
  salaryPayment: SalaryPayment,
  ref: Date
): boolean {
  return effectiveSalaryPaidDate(salaryPayment).startsWith(dhakaMonthKey(ref));
}

export function salaryPaidInRange(
  salaryPayment: SalaryPayment,
  startDate: string,
  endDate: string
): boolean {
  const paidDate = normalizedDate(effectiveSalaryPaidDate(salaryPayment));
  return paidDate >= startDate && paidDate <= endDate;
}

export function fixedOverheadForDepartment(
  department: FinanceDepartment,
  expenses: Expense[],
  ref: Date
): number {
  const commitments = FIXED_MONTHLY_OVERHEAD[department];
  let total = 0;

  for (const [category, commitment] of Object.entries(commitments)) {
    const actual = expenses
      .filter(
        (expense) =>
          expense.department === department &&
          expense.category.trim() === category &&
          expensePaidInMonth(expense, ref) &&
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
