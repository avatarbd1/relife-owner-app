import test from "node:test";
import assert from "node:assert/strict";
import { reconcileLegacyPayrollExpenses } from "../lib/domain/finance/legacyPayroll.ts";
import { calculateCustodyPosition } from "../lib/domain/finance/reconciliation.ts";
import { isVariableClinicExpense } from "../lib/domain/finance/policy.ts";
import type { Expense, SalaryPayment, StaffMember } from "../lib/types.ts";

const cleaner: StaffMember = {
  staffId: "ST009",
  fullName: "Khala Cleaner",
  role: "Cleaner",
  department: "Physio",
  salary: 1300,
  status: "Active",
};

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    expenseId: "EX0012",
    date: "2026-08-10",
    category: "ক্লিনার বেতন",
    description: "Cleaner salary paid",
    amount: 1300,
    paymentMethod: "Home Treasury",
    paidFrom: "Home Treasury",
    paidBy: "OWNER",
    department: "Physio",
    expenseType: "Clinic Expense",
    status: "Paid",
    isHouseholdWithdrawal: false,
    ...overrides,
  };
}

const included = () => true;

test("uniquely matched cleaner expense settles salary without becoming variable cost", () => {
  const row = expense();
  const result = reconcileLegacyPayrollExpenses({
    expenses: [row],
    staff: [cleaner],
    salaryPayments: [],
    expenseIncluded: included,
    salaryIncluded: included,
  });

  assert.deepEqual([...result.matchedExpenseIds], ["EX0012"]);
  assert.equal(result.settlementTotal, 1300);
  assert.deepEqual(result.conflicts, []);
  assert.equal(isVariableClinicExpense(row), true, "base policy keeps the expense visible");
  assert.equal(
    [row]
      .filter(
        (item) =>
          isVariableClinicExpense(item) && !result.matchedExpenseIds.includes(item.expenseId)
      )
      .reduce((sum, item) => sum + item.amount, 0),
    0,
    "business-position consumer excludes only the evidence-backed match"
  );
});

test("unmatched payroll-looking expense remains a variable expense and conflict", () => {
  const row = expense({ amount: 1200 });
  const result = reconcileLegacyPayrollExpenses({
    expenses: [row],
    staff: [cleaner],
    salaryPayments: [],
    expenseIncluded: included,
    salaryIncluded: included,
  });

  assert.equal(result.matchedExpenseIds.length, 0);
  assert.equal(result.settlementTotal, 0);
  assert.deepEqual(result.conflicts, [
    { expenseId: "EX0012", reason: "no-unique-staff-match" },
  ]);
  assert.equal(isVariableClinicExpense(row), true);
});

test("ambiguous duplicate cleaner staff never auto-reconciles", () => {
  const result = reconcileLegacyPayrollExpenses({
    expenses: [expense()],
    staff: [cleaner, { ...cleaner, staffId: "ST010", fullName: "Other Cleaner" }],
    salaryPayments: [],
    expenseIncluded: included,
    salaryIncluded: included,
  });
  assert.equal(result.matchedExpenseIds.length, 0);
  assert.equal(result.conflicts[0]?.reason, "no-unique-staff-match");
});

test("existing 13_Salary evidence blocks legacy expense auto-reconciliation", () => {
  const salary: SalaryPayment = {
    id: "SAL-1",
    date: "2026-08-10",
    staffId: "ST009",
    staffName: "Khala Cleaner",
    department: "Physio",
    amount: 1300,
    type: "Salary",
    status: "Paid",
  };
  const result = reconcileLegacyPayrollExpenses({
    expenses: [expense()],
    staff: [cleaner],
    salaryPayments: [salary],
    expenseIncluded: included,
    salaryIncluded: included,
  });
  assert.equal(result.matchedExpenseIds.length, 0);
  assert.equal(result.conflicts[0]?.reason, "salary-ledger-already-exists");
});

test("broad matching words do not hide ordinary expenses", () => {
  for (const category of ["Assistant equipment", "Salary software", "Cleaner liquid", "বেতন বই"]){
    const row = expense({ expenseId: category, category });
    const result = reconcileLegacyPayrollExpenses({
      expenses: [row],
      staff: [cleaner],
      salaryPayments: [],
      expenseIncluded: included,
      salaryIncluded: included,
    });
    assert.equal(result.matchedExpenseIds.length, 0, category);
    assert.equal(result.conflicts.length, 0, category);
    assert.equal(isVariableClinicExpense(row), true, category);
  }
});

test("Dental cleaner overhead is not reclassified as legacy Physio payroll", () => {
  const result = reconcileLegacyPayrollExpenses({
    expenses: [expense({ department: "Dental" })],
    staff: [{ ...cleaner, department: "Dental" }],
    salaryPayments: [],
    expenseIncluded: included,
    salaryIncluded: included,
  });
  assert.equal(result.matchedExpenseIds.length, 0);
  assert.equal(result.conflicts.length, 0);
});

test("legacy payroll remains a real cash deduction exactly once", () => {
  const cash = calculateCustodyPosition({
    scope: "physio",
    payments: [],
    expenses: [expense()],
    salaryPayments: [],
    cashMovements: [],
    dateIncluded: included,
  });
  assert.equal(cash.homeTreasury, -1300);
  assert.equal(cash.total, -1300);
});
