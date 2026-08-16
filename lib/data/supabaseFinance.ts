import "server-only";

import {
  RELIFE_SUPABASE_SCOPE,
  type RelifeDepartment,
} from "@/lib/config/relifeSystem";

export type FinanceDbMode = "sheets" | "shadow" | "supabase";
export type FinanceEntityType =
  | "Payment"
  | "Expense"
  | "CashMovement"
  | "SalaryPayment";

export interface FinanceOperationInput {
  requestId: string;
  action:
    | "finance.payment.create"
    | "finance.expense.request"
    | "finance.expense.approve"
    | "finance.expense.reject"
    | "finance.expense.pay"
    | "finance.cash.request"
    | "finance.cash.accept"
    | "finance.cash.reject"
    | "finance.salary.pay";
  entityType: FinanceEntityType;
  entityId: string;
  department: RelifeDepartment;
  status: string;
  amount?: number;
  actorId: string;
  patientId?: string;
  staffId?: string;
  payload?: Record<string, unknown>;
}

export interface FinanceOperationResult {
  entityId: string;
  status: string;
  duplicate?: boolean;
}

const DEFAULT_FINANCE_EDGE_URL =
  "https://zpixvkfvmqzhmdacsezj.supabase.co/functions/v1/relife-finance-api";

export function financeDbMode(): FinanceDbMode {
  const value = String(process.env.RELIFE_FINANCE_DB_MODE || "sheets")
    .trim()
    .toLowerCase();
  if (value === "shadow" || value === "supabase") return value;
  return "sheets";
}

export function financeSupabaseConfigured(): boolean {
  return Boolean(
    (process.env.RELIFE_SUPABASE_FINANCE_EDGE_URL || DEFAULT_FINANCE_EDGE_URL).trim() &&
      process.env.RELIFE_EDGE_SECRET?.trim()
  );
}

export async function recordFinanceOperation(
  input: FinanceOperationInput
): Promise<FinanceOperationResult> {
  const secret = process.env.RELIFE_EDGE_SECRET?.trim();
  if (!secret) throw new Error("SUPABASE_EDGE_SECRET_MISSING");
  const url = (
    process.env.RELIFE_SUPABASE_FINANCE_EDGE_URL || DEFAULT_FINANCE_EDGE_URL
  ).trim();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relife-server-key": secret,
      },
      body: JSON.stringify({
        action: "record",
        requestId: input.requestId,
        eventAction: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        department: input.department,
        status: input.status,
        amount: input.amount,
        actorId: input.actorId,
        patientId: input.patientId,
        staffId: input.staffId,
        payload: input.payload,
        organizationSlug: RELIFE_SUPABASE_SCOPE.organizationSlug,
        clinicSlug: RELIFE_SUPABASE_SCOPE.clinicSlug,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.ok) {
      const detail = String(result?.detail || result?.error || `HTTP ${response.status}`);
      const error = new Error(detail);
      (error as Error & { status?: number; payload?: unknown }).status = response.status;
      (error as Error & { status?: number; payload?: unknown }).payload = result;
      throw error;
    }
    return {
      entityId: String(result.entityId || input.entityId),
      status: String(result.status || input.status),
      duplicate: Boolean(result.duplicate),
    };
  } finally {
    clearTimeout(timeout);
  }
}
