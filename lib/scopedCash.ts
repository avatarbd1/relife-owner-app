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
import { requireCurrentTenantContext } from "@/lib/webos/currentUser";

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

const RELIFE_CANONICAL_ORGANIZATION = "relife";
const RELIFE_CANONICAL_CLINIC = "amtali-main";

function addPositions(
  left: ScopedCashPosition,
  right: ScopedCashPosition
): ScopedCashPosition {
  return {
    reception: left.reception + right.reception,
    homeTreasury: left.homeTreasury + right.homeTreasury,
    bank: left.bank + right.bank,
    total: left.total + right.total,
  };
}

/**
 * Tenant-aware finance read with a bounded Tenant #1 compatibility bridge.
 * RELIFE-PHYSIO / RELIFE-DENTAL are legacy Sheets ledger identities only;
 * they are accepted here only after canonical relife/amtali-main resolution.
 */
export async function getScopedCashPositionForTenantView(
  scope: Scope,
  now: Date,
  organizationId: string,
  clinicId: string
): Promise<ScopedCashPosition> {
  const isRelifeTenant =
    organizationId === RELIFE_CANONICAL_ORGANIZATION &&
    clinicId === RELIFE_CANONICAL_CLINIC;

  if (!isRelifeTenant) {
    return getScopedCashPosition(scope, now, organizationId, clinicId);
  }

  if (scope === "physio") {
    return getScopedCashPosition("physio", now, "RELIFE", "RELIFE-PHYSIO");
  }
  if (scope === "dental") {
    return getScopedCashPosition("dental", now, "RELIFE", "RELIFE-DENTAL");
  }

  const [physio, dental] = await Promise.all([
    getScopedCashPosition("physio", now, "RELIFE", "RELIFE-PHYSIO"),
    getScopedCashPosition("dental", now, "RELIFE", "RELIFE-DENTAL"),
  ]);
  return addPositions(physio, dental);
}

/**
 * Existing dashboard API retained during migration, but no longer injects a
 * fixed tenant. The authenticated staff tenant is mandatory and fail-closed.
 */
export async function getScopedCashPositionForAdminView(
  scope: Scope,
  now: Date = new Date()
): Promise<ScopedCashPosition> {
  const tenant = await requireCurrentTenantContext();
  return getScopedCashPositionForTenantView(
    scope,
    now,
    tenant.organizationId,
    tenant.clinicId
  );
}
