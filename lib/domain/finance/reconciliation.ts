import type {
  CashMovement,
  Department,
  Expense,
  Payment,
  SalaryPayment,
  Scope,
} from "../../types.ts";
import {
  isAcceptedCashMovementStatus,
  isPaidLedgerStatus,
} from "./policy.ts";

export type CashCustodian = "Reception" | "HomeTreasury" | "Bank";

export interface ReconciledCashPosition {
  reception: number;
  homeTreasury: number;
  bank: number;
  total: number;
}

export interface SalaryReconciliation {
  fixedCommitment: number;
  ledgerPaid: number;
  remainingDue: number;
  excessPaid: number;
}

export function financeScopeAllowsDepartment(
  scope: Scope,
  department: Department | string
): department is "Physio" | "Dental" {
  if (department !== "Physio" && department !== "Dental") return false;
  if (scope === "combined") return true;
  return department === (scope === "physio" ? "Physio" : "Dental");
}

export function normalizeCashCustodian(
  value: string | undefined
): CashCustodian | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    ["reception", "physio reception cash", "dental reception cash"].includes(
      normalized
    )
  ) {
    return "Reception";
  }
  if (normalized === "home treasury") return "HomeTreasury";
  if (["bank", "digital/bank", "digital"].includes(normalized)) return "Bank";
  return null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function applyDelta(
  position: ReconciledCashPosition,
  custodian: CashCustodian | null,
  amount: number
): void {
  if (custodian === "Reception") position.reception += amount;
  else if (custodian === "HomeTreasury") position.homeTreasury += amount;
  else if (custodian === "Bank") position.bank += amount;
}

function normalizedDate(value: string | undefined): string {
  return String(value || "").trim().slice(0, 10);
}

export function effectiveExpensePaidDate(row: {
  date: string;
  paidAt?: string;
}): string {
  return normalizedDate(row.paidAt || row.date);
}

export function effectiveSalaryPaidDate(row: {
  date: string;
  paidAt?: string;
}): string {
  return normalizedDate(row.paidAt || row.date);
}

export function effectiveCashMovementDate(row: {
  date: string;
  acceptedAt?: string;
}): string {
  return normalizedDate(row.acceptedAt || row.date);
}

export function calculateCustodyPosition(input: {
  scope: Scope;
  payments: Payment[];
  expenses: Expense[];
  salaryPayments: SalaryPayment[];
  cashMovements: CashMovement[];
  dateIncluded: (date: string) => boolean;
}): ReconciledCashPosition {
  const position: ReconciledCashPosition = {
    reception: 0,
    homeTreasury: 0,
    bank: 0,
    total: 0,
  };

  for (const payment of input.payments) {
    if (!financeScopeAllowsDepartment(input.scope, payment.department)) continue;
    if (!input.dateIncluded(normalizedDate(payment.date))) continue;
    applyDelta(
      position,
      payment.paymentMethod === "Cash" ? "Reception" : "Bank",
      payment.amount
    );
  }

  for (const expense of input.expenses) {
    if (!financeScopeAllowsDepartment(input.scope, expense.department)) continue;
    if (!isPaidLedgerStatus(expense.status)) continue;
    if (!input.dateIncluded(effectiveExpensePaidDate(expense))) continue;
    applyDelta(
      position,
      normalizeCashCustodian(expense.paidFrom || expense.paymentMethod),
      -expense.amount
    );
  }

  for (const salary of input.salaryPayments) {
    if (!financeScopeAllowsDepartment(input.scope, salary.department)) continue;
    const paidDate = effectiveSalaryPaidDate(salary);
    if (!input.dateIncluded(paidDate)) continue;
    if (!isPaidLedgerStatus(salary.status)) continue;
    applyDelta(
      position,
      normalizeCashCustodian(salary.paidFrom),
      -salary.amount
    );
  }

  for (const movement of input.cashMovements) {
    if (!financeScopeAllowsDepartment(input.scope, movement.department)) continue;
    if (!isAcceptedCashMovementStatus(movement.status)) continue;
    if (!input.dateIncluded(effectiveCashMovementDate(movement))) continue;
    const amount = movement.receivedAmount ?? movement.amount;
    applyDelta(
      position,
      normalizeCashCustodian(movement.fromCustodian),
      -amount
    );
    applyDelta(
      position,
      normalizeCashCustodian(movement.toCustodian),
      amount
    );
  }

  position.reception = roundMoney(position.reception);
  position.homeTreasury = roundMoney(position.homeTreasury);
  position.bank = roundMoney(position.bank);
  position.total = roundMoney(
    position.reception + position.homeTreasury + position.bank
  );
  return position;
}

export function acceptedCashHandoverTotal(input: {
  scope: Scope;
  cashMovements: CashMovement[];
  dateIncluded: (date: string) => boolean;
}): number {
  return roundMoney(
    input.cashMovements.reduce((sum, movement) => {
      if (!financeScopeAllowsDepartment(input.scope, movement.department)) {
        return sum;
      }
      if (!isAcceptedCashMovementStatus(movement.status)) return sum;
      if (!input.dateIncluded(effectiveCashMovementDate(movement))) return sum;
      return sum + (movement.receivedAmount ?? movement.amount);
    }, 0)
  );
}

export function reconcileSalaryTotals(
  fixedCommitmentInput: number,
  ledgerPaidInput: number
): SalaryReconciliation {
  const fixedCommitment = Math.max(0, Number(fixedCommitmentInput) || 0);
  const ledgerPaid = Math.max(0, Number(ledgerPaidInput) || 0);
  return {
    fixedCommitment: roundMoney(fixedCommitment),
    ledgerPaid: roundMoney(ledgerPaid),
    remainingDue: roundMoney(Math.max(0, fixedCommitment - ledgerPaid)),
    excessPaid: roundMoney(Math.max(0, ledgerPaid - fixedCommitment)),
  };
}
