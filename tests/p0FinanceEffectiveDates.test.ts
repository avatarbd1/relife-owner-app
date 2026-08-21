import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  acceptedCashHandoverTotal,
  calculateCustodyPosition,
} from "../lib/domain/finance/reconciliation.ts";
import type { CashMovement, Expense, Payment } from "../lib/types.ts";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const payment: Payment = {
  receiptNo: "RC-EFFECTIVE-DATE",
  date: "2026-08-31",
  patientId: "PT0001",
  patientName: "Test",
  department: "Physio",
  amount: 100,
  discount: 0,
  due: 0,
  paymentMethod: "Cash",
  receivedBy: "ST-REC",
};

function through(asOf: string) {
  return (date: string) => date >= "2026-08-01" && date <= asOf;
}

test("paid expense changes custody on Paid_At, not its earlier request date", () => {
  const expense: Expense = {
    expenseId: "EX-EFFECTIVE-DATE",
    date: "2026-08-31",
    category: "Supplies",
    description: "Requested in August, paid in September",
    amount: 30,
    paymentMethod: "Reception",
    paidBy: "ST-OWN",
    department: "Physio",
    expenseType: "Clinic Expense",
    paidFrom: "Reception",
    status: "Paid",
    paidAt: "2026-09-01 10:15",
    isHouseholdWithdrawal: false,
  };

  const beforePayment = calculateCustodyPosition({
    scope: "physio",
    payments: [payment],
    expenses: [expense],
    salaryPayments: [],
    cashMovements: [],
    dateIncluded: through("2026-08-31"),
  });
  assert.equal(beforePayment.reception, 100);
  assert.equal(beforePayment.total, 100);

  const afterPayment = calculateCustodyPosition({
    scope: "physio",
    payments: [payment],
    expenses: [expense],
    salaryPayments: [],
    cashMovements: [],
    dateIncluded: through("2026-09-01"),
  });
  assert.equal(afterPayment.reception, 70);
  assert.equal(afterPayment.total, 70);
});

test("accepted handover changes custody on acceptance date, never request date", () => {
  const handover: CashMovement = {
    id: "CMW-EFFECTIVE-DATE",
    date: "2026-08-31",
    fromCustodian: "Reception",
    toCustodian: "Home Treasury",
    amount: 80,
    receivedAmount: 80,
    acceptedAt: "2026-09-01 09:30",
    status: "Accepted",
    department: "Physio",
  };

  const beforeAcceptance = calculateCustodyPosition({
    scope: "physio",
    payments: [payment],
    expenses: [],
    salaryPayments: [],
    cashMovements: [handover],
    dateIncluded: through("2026-08-31"),
  });
  assert.equal(beforeAcceptance.reception, 100);
  assert.equal(beforeAcceptance.homeTreasury, 0);
  assert.equal(beforeAcceptance.total, 100);

  const afterAcceptance = calculateCustodyPosition({
    scope: "physio",
    payments: [payment],
    expenses: [],
    salaryPayments: [],
    cashMovements: [handover],
    dateIncluded: through("2026-09-01"),
  });
  assert.equal(afterAcceptance.reception, 20);
  assert.equal(afterAcceptance.homeTreasury, 80);
  assert.equal(afterAcceptance.total, 100);

  assert.equal(
    acceptedCashHandoverTotal({
      scope: "physio",
      cashMovements: [handover],
      dateIncluded: (date) => date.startsWith("2026-08"),
    }),
    0
  );
  assert.equal(
    acceptedCashHandoverTotal({
      scope: "physio",
      cashMovements: [handover],
      dateIncluded: (date) => date.startsWith("2026-09"),
    }),
    80
  );
});

test("cash movement reader preserves acceptance timestamps from both writer contracts", () => {
  const data = source("lib/data/index.ts");
  assert.match(data, /getHeaderIndex\(headers, "Accepted_At"\)/);
  assert.match(data, /getHeaderIndex\(headers, "Confirmed_At"\)/);
  assert.match(data, /getHeaderIndex\(headers, "Completed_At"\)/);
  assert.match(data, /acceptedAt \? \{ acceptedAt \} : \{\}/);
});
