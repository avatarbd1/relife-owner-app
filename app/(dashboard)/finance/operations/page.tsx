import Link from "next/link";
import { cookies } from "next/headers";
import BulkExpenseApproval from "@/components/BulkExpenseApproval";
import FinanceOperationsClient from "@/components/FinanceOperationsClient";
import { getSalaryPayments, getStaff } from "@/lib/data";
import { getFinanceHistorySnapshot } from "@/lib/webos/financeHistory";
import { getFinanceOperationsSnapshot } from "@/lib/webos/financeOps";
import { actionsForRoles } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { resolveAuthorizedScope } from "@/lib/webos/scope";
import type { Scope } from "@/lib/types";

const SCOPE_LABEL: Record<Scope, string> = {
  combined: "Combined",
  physio: "Physio",
  dental: "Dental",
};

function monthDhaka(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function normalizedDate(value: string | undefined): string {
  return String(value || "").trim().slice(0, 10);
}

export default async function FinanceOperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const cookieStore = await cookies();
  const context = await requireCurrentAccessContext();
  const scope = resolveAuthorizedScope(context, cookieStore.get("relife_scope")?.value);
  const [snapshot, history, params] = await Promise.all([
    getFinanceOperationsSnapshot(context, scope),
    getFinanceHistorySnapshot(context, scope),
    searchParams,
  ]);
  const isOwner = context.roles.includes("Owner");
  const actions = new Set(actionsForRoles(context.roles));
  const canReadHistory =
    actions.has("expense.read") || actions.has("cash.read") || actions.has("salary.read");
  const canAcceptCash = actions.has("cash.accept");

  let enrichedStaff: Array<{
    staffId: string;
    fullName: string;
    department: "Physio" | "Dental" | "All";
    salary: number;
    paidThisMonth: number;
    remainingDue: number;
  }> = [];

  if (snapshot.capabilities.salaryPay) {
    const [staffMaster, salaryPayments] = await Promise.all([getStaff(), getSalaryPayments()]);
    const month = monthDhaka();
    const paymentsByStaff = new Map<string, number>();
    for (const row of salaryPayments) {
      if (!normalizedDate(row.paidAt || row.date).startsWith(month)) continue;
      const status = String(row.status || "Paid").trim().toLowerCase();
      if (status && status !== "paid") continue;
      paymentsByStaff.set(
        row.staffId,
        (paymentsByStaff.get(row.staffId) || 0) + Number(row.amount || 0)
      );
    }

    enrichedStaff = snapshot.staff.map((item) => {
      const master = staffMaster.find((row) => row.staffId === item.staffId);
      const salary = Number(master?.salary || 0);
      const paidThisMonth = paymentsByStaff.get(item.staffId) || 0;
      return {
        ...item,
        salary,
        paidThisMonth,
        remainingDue: Math.max(0, salary - paidThisMonth),
      };
    });
  }

  const safeSnapshot = snapshot.capabilities.salaryPay
    ? { ...snapshot, staff: enrichedStaff }
    : { ...snapshot, staff: [] };

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

  const validTabs = new Set(["payment", "expenses", "cash", "salary"]);
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
              Payment, expense, internal cash handover and salary remain separate ledger actions.
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
            <Link href="/finance/history" className="min-h-10 rounded-lg bg-white/10 px-3 py-2.5 font-medium text-white hover:bg-white/15">
              History
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
        history={history}
        initialTab={requestedTab as "payment" | "expenses" | "cash" | "salary" | undefined}
      />
    </div>
  );
}
