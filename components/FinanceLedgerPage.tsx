import Link from "next/link";
import { cookies } from "next/headers";
import FinanceLedgerClient from "@/components/FinanceLedgerClient";
import { StatusBadge } from "@/components/FeedbackUI";
import type { FinanceLedgerKind } from "@/lib/webos/financeLedgers";
import { canOpenFinanceLedger, getFinanceLedgerSnapshot } from "@/lib/webos/financeLedgers";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { resolveAuthorizedScope } from "@/lib/webos/scope";

const SCOPE_LABEL = { combined: "Combined", physio: "Physio", dental: "Dental" } as const;

export default async function FinanceLedgerPage({
  kind,
  title,
  subtitle,
}: {
  kind: FinanceLedgerKind;
  title: string;
  subtitle: string;
}) {
  const [tenantContext, cookieStore] = await Promise.all([requireCurrentTenantAccessContext(), cookies()]);
  const context = tenantContext.access;
  const scope = resolveAuthorizedScope(context, cookieStore.get("relife_scope")?.value);
  const snapshot = await getFinanceLedgerSnapshot(context, scope, tenantContext.tenant);

  if (!canOpenFinanceLedger(snapshot, kind)) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          এই account-এর জন্য এই finance history access দেওয়া নেই।
        </div>
        <Link href="/finance/records" className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-blue-800">Finance records</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 to-blue-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">
              Finance records · {SCOPE_LABEL[scope]}
            </p>
            <h1 className="mt-1 text-2xl font-bold">{title}</h1>
            <p className="mt-1 max-w-xl text-xs leading-5 text-slate-300">{subtitle}</p>
          </div>
          <StatusBadge tone="info" className="border-white/10">Role scoped</StatusBadge>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/finance/records" className="min-h-10 rounded-lg bg-white/10 px-3 py-2.5 text-xs font-semibold text-white hover:bg-white/15">All finance records</Link>
          {context.roles.includes("Owner") && <Link href="/finance" className="min-h-10 rounded-lg bg-blue-400/15 px-3 py-2.5 text-xs font-semibold text-blue-100 ring-1 ring-blue-300/20">Owner finance</Link>}
        </div>
      </section>

      {snapshot.capabilities.receptionLimited && (
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
          Reception view: নিজের authorized department-এর collection, Reception-paid expense এবং Reception-origin cash handover পর্যন্ত সীমিত।
        </div>
      )}

      <FinanceLedgerClient kind={kind} snapshot={snapshot} />
    </div>
  );
}
