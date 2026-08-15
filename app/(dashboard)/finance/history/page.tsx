import Link from "next/link";
import { cookies } from "next/headers";
import FinanceHistoryClient from "@/components/FinanceHistoryClient";
import { StatusBadge } from "@/components/FeedbackUI";
import { getScopedCashPosition } from "@/lib/scopedCash";
import type { Scope } from "@/lib/types";
import { canPerform } from "@/lib/webos/access";
import { getFinanceHistorySnapshot } from "@/lib/webos/financeHistory";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { resolveAuthorizedScope } from "@/lib/webos/scope";

const SCOPE_LABEL: Record<Scope, string> = {
  combined: "Combined",
  physio: "Physio",
  dental: "Dental",
};

export default async function FinanceHistoryPage() {
  const [context, cookieStore] = await Promise.all([
    requireCurrentAccessContext(),
    cookies(),
  ]);
  const scope = resolveAuthorizedScope(context, cookieStore.get("relife_scope")?.value);
  const snapshot = await getFinanceHistorySnapshot(context, scope);
  const receptionLimited = snapshot.capabilities.receptionLimited;
  const canReadCash = !receptionLimited && ["Physio", "Dental"].some((department) =>
    canPerform(context, "cash.read", department as "Physio" | "Dental")
  );
  const cashPosition = canReadCash ? await getScopedCashPosition(scope) : null;

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 to-blue-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">
              {receptionLimited ? "Reception finance" : "Finance evidence"}
            </p>
            <h1 className="mt-1 text-2xl font-bold">Transaction history</h1>
            <p className="mt-1 text-xs leading-5 text-slate-300">
              {SCOPE_LABEL[scope]} · expenses, internal cash movements and payroll remain separate.
            </p>
          </div>
          <StatusBadge tone="info" className="border-white/10">Live ledger</StatusBadge>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/operations" className="min-h-10 rounded-lg bg-white/10 px-3 py-2.5 text-xs font-semibold text-white hover:bg-white/15">Finance actions</Link>
          {!receptionLimited && <Link href="/finance" className="min-h-10 rounded-lg bg-blue-400/15 px-3 py-2.5 text-xs font-semibold text-blue-100 ring-1 ring-blue-300/20">Owner dashboard</Link>}
        </div>
      </section>

      <FinanceHistoryClient snapshot={snapshot} cashPosition={cashPosition} />
    </div>
  );
}
