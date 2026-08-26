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
import {
  calculateCustodyPosition,
  type ReconciledCashPosition,
} from "@/lib/domain/finance/reconciliation";
import type { Scope } from "@/lib/types";

export type ScopedCashPosition = ReconciledCashPosition;

export async function getScopedCashPosition(
  scope: Scope,
  now: Date = new Date(),
  organizationId: string,
  clinicId: string
): Promise<ScopedCashPosition> {
  const movements = await getCashMovements(organizationId, clinicId);

  if (!IS_LIVE_DATA) {
    const position: ScopedCashPosition = {
      reception: 0,
      homeTreasury: 0,
      bank: 0,
      total: 0,
    };
    for (const movement of movements as unknown as Array<{
      bucket?: string;
      amount: number;
    }>) {
      if (movement.bucket === "Reception") position.reception += movement.amount;
      else if (movement.bucket === "HomeTreasury")
        position.homeTreasury += movement.amount;
      else if (movement.bucket === "Bank") position.bank += movement.amount;
    }
    position.total = position.reception + position.homeTreasury + position.bank;
    return position;
  }

  const [payments, expenses, salaryPayments] = await Promise.all([
    getPayments(organizationId, clinicId),
    getExpenses(organizationId, clinicId),
    getSalaryPayments(organizationId, clinicId),
  ]);
  const asOfBusinessDate = cashBusinessDate(now);

  return calculateCustodyPosition({
    scope,
    payments,
    expenses,
    salaryPayments,
    cashMovements: movements,
    dateIncluded: (date) => isCashCustodyLedgerDate(date, asOfBusinessDate),
  });
}

export async function getScopedCashPositionForAdminView(
  scope: Scope,
  now: Date = new Date()
): Promise<ScopedCashPosition> {
  const clinic = scope === "dental" ? "RELIFE-DENTAL" : "RELIFE-PHYSIO";
  return getScopedCashPosition(scope, now, "RELIFE", clinic);
}
