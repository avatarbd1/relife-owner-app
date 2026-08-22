export type FinanceDepartment = "Physio" | "Dental";

export interface SalaryCommitmentRow {
  role?: string;
  status?: string;
  salary?: number;
}

export interface ExpensePolicyRow {
  department: string;
  category: string;
  status?: string;
  expenseType?: string;
  isHouseholdWithdrawal?: boolean;
}

/**
 * Single source of truth for fixed monthly non-salary commitments.
 *
 * Staff salaries MUST NOT be duplicated here. Receptionists, therapists,
 * dentists and any cleaner represented in 08_Staff are salary commitments and
 * are counted from the staff master instead.
 */
export const FIXED_MONTHLY_OVERHEAD: Readonly<
  Record<FinanceDepartment, Readonly<Record<string, number>>>
> = Object.freeze({
  Physio: Object.freeze({
    "চেম্বার ভাড়া": 13_000,
  }),
  Dental: Object.freeze({
    "চেম্বার ভাড়া": 10_000,
    "ক্লিনার বেতন": 3_000,
  }),
});

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function fixedCategoryCommitment(
  department: string,
  category: string
): number | undefined {
  if (department !== "Physio" && department !== "Dental") return undefined;
  return FIXED_MONTHLY_OVERHEAD[department][String(category || "").trim()];
}

/** Blank is retained as paid for backwards compatibility with legacy rows. */
export function isPaidLedgerStatus(status: unknown): boolean {
  const value = normalized(status);
  return value === "" || value === "paid";
}

export function isAcceptedCashMovementStatus(status: unknown): boolean {
  return normalized(status) === "accepted";
}

export function isSalaryCommitmentStaff(row: SalaryCommitmentRow): boolean {
  return normalized(row.status) === "active" && normalized(row.role) !== "owner";
}

export function isFixedOverheadExpense(row: ExpensePolicyRow): boolean {
  return fixedCategoryCommitment(row.department, row.category) !== undefined;
}

export function isVariableClinicExpense(row: ExpensePolicyRow): boolean {
  if (!isPaidLedgerStatus(row.status)) return false;
  if (row.isHouseholdWithdrawal) return false;
  if (normalized(row.expenseType || "Clinic Expense") !== "clinic expense") return false;
  if (isFixedOverheadExpense(row)) return false;
  return true;
}
