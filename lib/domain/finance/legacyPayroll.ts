import type { Expense, SalaryPayment, StaffMember } from "../../types.ts";
import { isPaidLedgerStatus, isSalaryCommitmentStaff } from "./policy.ts";

export type LegacyPayrollConflictReason =
  | "no-unique-staff-match"
  | "salary-ledger-already-exists";

export interface LegacyPayrollConflict {
  expenseId: string;
  reason: LegacyPayrollConflictReason;
}

export interface LegacyPayrollReconciliation {
  matchedExpenseIds: readonly string[];
  settlementTotal: number;
  conflicts: LegacyPayrollConflict[];
}

const CLEANER_EXPENSE_CATEGORIES = ["cleaner salary", "ক্লিনার বেতন"] as const;
const CLEANER_ROLES = ["cleaner", "ক্লিনার"] as const;

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isCleanerPayrollExpense(expense: Expense): boolean {
  return (
    expense.department === "Physio" &&
    CLEANER_EXPENSE_CATEGORIES.includes(
      normalized(expense.category) as (typeof CLEANER_EXPENSE_CATEGORIES)[number]
    ) &&
    normalized(expense.expenseType || "Clinic Expense") === "clinic expense" &&
    !expense.isHouseholdWithdrawal &&
    isPaidLedgerStatus(expense.status)
  );
}

/**
 * Reconciles the one verified legacy shape: an exact cleaner-salary expense
 * that uniquely matches an active cleaner's monthly commitment.
 *
 * Ambiguous rows stay visible as ordinary expenses and are reported as
 * conflicts. Nothing is inferred from broad category substrings, names or
 * descriptions, and an existing salary-ledger row blocks auto-reconciliation.
 */
export function reconcileLegacyPayrollExpenses(input: {
  expenses: Expense[];
  staff: StaffMember[];
  salaryPayments: SalaryPayment[];
  expenseIncluded: (expense: Expense) => boolean;
  salaryIncluded: (payment: SalaryPayment) => boolean;
}): LegacyPayrollReconciliation {
  const matchedExpenseIds: string[] = [];
  const conflicts: LegacyPayrollConflict[] = [];
  let settlementTotal = 0;

  for (const expense of input.expenses) {
    if (!input.expenseIncluded(expense) || !isCleanerPayrollExpense(expense)) continue;

    const candidates = input.staff.filter(
      (member) =>
        member.department === expense.department &&
        isSalaryCommitmentStaff(member) &&
        CLEANER_ROLES.includes(normalized(member.role) as (typeof CLEANER_ROLES)[number]) &&
        member.salary === expense.amount
    );

    if (candidates.length !== 1) {
      conflicts.push({ expenseId: expense.expenseId, reason: "no-unique-staff-match" });
      continue;
    }

    const staffMember = candidates[0];
    const hasSalaryLedgerEvidence = input.salaryPayments.some(
      (payment) =>
        payment.department === expense.department &&
        payment.staffId === staffMember.staffId &&
        input.salaryIncluded(payment) &&
        isPaidLedgerStatus(payment.status)
    );

    if (hasSalaryLedgerEvidence) {
      conflicts.push({ expenseId: expense.expenseId, reason: "salary-ledger-already-exists" });
      continue;
    }

    matchedExpenseIds.push(expense.expenseId);
    settlementTotal += expense.amount;
  }

  return { matchedExpenseIds, settlementTotal, conflicts };
}
