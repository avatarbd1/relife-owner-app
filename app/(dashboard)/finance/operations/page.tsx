import Link from "next/link";
import { cookies } from "next/headers";
import BulkExpenseApproval from "@/components/BulkExpenseApproval";
import FinanceOperationsClient from "@/components/FinanceOperationsClient";
import { getFinanceHistorySnapshot } from "@/lib/webos/financeHistory";
import { getTenantFinanceOperationsSnapshot } from "@/lib/webos/tenantFinanceOps";
import { actionsForRoles } from "@/lib/webos/access";
import { hasTenantFeature, requireTenantFeature } from "@/lib/domain/tenancy/featureGuard";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { resolveAuthorizedScope } from "@/lib/webos/scope";
import type { Scope } from "@/lib/types";

const SCOPE_LABEL: Record<Scope, string> = {
  combined: "Combined",
  physio: "Physio",
  dental: "Dental",
};

export default async function FinanceOperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const cookieStore = await cookies();
  const tenantContext = await requireCurrentTenantAccessContext();
  const context = tenantContext.access;
  await requireTenantFeature(tenantContext.tenant, "core.finance_basic");
  const scope = resolveAuthorizedScope(context, cookieStore.get("relife_scope")?.value);
  const [snapshot, history, params, advancedFinanceEnabled, salaryEnabled] = await Promise.all([
    getTenantFinanceOperationsSnapshot(context, scope, tenantContext.tenant),
    getFinanceHistorySnapshot(context, scope, tenantContext.tenant),
    searchParams,
    hasTenantFeature(tenantContext.tenant, "optional.finance_advanced"),
    hasTenantFeature(tenantContext.tenant, "optional.salary"),
  ]);
  const isOwner = context.roles.includes("Owner");
  const actions = new Set(actionsForRoles(context.roles));
  const canReadHistory =
    actions.has("expense.read") ||
    (advancedFinanceEnabled && actions.has("cash.read")) ||
    (salaryEnabled && actions.has("salary.read"));
  const canAcceptCash = advancedFinanceEnabled && actions.has("cash.accept");
  const canOpenSalary = salaryEnabled && (actions.has("salary.read") || actions.has("salary.pay"));

  // Payroll has a dedicated reconciled workspace at /salary. Keep the mixed
  // operations client focused on payment, expense and optional cash workflows.
  const safeSnapshot = {
    ...snapshot,
    staff: [],
    capabilities: {
      ...snapshot.capabilities,
      cashRequest: advancedFinanceEnabled && snapshot.capabilities.cashRequest,
      salaryPay: false,
    },
  };

  const safeHistory = {
    ...history,
    cashMovements: advancedFinanceEnabled ? history.cashMovements : [],
    salaryPayments: [],
    capabilities: {
      ...history.capabilities,
      cashHistory: advancedFinanceEnabled && history.capabilities.cashHistory,
      salaryHistory: false,
    },
  };

  const pendingExpenses = isOwner
    ? history.expenses
        .filter((item) => {
          const status = String(item.status || "").trim().toLowerCase();
          return status === "pending" || status === "requested";
        })
        .map((item) => ({
          expenseId: item.expenseId,
          department: item.department,
          date: item.date,
          category: item.category,
          description: item.description,
          amount: item.amount,
        }))
    : [];

  const validTabs = new Set(advancedFinanceEnabled ? ["payment", "expenses", "cash"] : ["payment", "expenses"]);
  const requestedTab = validTabs.has(params.tab || "") ? params.tab : undefined;

  return (
    <div>
      <div className="mb-4 overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 to-blue-950 p-4 text-white shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">
              Finance operations · {SCOPE_LABEL[scope]}
            </p>
            <h1 className="mt-1 text-xl font-bold">Money workflows</h1>
            <p className="mt-1 max-w-xl text-xs leading-5 text-slate-300">
              Collections and clinic expense remain separate ledger actions. Cash handover and payroll appear only when those tenant features are enabled.
            </p>
          </div>
          {isOwner && (
            <Link
              href="/finance"
              className="min-h-10 shrink-0 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/10 hover:bg-white/15"
            >
              Dashboard
            </Link>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {canReadHistory && (
            <Link href="/finance/records" className="min-h-10 rounded-lg bg-white/10 px-3 py-2.5 font-medium text-white hover:bg-white/15">
              History
            </Link>
          )}
          {canOpenSalary && (
            <Link href="/salary" className="min-h-10 rounded-lg bg-emerald-500/15 px-3 py-2.5 font-medium text-emerald-100 ring-1 ring-emerald-400/20">
              Salary management
            </Link>
          )}
          {canAcceptCash && (
            <Link href="/finance/cash-receive" className="min-h-10 rounded-lg bg-emerald-500/15 px-3 py-2.5 font-medium text-emerald-100 ring-1 ring-emerald-400/20">
              Receive handover
            </Link>
          )}
          {isOwner && (
            <Link href="/finance#approvals" className="min-h-10 rounded-lg bg-amber-400/15 px-3 py-2.5 font-medium text-amber-100 ring-1 ring-amber-300/20">
              Owner approvals
            </Link>
          )}
        </div>
      </div>

      {isOwner && <BulkExpenseApproval items={pendingExpenses} />}

      <FinanceOperationsClient
        snapshot={safeSnapshot}
        history={safeHistory}
        initialTab={requestedTab as "payment" | "expenses" | "cash" | undefined}
      />
    </div>
  );
}
