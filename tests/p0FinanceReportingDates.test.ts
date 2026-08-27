import test from "node:test";
import assert from "node:assert/strict";
import {
  expensePaidInMonth,
  expensePaidInRange,
  fixedOverheadForDepartment,
  salaryPaidInMonth,
} from "../lib/domain/finance/reportingDates.ts";
import type { Expense, SalaryPayment } from "../lib/types.ts";

// Reporting consumers must share the custody ledger's 09:00 Dhaka boundary.
const august = new Date("2026-08-15T06:00:00Z");
const september = new Date("2026-09-15T06:00:00Z");

function expense(paidAt: string): Expense {
  return {
    expenseId: `EX-${paidAt}`,
    date: "2026-09-01",
    category: "Supplies",
    description: "Boundary regression",
    amount: 100,
    paymentMethod: "Reception",
    paidBy: "ST-OWN",
    department: "Physio",
    expenseType: "Clinic Expense",
    paidFrom: "Reception",
    status: "Paid",
    paidAt,
    isHouseholdWithdrawal: false,
  };
}

function salary(paidAt: string): SalaryPayment {
  return {
    id: `SAL-${paidAt}`,
    staffId: "ST001",
    staffName: "Test Staff",
    date: "2026-09-01",
    amount: 1_300,
    status: "Paid",
    paidAt,
    paidFrom: "Home Treasury",
    type: "Salary",
    department: "Physio",
  };
}

test("salary reporting assigns 08:30 Dhaka to August and 09:00 to September", () => {
  const beforeBoundary = salary("2026-09-01 08:30");
  assert.equal(salaryPaidInMonth(beforeBoundary, august), true);
  assert.equal(salaryPaidInMonth(beforeBoundary, september), false);

  const atBoundary = salary("2026-09-01 09:00");
  assert.equal(salaryPaidInMonth(atBoundary, august), false);
  assert.equal(salaryPaidInMonth(atBoundary, september), true);
});

test("expense month reporting uses Paid_At and the 09:00 Dhaka boundary", () => {
  const beforeBoundary = expense("2026-09-01 08:59");
  assert.equal(expensePaidInMonth(beforeBoundary, august), true);
  assert.equal(expensePaidInMonth(beforeBoundary, september), false);

  const atBoundary = expense("2026-09-01 09:00");
  assert.equal(expensePaidInMonth(atBoundary, august), false);
  assert.equal(expensePaidInMonth(atBoundary, september), true);
});

test("expense date-range reporting uses the same effective paid date", () => {
  const beforeBoundary = expense("2026-09-01 08:59");
  assert.equal(expensePaidInRange(beforeBoundary, "2026-08-31", "2026-08-31"), true);
  assert.equal(expensePaidInRange(beforeBoundary, "2026-09-01", "2026-09-30"), false);

  const atBoundary = expense("2026-09-01 09:00");
  assert.equal(expensePaidInRange(atBoundary, "2026-08-31", "2026-08-31"), false);
  assert.equal(expensePaidInRange(atBoundary, "2026-09-01", "2026-09-30"), true);
});

test("legacy rows without Paid_At retain their recorded date", () => {
  const legacyExpense = { ...expense("2026-09-01 09:00"), paidAt: undefined };
  const legacySalary = { ...salary("2026-09-01 09:00"), paidAt: undefined };
  assert.equal(expensePaidInMonth(legacyExpense, september), true);
  assert.equal(salaryPaidInMonth(legacySalary, september), true);
});

test("fixed overhead actual-versus-commitment uses the effective paid month", () => {
  const rent = {
    ...expense("2026-09-01 08:59"),
    category: "চেম্বার ভাড়া",
    amount: 15_000,
  };
  assert.equal(fixedOverheadForDepartment("Physio", [rent], august), 15_000);
  assert.equal(fixedOverheadForDepartment("Physio", [rent], september), 13_000);
});
