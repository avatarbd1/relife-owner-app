import test from "node:test";
import assert from "node:assert/strict";
import {
  fixedCategoryCommitment,
  isAcceptedCashMovementStatus,
  isPaidLedgerStatus,
  isSalaryCommitmentStaff,
  isVariableClinicExpense,
  isLegacyPayrollExpense,
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

test("legacy payroll expenses are excluded from variable clinic expense", () => {
  assert.equal(
    isLegacyPayrollExpense({
      department: "Physio",
      category: "ক্লিনার বেতন",
      status: "Paid",
    }),
    true,
    "Bengali cleaner salary recognized"
  );
  assert.equal(
    isLegacyPayrollExpense({
      department: "Physio",
      category: "Cleaner salary",
      status: "Paid",
    }),
    true,
    "English cleaner salary recognized"
  );
  assert.equal(
    isLegacyPayrollExpense({
      department: "Physio",
      category: "কর্মচারী বেতন",
      status: "Paid",
    }),
    true,
    "Bengali staff salary recognized"
  );
  assert.equal(
    isLegacyPayrollExpense({
      department: "Physio",
      category: "Generator petrol",
      status: "Paid",
    }),
    false,
    "Non-payroll expense not recognized"
  );
});

test("Physio cleaner legacy payroll is not counted as variable expense", () => {
  const cleaner_ex0012: Parameters<typeof isVariableClinicExpense>[0] = {
    department: "Physio",
    category: "ক্লিনার বেতন",
    status: "Paid",
    expenseType: "Clinic Expense",
  };
  assert.equal(
    isVariableClinicExpense(cleaner_ex0012),
    false,
    "Legacy cleaner expense excluded to avoid double-count with ST009 salary commitment"
  );
});

test("Dental cleaner fixed overhead is also excluded from variable expense", () => {
  const dental_fixed_cleaner: Parameters<typeof isVariableClinicExpense>[0] = {
    department: "Dental",
    category: "ক্লিনার বেতন",
    status: "Paid",
    expenseType: "Clinic Expense",
  };
  assert.equal(
    isVariableClinicExpense(dental_fixed_cleaner),
    false,
    "Dental cleaner is fixed overhead and excluded"
  );
});

test("active staff salary commitment counts once, not duplicated by legacy expense", () => {
  const therapist_commitment = {
    role: "Therapist",
    status: "Active",
    salary: 15_000,
  };
  assert.equal(
    isSalaryCommitmentStaff(therapist_commitment),
    true,
    "Active therapist is a salary commitment"
  );

  const legacy_therapist_expense: Parameters<typeof isVariableClinicExpense>[0] = {
    department: "Physio",
    category: "থেরাপিস্ট বেতন",
    status: "Paid",
    expenseType: "Clinic Expense",
  };
  assert.equal(
    isVariableClinicExpense(legacy_therapist_expense),
    false,
    "Therapist salary paid via 07_Expenses is excluded to prevent double-count"
  );
});
