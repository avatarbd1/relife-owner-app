import Link from "next/link";
import { cookies } from "next/headers";
import { StatusBadge } from "@/components/FeedbackUI";
import { hasTenantFeature, requireTenantFeature } from "@/lib/domain/tenancy/featureGuard";
import { getFinanceLedgerSnapshot } from "@/lib/webos/financeLedgers";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { resolveAuthorizedScope } from "@/lib/webos/scope";

export default async function FinanceRecordsPage() {
  const [tenantContext, cookieStore] = await Promise.all([requireCurrentTenantAccessContext(), cookies()]);
  const context = tenantContext.access;
  await requireTenantFeature(tenantContext.tenant, "core.finance_basic");
  const scope = resolveAuthorizedScope(context, cookieStore.get("relife_scope")?.value);
  const [snapshot, advancedFinanceEnabled, salaryEnabled, auditEnabled] = await Promise.all([
    getFinanceLedgerSnapshot(context, scope, tenantContext.tenant),
    hasTenantFeature(tenantContext.tenant, "optional.finance_advanced"),
    hasTenantFeature(tenantContext.tenant, "optional.salary"),
    hasTenantFeature(tenantContext.tenant, "optional.audit_viewer"),
  ]);
  const cards = [
    snapshot.capabilities.collections && ["Daily collection", "আজকের patient-wise collection, collector ও payment method", "/finance/daily-collection", "bg-blue-50 text-blue-900"],
    snapshot.capabilities.collections && ["Collection history", "Full receipt ledger with date, department, method and search filters", "/finance/collection-history", "bg-emerald-50 text-emerald-900"],
    snapshot.capabilities.expenses && ["Expense history", "Requested, approved, paid and rejected expense evidence", "/finance/expense-history", "bg-amber-50 text-amber-900"],
    advancedFinanceEnabled && snapshot.capabilities.cash && ["Cash handover history", "Reception → Treasury → Bank movement and discrepancy evidence", "/finance/cash-history", "bg-sky-50 text-sky-900"],
    salaryEnabled && snapshot.capabilities.salary && ["Salary history", "Payroll and advance payment evidence by staff and month", "/finance/salary-history", "bg-teal-50 text-teal-900"],
    auditEnabled && snapshot.capabilities.audit && ["Finance audit", "Owner/Auditor cross-ledger investigation view", "/finance/audit", "bg-slate-100 text-slate-900"],
  ].filter(Boolean) as string[][];

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 to-blue-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">Finance</p><h1 className="mt-1 text-2xl font-bold">Finance records</h1><p className="mt-1 text-xs leading-5 text-slate-300">Only ledgers enabled for this clinic are shown. Every page is also role + department scoped.</p></div><StatusBadge tone="info" className="border-white/10">Tenant scoped</StatusBadge></div>
        <div className="mt-4 flex flex-wrap gap-2">{context.roles.includes("Owner") && <Link href="/finance" className="min-h-10 rounded-lg bg-white/10 px-3 py-2.5 text-xs font-semibold text-white">Owner finance</Link>}<Link href="/finance/operations" className="min-h-10 rounded-lg bg-white/10 px-3 py-2.5 text-xs font-semibold text-white">Finance actions</Link></div>
      </section>

      {cards.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">এই account-এর জন্য finance history access নেই।</div>
      ) : (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {cards.map(([title, subtitle, href, tone]) => <Link key={href} href={href} className={`rounded-xl p-4 shadow-sm ring-1 ring-inset ring-slate-200/80 ${tone}`}><div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 opacity-75">{subtitle}</p></div><span aria-hidden="true" className="text-lg">→</span></div></Link>)}
        </section>
      )}

      {context.roles.includes("Owner") && (
        <Link href="/finance/approvals" className="flex min-h-12 items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 text-sm font-semibold text-amber-900"><span>Pending expense approvals</span><span aria-hidden="true">→</span></Link>
      )}
    </div>
  );
}
