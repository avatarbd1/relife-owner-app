import "server-only";

import { randomUUID } from "node:crypto";
import { appendSheetValues, type Workbook } from "@/lib/data/googleSheets";

function nowDhaka(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

export async function recordExpenseRejectionReason(
  workbook: Workbook,
  expenseId: string,
  reason: string
): Promise<boolean> {
  const clean = String(reason || "").trim();
  if (!clean) return false;
  const department = workbook === "dental" ? "Dental" : "Physio";
  const clinic = workbook === "dental" ? "RELIFE-DENTAL" : "RELIFE-PHYSIO";
  const actor = process.env.OWNER_DISPLAY_NAME || "Owner";
  const timestamp = nowDhaka();
  try {
    await appendSheetValues(workbook, "'20_Data_Audit'!A:W", [[
      `AUD-${randomUUID()}`,
      timestamp,
      actor,
      "EXPENSE_REJECTION_REASON",
      "Expense",
      expenseId,
      "",
      "",
      "Rejected",
      clean,
      "RELIFE",
      clinic,
      "AMTALI-01",
      `${clinic}:${expenseId}`,
      "",
      actor,
      "owner_pwa",
      "owner_action",
      false,
      true,
      "relife-uda-v1",
      new Date().toISOString(),
      department,
    ]]);
    return true;
  } catch (error) {
    console.error("Expense rejection reason audit append failed", error);
    return false;
  }
}
