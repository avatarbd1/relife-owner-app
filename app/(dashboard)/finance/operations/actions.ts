"use server";

import { decideExpense } from "@/lib/domain/finance/production";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import type { Workbook } from "@/lib/data/googleSheets";

interface BulkApprovalResult {
  success: number;
  failed: number;
  errors: Record<string, string>;
}

export async function bulkApproveExpenses(
  expenseIds: string[],
  workbook: Workbook
): Promise<BulkApprovalResult> {
  const context = await requireCurrentAccessContext();
  const result: BulkApprovalResult = { success: 0, failed: 0, errors: {} };

  for (const expenseId of expenseIds) {
    try {
      await decideExpense({
        workbook,
        expenseId,
        decision: "approve",
        actorId: context.userId || "Owner",
      });
      result.success++;
    } catch (error) {
      result.failed++;
      result.errors[expenseId] = error instanceof Error ? error.message : "Unknown error";
    }
  }

  return result;
}

export async function bulkRejectExpenses(
  expenseIds: string[],
  workbook: Workbook,
  reason: string
): Promise<BulkApprovalResult> {
  const context = await requireCurrentAccessContext();
  const result: BulkApprovalResult = { success: 0, failed: 0, errors: {} };

  if (!reason.trim()) {
    throw new Error("Rejection reason required");
  }

  for (const expenseId of expenseIds) {
    try {
      await decideExpense({
        workbook,
        expenseId,
        decision: "reject",
        actorId: context.userId || "Owner",
        reason: reason.trim(),
      });
      result.success++;
    } catch (error) {
      result.failed++;
      result.errors[expenseId] = error instanceof Error ? error.message : "Unknown error";
    }
  }

  return result;
}
