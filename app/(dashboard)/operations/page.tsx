import Link from "next/link";
import { cookies } from "next/headers";
import FinanceOperationsClient from "@/components/FinanceOperationsClient";
import { getFinanceOperationsSnapshot } from "@/lib/webos/financeOps";
import { actionsForRoles } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import type { Scope } from "@/lib/types";

function readScope(value: string | undefined): Scope {
  if (value === "physio" || value === "dental" || value === "combined") return value;
  return "combined";
}

const SCOPE_LABEL: Record<Scope, string> = {
  combined: "Combined",
  physio: "Physio",
  dental: "Dental",
};

export default async function OperationsPage() {
  const cookieStore = await cookies();
  const scope = readScope(cookieStore.get("relife_scope")?.value);
  const context = await requireCurrentAccessContext();
  const snapshot = await getFinanceOperationsSnapshot(context, scope);
  const isOwner = context.roles.includes("Owner");
  const actions = new Set(actionsForRoles(context.roles));
  const canReadHistory =
    actions.has("expense.read") || actions.has("cash.read") || actions.has("salary.read");
  const canAcceptCash = actions.has("cash.accept");
  const safeSnapshot = snapshot.capabilities.salaryPay
    ? snapshot
    : { ...snapshot, staff: [] };

  return (
    <div>
      <div className="mb-4 rounded-2xl bg-slate-900 p-4 text-white">
        <p className="text-[11px] uppercase tracking-wide text-slate-400">Telegram → Web · Finance</p>
        <h2 className="mt-1 text-lg font-semibold">Finance Operations</h2>
        <p className="mt-1 text-xs text-slate-300">
          Scope: {SCOPE_LABEL[scope]} · Payment, expense, cash custody এবং salary operational write
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {isOwner && (
            <>
              <Link href="/finance" className="rounded-lg bg-white/10 px-3 py-2">Finance dashboard</Link>
              <Link href="/more" className="rounded-lg bg-white/10 px-3 py-2">Owner approvals</Link>
            </>
          )}
          {canReadHistory && (
            <Link href="/finance/history" className="rounded-lg bg-white/10 px-3 py-2">📜 History</Link>
          )}
          {canAcceptCash && (
            <Link href="/finance/cash-receive" className="rounded-lg bg-emerald-500/20 px-3 py-2 text-emerald-200">✅ হ্যান্ডওভার গ্রহণ</Link>
          )}
        </div>
      </div>

      <FinanceOperationsClient snapshot={safeSnapshot} />
    </div>
  );
}
