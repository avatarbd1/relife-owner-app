"use server";

import { requestExpense as requestExpenseRaw } from "@/lib/domain/finance/expenses";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

export async function requestExpense(input: {
  department: "Physio" | "Dental";
  category: string;
  amount: number;
  note: string;
  requestId: string;
}) {
  const context = await requireCurrentAccessContext();
  const result = await requestExpenseRaw(context, input);
  return result;
}

export async function approveExpense(input: {
  department: "Physio" | "Dental";
  expenseId: string;
}) {
  const context = await requireCurrentAccessContext();
  // TODO: Implement approval logic once available in domain/finance
  // For now, this is a placeholder that will be filled in
  throw new Error("Expense approval API not yet available");
}

export async function rejectExpense(input: {
  department: "Physio" | "Dental";
  expenseId: string;
  reason: string;
}) {
  const context = await requireCurrentAccessContext();
  // TODO: Implement rejection logic once available in domain/finance
  throw new Error("Expense rejection API not yet available");
}

export async function requestCashMovement(input: {
  department: "Physio" | "Dental";
  movementType: string;
  amount: number;
  witness: string;
  remarks: string;
  requestId: string;
}) {
  const context = await requireCurrentAccessContext();
  // TODO: Implement cash movement request once available in domain/finance
  throw new Error("Cash movement API not yet available");
}
