import Link from "next/link";
import { cookies } from "next/headers";
import CashAcceptanceClient from "@/components/CashAcceptanceClient";
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
  const scope = resolveAuthorizedScope(
    context,
    cookieStore.get("relife_scope")?.value
  );
  const movements = await getPendingCashMovements(context, scope);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-slate-900 p-4 text-white shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">Telegram → Web finance parity</p>
            <h1 className="mt-1 text-lg font-semibold">✅ হ্যান্ডওভার গ্রহণ</h1>
            <p className="mt-1 text-xs text-slate-300">{LABEL[scope]} · Pending 21_Cash_Movement · actual received amount verified</p>
          </div>
          <Link href="/finance/history" className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white">History</Link>
        </div>
      </section>
      <CashAcceptanceClient movements={movements} />
    </div>
  );
}
