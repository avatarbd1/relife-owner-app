import "server-only";

import {
  IS_LIVE_DATA,
  getPayments,
  getExpenses,
  getSalaryPayments,
  getCashMovements,
} from "@/lib/data";
import {
  cashBusinessDate,
  isCashCustodyLedgerDate,
} from "@/lib/domain/finance/cashBusinessDay";
import type { Scope } from "@/lib/types";

export interface ScopedCashPosition {
  reception: number;
  homeTreasury: number;
  bank: number;
  total: number;
}

type Custodian = "Reception" | "HomeTreasury" | "Bank";

function normalizedDate(value: string | undefined): string {
  return String(value || "").trim().slice(0, 10);
}

function isPaid(status: string | undefined): boolean {
  const value = String(status || "").trim().toLowerCase();
  return value === "" || value === "paid";
}

function effectivePaidDate(row: { date: string; paidAt?: string }): string {
  return normalizedDate(row.paidAt || row.date);
}

function normalizeCustodian(value: string | undefined): Custodian | null {
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

function scopeAllowsDepartment(scope: Scope, department: string): boolean {
  if (department === "All") return false;
  if (scope === "combined") return department === "Physio" || department === "Dental";
  return department === (scope === "physio" ? "Physio" : "Dental");
}

function applyDelta(position: ScopedCashPosition, custodian: Custodian | null, amount: number) {
  if (custodian === "Reception") position.reception += amount;
  else if (custodian === "HomeTreasury") position.homeTreasury += amount;
  else if (custodian === "Bank") position.bank += amount;
}

export async function getScopedCashPosition(
  scope: Scope,
  now: Date = new Date()
): Promise<ScopedCashPosition> {
  const position: ScopedCashPosition = {
    reception: 0,
    homeTreasury: 0,
    bank: 0,
    total: 0,
  };

  const movements = await getCashMovements();

  if (!IS_LIVE_DATA) {
    for (const movement of movements as unknown as Array<{
      bucket?: string;
      amount: number;
    }>) {
      if (movement.bucket === "Reception") position.reception += movement.amount;
      else if (movement.bucket === "HomeTreasury") position.homeTreasury += movement.amount;
      else if (movement.bucket === "Bank") position.bank += movement.amount;
    }
    position.total = position.reception + position.homeTreasury + position.bank;
    return position;
  }

  const [payments, expenses, salaryPayments] = await Promise.all([
    getPayments(),
    getExpenses(),
    getSalaryPayments(),
  ]);
  const asOfBusinessDate = cashBusinessDate(now);
  const inCustodyLedgerToDate = (date: string) =>
    isCashCustodyLedgerDate(normalizedDate(date), asOfBusinessDate);

  for (const payment of payments) {
    if (!scopeAllowsDepartment(scope, payment.department)) continue;
    if (!inCustodyLedgerToDate(payment.date)) continue;
    applyDelta(
      position,
      payment.paymentMethod === "Cash" ? "Reception" : "Bank",
      payment.amount
    );
  }

  for (const expense of expenses) {
    if (!scopeAllowsDepartment(scope, expense.department)) continue;
    if (!inCustodyLedgerToDate(expense.date) || !isPaid(expense.status)) continue;
    applyDelta(
      position,
      normalizeCustodian(expense.paidFrom || expense.paymentMethod),
      -expense.amount
    );
  }

  for (const salary of salaryPayments) {
    if (!scopeAllowsDepartment(scope, salary.department)) continue;
    if (!inCustodyLedgerToDate(effectivePaidDate(salary)) || !isPaid(salary.status)) continue;
    applyDelta(position, normalizeCustodian(salary.paidFrom), -salary.amount);
  }

  for (const movement of movements) {
    if (!scopeAllowsDepartment(scope, movement.department)) continue;
    if (!inCustodyLedgerToDate(movement.date)) continue;
    if (String(movement.status || "").trim().toLowerCase() !== "accepted") continue;
    const amount = movement.receivedAmount ?? movement.amount;
    applyDelta(position, normalizeCustodian(movement.fromCustodian), -amount);
    applyDelta(position, normalizeCustodian(movement.toCustodian), amount);
  }

  position.reception = Math.round(position.reception * 100) / 100;
  position.homeTreasury = Math.round(position.homeTreasury * 100) / 100;
  position.bank = Math.round(position.bank * 100) / 100;
  position.total = Math.round(
    (position.reception + position.homeTreasury + position.bank) * 100
  ) / 100;
  return position;
}
