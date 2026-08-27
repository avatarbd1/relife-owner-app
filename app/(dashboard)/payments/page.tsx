import Link from "next/link";
import { cookies } from "next/headers";
import PaymentsWorkspaceClient from "@/components/PaymentsWorkspaceClient";
import { StatusBadge } from "@/components/FeedbackUI";
import { getFinanceOperationsSnapshot } from "@/lib/webos/financeOps";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { resolveAuthorizedScope } from "@/lib/webos/scope";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string }>;
}) {
  const [context, cookieStore, params] = await Promise.all([
    requireCurrentAccessContext(),
    cookies(),
    searchParams,
  ]);
  const scope = resolveAuthorizedScope(context, cookieStore.get("relife_scope")?.value);
  const snapshot = await getFinanceOperationsSnapshot(context, scope);

  if (!snapshot.capabilities.paymentCreate) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        এই account-এর জন্য payment entry access দেওয়া নেই।
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 to-blue-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">Finance</p>
            <h1 className="mt-1 text-2xl font-bold">Payments</h1>
            <p className="mt-1 text-xs leading-5 text-slate-300">Quick patient payment recording, live receipt preview and server-issued receipt number.</p>
          </div>
          <StatusBadge tone="info" className="border-white/10">Online write</StatusBadge>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/finance/history" className="min-h-10 rounded-lg bg-white/10 px-3 py-2.5 text-xs font-semibold text-white hover:bg-white/15">History</Link>
          {context.roles.includes("Owner") && (
            <Link href="/finance" className="min-h-10 rounded-lg bg-blue-400/15 px-3 py-2.5 text-xs font-semibold text-blue-100 ring-1 ring-blue-300/20">Finance dashboard</Link>
          )}
        </div>
      </section>

      <PaymentsWorkspaceClient
        patients={snapshot.patients}
        recentPayments={snapshot.recentPayments}
        initialPatientId={params.patientId}
      />
    </div>
  );
}
