import Link from "next/link";
import { cookies } from "next/headers";
import { formatBDT } from "@/lib/format";
import type { Scope } from "@/lib/types";
import { getFinanceHistorySnapshot } from "@/lib/webos/financeHistory";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

function readScope(value: string | undefined): Scope {
  if (value === "physio" || value === "dental" || value === "combined") return value;
  return "combined";
}

const SCOPE_LABEL: Record<Scope, string> = {
  combined: "Combined",
  physio: "Physio",
  dental: "Dental",
};

function statusClass(status: string): string {
  const value = status.toLowerCase();
  if (["paid", "approved", "accepted", "completed"].includes(value)) return "bg-emerald-50 text-emerald-700";
  if (["rejected", "cancelled", "canceled"].includes(value)) return "bg-red-50 text-red-700";
  if (["pending", "requested", "approved_pending_payment"].includes(value)) return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

export default async function FinanceHistoryPage() {
  const [context, cookieStore] = await Promise.all([
    requireCurrentAccessContext(),
    cookies(),
  ]);
  const scope = readScope(cookieStore.get("relife_scope")?.value);
  const snapshot = await getFinanceHistorySnapshot(context, scope);
  const hasAny =
    snapshot.capabilities.expenseHistory ||
    snapshot.capabilities.cashHistory ||
    snapshot.capabilities.salaryHistory;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-slate-900 p-4 text-white shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">Telegram → Web finance parity</p>
            <h1 className="mt-1 text-lg font-semibold">হিসাব ও হিস্ট্রি</h1>
            <p className="mt-1 text-xs text-slate-300">{SCOPE_LABEL[scope]} · Expense Tracker · Rejected · Cash Movement · Salary History</p>
          </div>
          <Link href="/operations" className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white">Finance actions</Link>
        </div>
      </section>

      {!hasAny && (
        <section className="rounded-2xl bg-white p-5 text-sm text-slate-600 shadow-sm ring-1 ring-slate-200">
          এই account-এর জন্য finance history access নেই।
        </section>
      )}

      {snapshot.capabilities.expenseHistory && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">💸 ক্লিনিক খরচ হিসাব</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">07_Expenses · requested/approved/paid/rejected</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{snapshot.expenses.length}</span>
          </div>
          {snapshot.rejectedExpenses.length > 0 && (
            <div className="mt-3 rounded-xl bg-red-50 p-3 text-xs text-red-700">
              ❌ Rejected: {snapshot.rejectedExpenses.length}
            </div>
          )}
          <div className="mt-3 space-y-2">
            {snapshot.expenses.slice(0, 100).map((item) => (
              <div key={`${item.department}-${item.expenseId}`} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{item.category || item.expenseType}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{item.expenseId} · {item.department} · {item.date}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-900">{formatBDT(item.amount)}</p>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass(item.status)}`}>{item.status}</span>
                  </div>
                </div>
                {item.description && <p className="mt-2 text-xs leading-5 text-slate-600">{item.description}</p>}
                <p className="mt-1 text-[10px] text-slate-400">{item.expenseType}{item.paidFrom ? ` · ${item.paidFrom}` : ""}{item.paidBy ? ` · ${item.paidBy}` : ""}</p>
              </div>
            ))}
            {snapshot.expenses.length === 0 && <p className="py-5 text-center text-xs text-slate-400">Expense history নেই।</p>}
          </div>
        </section>
      )}

      {snapshot.capabilities.cashHistory && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">🔄 ক্যাশ হ্যান্ডওভার হিস্ট্রি</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">21_Cash_Movement · transfer, expense নয়</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{snapshot.cashMovements.length}</span>
          </div>
          <div className="mt-3 space-y-2">
            {snapshot.cashMovements.slice(0, 100).map((item) => (
              <div key={`${item.department}-${item.id}`} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{item.fromCustodian} → {item.toCustodian}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{item.id} · {item.department} · {item.date}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-900">{formatBDT(item.amount)}</p>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass(item.status)}`}>{item.status}</span>
                  </div>
                </div>
                {item.receivedAmount !== undefined && <p className="mt-1 text-[11px] text-slate-500">Received: {formatBDT(item.receivedAmount)}</p>}
                {item.remarks && <p className="mt-1 text-xs text-slate-600">{item.remarks}</p>}
              </div>
            ))}
            {snapshot.cashMovements.length === 0 && <p className="py-5 text-center text-xs text-slate-400">Cash movement history নেই।</p>}
          </div>
        </section>
      )}

      {snapshot.capabilities.salaryHistory && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">📜 বেতন হিস্টোরি</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">13_Salary · authorized read only</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{snapshot.salaryPayments.length}</span>
          </div>
          <div className="mt-3 space-y-2">
            {snapshot.salaryPayments.slice(0, 100).map((item) => (
              <div key={`${item.department}-${item.id}`} className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{item.staffName || item.staffId}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">{item.id} · {item.department} · {item.date} · {item.type}</p>
                  <p className="mt-1 text-[10px] text-slate-400">{item.paidFrom}{item.paidAt ? ` · ${item.paidAt}` : ""}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-900">{formatBDT(item.amount)}</p>
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass(item.status)}`}>{item.status}</span>
                </div>
              </div>
            ))}
            {snapshot.salaryPayments.length === 0 && <p className="py-5 text-center text-xs text-slate-400">Salary history নেই।</p>}
          </div>
        </section>
      )}
    </div>
  );
}
