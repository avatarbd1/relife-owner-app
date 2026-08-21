import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  acceptedCashHandoverTotal,
  calculateCustodyPosition,
  financeScopeAllowsDepartment,
  reconcileSalaryTotals,
} from "../lib/domain/finance/reconciliation.ts";
import { isCashCustodyLedgerDate } from "../lib/domain/finance/cashBusinessDay.ts";
import type {
  CashMovement,
  Expense,
  Payment,
  SalaryPayment,
} from "../lib/types.ts";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const payment = (
  overrides: Partial<Payment> & Pick<Payment, "department" | "amount" | "paymentMethod">
): Payment => ({
  receiptNo: "RC-1",
  date: "2026-08-31",
  patientId: "PT0001",
  patientName: "Test",
  discount: 0,
  due: 0,
  receivedBy: "ST-REC",
  ...overrides,
});

const expense = (
  overrides: Partial<Expense> & Pick<Expense, "department" | "amount">
): Expense => ({
  expenseId: "EX-1",
  date: "2026-08-31",
  category: "Supplies",
  description: "Test expense",
  paymentMethod: "",
  paidBy: "ST-OWN",
  status: "Paid",
  expenseType: "Clinic Expense",
  isHouseholdWithdrawal: false,
  ...overrides,
});

const salary = (
  overrides: Partial<SalaryPayment> & Pick<SalaryPayment, "department" | "amount">
): SalaryPayment => ({
  id: "SP-1",
  date: "2026-08-31",
  staffId: "ST-1",
  staffName: "Staff",
  status: "Paid",
  ...overrides,
});

const movement = (
  overrides: Partial<CashMovement> & Pick<CashMovement, "department" | "amount" | "status">
): CashMovement => ({
  id: "CMW-1",
  date: "2026-08-31",
  fromCustodian: "Reception",
  toCustodian: "Home Treasury",
  ...overrides,
});

const includeAll = () => true;

test("combined finance scope is Physio + Dental only, never Department=All", () => {
  assert.equal(financeScopeAllowsDepartment("combined", "Physio"), true);
  assert.equal(financeScopeAllowsDepartment("combined", "Dental"), true);
  assert.equal(financeScopeAllowsDepartment("combined", "All"), false);
  assert.equal(financeScopeAllowsDepartment("physio", "Dental"), false);
});

test("cash and digital collections land in different custody buckets", () => {
  const result = calculateCustodyPosition({
    scope: "physio",
    payments: [
      payment({ department: "Physio", amount: 100, paymentMethod: "Cash" }),
      payment({ department: "Physio", amount: 200, paymentMethod: "Bank" }),
    ],
    expenses: [],
    salaryPayments: [],
    cashMovements: [],
    dateIncluded: includeAll,
  });
  assert.deepEqual(result, {
    reception: 100,
    homeTreasury: 0,
    bank: 200,
    total: 300,
  });
});

test("paid expense subtracts from actual paidFrom while pending expense has no custody effect", () => {
  const result = calculateCustodyPosition({
    scope: "physio",
    payments: [],
    expenses: [
      expense({ department: "Physio", amount: 30, paidFrom: "Reception", status: "Paid" }),
      expense({ department: "Physio", amount: 70, paidFrom: "Bank", status: "Pending" }),
    ],
    salaryPayments: [],
    cashMovements: [],
    dateIncluded: includeAll,
  });
  assert.equal(result.reception, -30);
  assert.equal(result.bank, 0);
  assert.equal(result.total, -30);
});

test("paid salary subtracts from its actual custody source", () => {
  const result = calculateCustodyPosition({
    scope: "dental",
    payments: [],
    expenses: [],
    salaryPayments: [
      salary({ department: "Dental", amount: 500, paidFrom: "Home Treasury" }),
    ],
    cashMovements: [],
    dateIncluded: includeAll,
  });
  assert.equal(result.homeTreasury, -500);
  assert.equal(result.total, -500);
});

test("accepted handover is custody-only and total-neutral", () => {
  const result = calculateCustodyPosition({
    scope: "physio",
    payments: [payment({ department: "Physio", amount: 100, paymentMethod: "Cash" })],
    expenses: [],
    salaryPayments: [],
    cashMovements: [movement({ department: "Physio", amount: 80, status: "Accepted" })],
    dateIncluded: includeAll,
  });
  assert.equal(result.reception, 20);
  assert.equal(result.homeTreasury, 80);
  assert.equal(result.total, 100);
});

test("receivedAmount discrepancy is applied exactly once to both custody sides", () => {
  const row = movement({
    department: "Physio",
    amount: 100,
    receivedAmount: 90,
    status: "Accepted",
  });
  const result = calculateCustodyPosition({
    scope: "physio",
    payments: [payment({ department: "Physio", amount: 100, paymentMethod: "Cash" })],
    expenses: [],
    salaryPayments: [],
    cashMovements: [row],
    dateIncluded: includeAll,
  });
  assert.equal(result.reception, 10);
  assert.equal(result.homeTreasury, 90);
  assert.equal(result.total, 100);
  assert.equal(
    acceptedCashHandoverTotal({
      scope: "physio",
      cashMovements: [row],
      dateIncluded: includeAll,
    }),
    90
  );
});

test("pending and rejected handovers have zero custody and handover-total effect", () => {
  const rows = [
    movement({ department: "Physio", amount: 80, status: "Pending" }),
    movement({ department: "Physio", amount: 60, status: "Rejected" }),
  ];
  const result = calculateCustodyPosition({
    scope: "physio",
    payments: [],
    expenses: [],
    salaryPayments: [],
    cashMovements: rows,
    dateIncluded: includeAll,
  });
  assert.equal(result.total, 0);
  assert.equal(
    acceptedCashHandoverTotal({ scope: "physio", cashMovements: rows, dateIncluded: includeAll }),
    0
  );
});

test("department isolation excludes Dental and All rows from Physio custody", () => {
  const result = calculateCustodyPosition({
    scope: "physio",
    payments: [
      payment({ department: "Physio", amount: 100, paymentMethod: "Cash" }),
      payment({ department: "Dental", amount: 200, paymentMethod: "Cash" }),
      payment({ department: "All", amount: 300, paymentMethod: "Cash" }),
    ],
    expenses: [],
    salaryPayments: [],
    cashMovements: [],
    dateIncluded: includeAll,
  });
  assert.equal(result.reception, 100);
});

test("custody cutover carries August balance into September but excludes July legacy rows", () => {
  const result = calculateCustodyPosition({
    scope: "physio",
    payments: [
      payment({ department: "Physio", amount: 40, paymentMethod: "Cash", date: "2026-07-31" }),
      payment({ department: "Physio", amount: 100, paymentMethod: "Cash", date: "2026-08-31" }),
      payment({ department: "Physio", amount: 25, paymentMethod: "Cash", date: "2026-09-02" }),
    ],
    expenses: [],
    salaryPayments: [],
    cashMovements: [],
    dateIncluded: (date) => isCashCustodyLedgerDate(date, "2026-09-02"),
  });
  assert.equal(result.reception, 125);
});

test("salary over-payment never creates a negative due and remains unclassified excess", () => {
  assert.deepEqual(reconcileSalaryTotals(1000, 1200), {
    fixedCommitment: 1000,
    ledgerPaid: 1200,
    remainingDue: 0,
    excessPaid: 200,
  });
  assert.deepEqual(reconcileSalaryTotals(1000, 700), {
    fixedCommitment: 1000,
    ledgerPaid: 700,
    remainingDue: 300,
    excessPaid: 0,
  });
});

test("legacy cash-position compatibility reader delegates canonical scoped custody", () => {
  const calculations = source("lib/calculations.ts");
  assert.match(calculations, /getScopedCashPosition\("combined", now\)/);
  assert.doesNotMatch(calculations, /inCurrentMonthToDate/);
});

test("live finance readers reject Department=All and do not fabricate salary Advance", () => {
  const data = source("lib/data/index.ts");
  assert.match(data, /row\.department === "Physio"/);
  assert.doesNotMatch(data, /row\.department !== "Dental"/);
  assert.doesNotMatch(data, /type:\s*"Advance" as const/);
  assert.match(data, /getHeaderIndex\(headers, "Type", "Payment_Type"\)/);
});

test("Owner finance UI preserves four separate meanings and unknown billed total", () => {
  const finance = source("app/(dashboard)/finance/page.tsx");
  for (const label of ["Billed Services", "Collections", "Outstanding", "Cash Handover"]) {
    assert.match(finance, new RegExp(label));
  }
  assert.match(finance, /Legacy Total_Bill coverage is incomplete/);
  assert.match(finance, /value === null \? "—"/);
  assert.match(finance, /Custody-only; never revenue/);
});
