import test from "node:test";
import assert from "node:assert/strict";
import {
  fixedCategoryCommitment,
  isAcceptedCashMovementStatus,
  isPaidLedgerStatus,
  isSalaryCommitmentStaff,
  isVariableClinicExpense,
} from "../lib/domain/finance/policy.ts";

test("owner is never part of fixed salary commitment", () => {
  assert.equal(
    isSalaryCommitmentStaff({ role: "Owner", status: "Active", salary: 100_000 }),
    false
  );
  assert.equal(
    isSalaryCommitmentStaff({ role: "Therapist", status: "Active", salary: 15_000 }),
    true
  );
  assert.equal(
    isSalaryCommitmentStaff({ role: "Receptionist", status: "Inactive", salary: 5_000 }),
    false
  );
});

test("staff salary roles are not duplicated as Dental fixed overhead", () => {
  assert.equal(fixedCategoryCommitment("Dental", "Receptionist"), undefined);
  assert.equal(fixedCategoryCommitment("Dental", "চেম্বার ভাড়া"), 10_000);
  assert.equal(fixedCategoryCommitment("Dental", "ক্লিনার বেতন"), 3_000);
  assert.equal(fixedCategoryCommitment("Physio", "চেম্বার ভাড়া"), 13_000);
});

test("legacy blank expense status remains paid but rejected/pending do not", () => {
  assert.equal(isPaidLedgerStatus(""), true);
  assert.equal(isPaidLedgerStatus("Paid"), true);
  assert.equal(isPaidLedgerStatus("Pending"), false);
  assert.equal(isPaidLedgerStatus("Rejected"), false);
});

test("household withdrawal never counts as variable clinic expense", () => {
  assert.equal(
    isVariableClinicExpense({
      department: "Physio",
      category: "Household",
      status: "Paid",
      expenseType: "Household Withdrawal",
      isHouseholdWithdrawal: true,
    }),
    false
  );
});

test("fixed overhead is excluded from variable expense to avoid double count", () => {
  assert.equal(
    isVariableClinicExpense({
      department: "Physio",
      category: "চেম্বার ভাড়া",
      status: "Paid",
      expenseType: "Clinic Expense",
    }),
    false
  );
  assert.equal(
    isVariableClinicExpense({
      department: "Physio",
      category: "Generator petrol",
      status: "Paid",
      expenseType: "Clinic Expense",
    }),
    true
  );
});

test("only accepted cash movement changes custody position", () => {
  assert.equal(isAcceptedCashMovementStatus("Accepted"), true);
  assert.equal(isAcceptedCashMovementStatus("Pending"), false);
  assert.equal(isAcceptedCashMovementStatus("Rejected"), false);
});
