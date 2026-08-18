"use server";

import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { assertCanPerform } from "@/lib/webos/access";

export async function recordSalaryPayment(input: {
  staffId: string;
  department: "Physio" | "Dental";
  amount: number;
  paymentDate: string;
  paymentMethod: "Reception" | "Home Treasury" | "Bank";
  notes: string;
}) {
  const context = await requireCurrentAccessContext();
  assertCanPerform(context, "salary.pay", input.department);

  // TODO: Implement salary payment recording once API is available
  // For now, return a mock result
  return {
    id: `SAL-${Date.now()}`,
    staffId: input.staffId,
    amount: input.amount,
    date: input.paymentDate,
    status: "recorded",
  };
}
