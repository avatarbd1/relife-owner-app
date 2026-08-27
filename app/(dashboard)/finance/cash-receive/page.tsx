import Link from "next/link";
import { cookies } from "next/headers";
import CashAcceptanceClient from "@/components/CashAcceptanceClient";
import { StatusBadge } from "@/components/FeedbackUI";
import type { Scope } from "@/lib/types";
import { getPendingCashMovements } from "@/lib/webos/cashAcceptance";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { resolveAuthorizedScope } from "@/lib/webos/scope";

const LABEL: Record<Scope, string> = {
  combined: "Combined",
  physio: "Physio",
  dental: "Dental",
};

export default async function CashReceivePage() {
  const [context, cookieStore] = await Promise.all([
    requireCurrentAccessContext(),
    cookies(),
  ]);
  const scope = resolveAuthorizedScope(context, cookieStore.get("relife_scope")?.value);
  const movements = await getPendingCashMovements(context, scope);

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 to-blue-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">Finance · {LABEL[scope]}</p>
            <h1 className="mt-1 text-2xl font-bold">Receive cash handover</h1>
            <p className="mt-1 text-xs leading-5 text-slate-300">Pending cash movements require receiver confirmation of the actual amount.</p>
          </div>
          <StatusBadge tone={movements.length ? "warning" : "success"} className="border-white/10">{movements.length ? `${movements.length} pending` : "Clear"}</StatusBadge>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/finance/history" className="min-h-10 rounded-lg bg-white/10 px-3 py-2.5 text-xs font-semibold text-white hover:bg-white/15">History</Link>
          <Link href="/operations?tab=cash" className="min-h-10 rounded-lg bg-blue-400/15 px-3 py-2.5 text-xs font-semibold text-blue-100 ring-1 ring-blue-300/20">Cash workspace</Link>
        </div>
      </section>
      <CashAcceptanceClient movements={movements} />
    </div>
  );
}
