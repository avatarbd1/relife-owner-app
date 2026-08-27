import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import OwnerControlsClient from "@/components/OwnerControlsClient";
import { StatusBadge } from "@/components/FeedbackUI";
import { getOwnerControlSnapshot } from "@/lib/controls";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { resolveAuthorizedScope } from "@/lib/webos/scope";

export default async function FinanceApprovalsPage() {
  const [context, cookieStore] = await Promise.all([requireCurrentAccessContext(), cookies()]);
  if (!context.roles.includes("Owner")) redirect("/finance/records");
  const scope = resolveAuthorizedScope(context, cookieStore.get("relife_scope")?.value);
  const controls = await getOwnerControlSnapshot();
  const snapshot = {
    ...controls,
    pendingExpenses: controls.pendingExpenses.filter((item) => scope === "combined" || item.workbook === scope),
    pendingCashMovements: controls.pendingCashMovements.filter((item) => scope === "combined" || item.workbook === scope),
  };
  const total = snapshot.pendingExpenses.length + snapshot.pendingCashMovements.length;

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 to-amber-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200">Owner finance</p><h1 className="mt-1 text-2xl font-bold">Approvals</h1><p className="mt-1 text-xs leading-5 text-slate-300">Expense decisions and cash receiver confirmation stay outside routine history browsing.</p></div><StatusBadge tone={total ? "warning" : "success"} className="border-white/10">{total ? `${total} pending` : "Up to date"}</StatusBadge></div>
        <div className="mt-4 flex gap-2"><Link href="/finance/records" className="min-h-10 rounded-lg bg-white/10 px-3 py-2.5 text-xs font-semibold text-white">Finance records</Link><Link href="/finance" className="min-h-10 rounded-lg bg-white/10 px-3 py-2.5 text-xs font-semibold text-white">Owner finance</Link></div>
      </section>
      <OwnerControlsClient snapshot={snapshot} />
    </div>
  );
}
