import "server-only";

import { hasPrivateSheetsCredentials, type Workbook } from "@/lib/data/googleSheets";
import {
  decideCashMovement as decideCashMovementInDomain,
  listPendingCashMovements,
  type PendingCashMovement,
} from "@/lib/domain/finance/cash";
import {
  decideExpense as decideExpenseInDomain,
  listPendingExpenses,
  type PendingExpense,
} from "@/lib/domain/finance/expenses";

export type PendingExpenseControl = PendingExpense;
export type PendingCashControl = PendingCashMovement;

export interface OwnerControlSnapshot {
  privateSheets: boolean;
  writeEnabled: boolean;
  pendingExpenses: PendingExpenseControl[];
  pendingCashMovements: PendingCashControl[];
}

function actorName(): string {
  return process.env.OWNER_DISPLAY_NAME || "Owner";
}

function ensureWriteConfiguration(): void {
  if (!hasPrivateSheetsCredentials()) {
    throw new Error("CONTROL_CONFIG_PRIVATE_SHEETS");
  }
  if (process.env.NODE_ENV === "production") {
    if (!process.env.OWNER_PIN) throw new Error("CONTROL_CONFIG_OWNER_PIN");
    if (!process.env.SESSION_SECRET) throw new Error("CONTROL_CONFIG_SESSION_SECRET");
  }
}

export async function getOwnerControlSnapshot(): Promise<OwnerControlSnapshot> {
  const privateSheets = hasPrivateSheetsCredentials();
  const writeEnabled =
    privateSheets &&
    (process.env.NODE_ENV !== "production" ||
      Boolean(process.env.OWNER_PIN && process.env.SESSION_SECRET));

  if (!privateSheets) {
    return {
      privateSheets,
      writeEnabled: false,
      pendingExpenses: [],
      pendingCashMovements: [],
    };
  }

  try {
    const [pendingExpenses, pendingCashMovements] = await Promise.all([
      listPendingExpenses(),
      listPendingCashMovements(),
    ]);
    return {
      privateSheets,
      writeEnabled,
      pendingExpenses,
      pendingCashMovements,
    };
  } catch (error) {
    console.error("Owner control snapshot failed:", error);
    if (process.env.NODE_ENV === "production") {
      throw new Error("LIVE_DATA_UNAVAILABLE:owner_controls");
    }
    return {
      privateSheets,
      writeEnabled: false,
      pendingExpenses: [],
      pendingCashMovements: [],
    };
  }
}

/** @deprecated Use lib/domain/finance/expenses directly. */
export async function decideExpense(
  workbook: Workbook,
  id: string,
  decision: "approve" | "reject"
): Promise<void> {
  ensureWriteConfiguration();
  if (decision === "reject") throw new Error("REJECTION_REASON_REQUIRED");
  await decideExpenseInDomain({
    workbook,
    expenseId: id,
    decision,
    actorId: actorName(),
  });
}

/** @deprecated Use lib/domain/finance/cash directly. */
export async function decideCashMovement(
  workbook: Workbook,
  id: string,
  decision: "accept" | "reject",
  receivedAmount?: number
): Promise<void> {
  ensureWriteConfiguration();
  await decideCashMovementInDomain({
    workbook,
    movementId: id,
    decision,
    receivedAmount,
    actorId: actorName(),
  });
}
