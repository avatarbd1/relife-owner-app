import "server-only";

import {
  departmentForWorkbook,
  type RelifeDepartment,
} from "@/lib/config/relifeSystem";
import {
  financeDbMode,
  financeSupabaseConfigured,
  recordFinanceOperation,
  type FinanceOperationInput,
} from "@/lib/data/supabaseFinance";
import {
  fetchSheetRanges,
  type Workbook,
} from "@/lib/data/googleSheets";
import {
  createPayment as createSheetsPayment,
  type PaymentCreateInput,
} from "@/lib/domain/finance/payments";
import {
  decideExpense as decideSheetsExpense,
  payApprovedExpense as paySheetsApprovedExpense,
  requestExpense as requestSheetsExpense,
  type ExpenseDecision,
  type ExpensePayInput,
  type ExpenseRequestInput,
} from "@/lib/domain/finance/expenses";
import {
  decideCashMovement as decideSheetsCashMovement,
  requestCashMovement as requestSheetsCashMovement,
  type CashDecision,
  type CashRequestInput,
} from "@/lib/domain/finance/cash";
import {
  paySalary as paySheetsSalary,
  type SalaryPayInput,
} from "@/lib/domain/finance/salary";
import type { AccessContext } from "@/lib/webos/access";
import { getWebStaffDirectory } from "@/lib/webos/staffDirectory";
import { withMutationLock } from "@/lib/webos/mutationLock";

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase();
}

function departmentFromPatientId(patientId: string): RelifeDepartment {
  const id = normalize(patientId).toUpperCase();
  if (id.startsWith("PT")) return "Physio";
  if (id.startsWith("DT")) return "Dental";
  throw new Error("INVALID_PATIENT_ID");
}

function safeRequestPart(value: string): string {
  const part = normalize(value).replace(/[^A-Za-z0-9_-]/g, "_");
  if (!part) throw new Error("INVALID_REQUEST_ID");
  return part.slice(0, 80);
}

async function syncFinance(input: FinanceOperationInput): Promise<void> {
  const mode = financeDbMode();
  if (mode === "sheets") return;

  if (!financeSupabaseConfigured()) {
    if (mode === "shadow") {
      console.error("Finance Supabase shadow skipped: SUPABASE_EDGE_SECRET_MISSING");
      return;
    }
    throw new Error("FINANCE_DB_UNAVAILABLE");
  }

  try {
    await recordFinanceOperation(input);
  } catch (error) {
    if (mode === "shadow") {
      console.error("Finance Supabase shadow write failed:", error);
      return;
    }
    console.error("Finance Supabase production write failed:", error);
    throw new Error("FINANCE_DB_UNAVAILABLE");
  }
}

async function currentSheetStatus(input: {
  workbook: Workbook;
  sheet: "07_Expenses" | "21_Cash_Movement";
  idHeader: "Expense_ID" | "Movement_ID";
  id: string;
}): Promise<string> {
  const snapshot = await fetchSheetRanges(input.workbook, [input.sheet]);
  const rows = snapshot[input.sheet] || [];
  if (rows.length < 2) return "";
  const headers = rows[0].map(normalized);
  const idIdx = headers.indexOf(input.idHeader.toLowerCase());
  const statusIdx = headers.indexOf("status");
  if (idIdx < 0 || statusIdx < 0) return "";
  const row = rows
    .slice(1)
    .find((item) => normalize(item[idIdx]) === normalize(input.id));
  return row ? normalize(row[statusIdx]) : "";
}

export async function createPayment(
  context: AccessContext,
  input: PaymentCreateInput
): Promise<{ receiptNo: string; due: number; duplicate: boolean }> {
  const patientId = normalize(input.patientId).toUpperCase();
  const department = departmentFromPatientId(patientId);
  return withMutationLock(`finance:payment:${department}:${patientId}`, async () => {
    const result = await createSheetsPayment(context, { ...input, patientId });
    await syncFinance({
      requestId: input.requestId,
      action: "finance.payment.create",
      entityType: "Payment",
      entityId: result.receiptNo,
      department,
      status: result.due <= 0 ? "Paid" : "Due",
      amount: Number(input.amount),
      actorId: context.staffId,
      patientId,
      payload: {
        discount: Number(input.discount || 0),
        due: result.due,
        paymentMethod: input.paymentMethod,
        sessions: Number(input.sessions || 0),
        sessionType: normalize(input.sessionType),
        sheetsDuplicate: result.duplicate,
      },
    });
    return result;
  });
}

export async function requestExpense(
  context: AccessContext,
  input: ExpenseRequestInput
): Promise<{ expenseId: string; duplicate: boolean }> {
  const result = await requestSheetsExpense(context, input);
  await syncFinance({
    requestId: input.requestId,
    action: "finance.expense.request",
    entityType: "Expense",
    entityId: result.expenseId,
    department: input.department,
    status: "Pending",
    amount: Number(input.amount),
    actorId: context.staffId,
    payload: {
      category: normalize(input.category),
      expenseType: input.expenseType || "Clinic Expense",
      note: normalize(input.note),
      sheetsDuplicate: result.duplicate,
    },
  });
  return result;
}

export async function decideExpense(input: {
  workbook: Workbook;
  expenseId: string;
  decision: ExpenseDecision;
  actorId: string;
  reason?: string;
}): Promise<void> {
  const expected = input.decision === "approve" ? "Approved" : "Rejected";
  let duplicate = false;
  try {
    await decideSheetsExpense(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message !== "CONTROL_ALREADY_DECIDED" || financeDbMode() === "sheets") throw error;
    const actual = await currentSheetStatus({
      workbook: input.workbook,
      sheet: "07_Expenses",
      idHeader: "Expense_ID",
      id: input.expenseId,
    });
    if (normalized(actual) !== normalized(expected)) throw error;
    duplicate = true;
  }

  await syncFinance({
    requestId: `FINEXDEC_${safeRequestPart(input.expenseId)}_${input.decision}`,
    action:
      input.decision === "approve"
        ? "finance.expense.approve"
        : "finance.expense.reject",
    entityType: "Expense",
    entityId: input.expenseId,
    department: departmentForWorkbook(input.workbook),
    status: expected,
    actorId: input.actorId,
    payload: {
      reason: normalize(input.reason),
      sheetsDuplicate: duplicate,
    },
  });
}

export async function payApprovedExpense(
  context: AccessContext,
  input: ExpensePayInput
): Promise<{ alreadyPaid: boolean }> {
  const result = await paySheetsApprovedExpense(context, input);
  await syncFinance({
    requestId: `FINEXPAY_${safeRequestPart(input.expenseId)}`,
    action: "finance.expense.pay",
    entityType: "Expense",
    entityId: input.expenseId,
    department: input.department,
    status: "Paid",
    actorId: context.staffId,
    payload: {
      paidFrom: input.paidFrom,
      sheetsDuplicate: result.alreadyPaid,
    },
  });
  return result;
}

export async function requestCashMovement(
  context: AccessContext,
  input: CashRequestInput
): Promise<{ movementId: string; duplicate: boolean }> {
  const result = await requestSheetsCashMovement(context, input);
  await syncFinance({
    requestId: input.requestId,
    action: "finance.cash.request",
    entityType: "CashMovement",
    entityId: result.movementId,
    department: input.department,
    status: "Pending",
    amount: Number(input.amount),
    actorId: context.staffId,
    payload: {
      fromCustodian: "Reception",
      toCustodian: input.toCustodian,
      note: normalize(input.note),
      sheetsDuplicate: result.duplicate,
    },
  });
  return result;
}

export async function decideCashMovement(input: {
  workbook: Workbook;
  movementId: string;
  decision: CashDecision;
  actorId: string;
  receivedAmount?: number;
}): Promise<void> {
  const expected = input.decision === "accept" ? "Accepted" : "Rejected";
  let duplicate = false;
  try {
    await decideSheetsCashMovement(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message !== "CONTROL_ALREADY_DECIDED" || financeDbMode() === "sheets") throw error;
    const actual = await currentSheetStatus({
      workbook: input.workbook,
      sheet: "21_Cash_Movement",
      idHeader: "Movement_ID",
      id: input.movementId,
    });
    if (normalized(actual) !== normalized(expected)) throw error;
    duplicate = true;
  }

  await syncFinance({
    requestId: `FINCMDEC_${safeRequestPart(input.movementId)}_${input.decision}`,
    action:
      input.decision === "accept"
        ? "finance.cash.accept"
        : "finance.cash.reject",
    entityType: "CashMovement",
    entityId: input.movementId,
    department: departmentForWorkbook(input.workbook),
    status: expected,
    amount: input.receivedAmount,
    actorId: input.actorId,
    payload: {
      receivedAmount: input.receivedAmount,
      sheetsDuplicate: duplicate,
    },
  });
}

export async function paySalary(
  context: AccessContext,
  input: SalaryPayInput
): Promise<{ paymentId: string; duplicate: boolean }> {
  const result = await paySheetsSalary(context, input);
  const directory = await getWebStaffDirectory();
  const staff = directory.find(
    (item) => item.staffId === normalize(input.staffId) && item.status === "Active"
  );
  if (!staff) throw new Error("STAFF_NOT_FOUND");
  if (staff.primaryDepartment !== "Physio" && staff.primaryDepartment !== "Dental") {
    throw new Error("STAFF_DEPARTMENT_UNSUPPORTED");
  }
  await syncFinance({
    requestId: input.requestId,
    action: "finance.salary.pay",
    entityType: "SalaryPayment",
    entityId: result.paymentId,
    department: staff.primaryDepartment,
    status: "Paid",
    amount: Number(input.amount),
    actorId: context.staffId,
    staffId: normalize(input.staffId),
    payload: {
      paidFrom: input.paidFrom,
      note: normalize(input.note),
      sheetsDuplicate: result.duplicate,
    },
  });
  return result;
}
