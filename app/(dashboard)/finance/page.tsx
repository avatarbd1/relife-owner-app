import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import OwnerControlsClient from "@/components/OwnerControlsClient";
import ScopeSelector from "@/components/ScopeSelector";
import { InlineNotice, ProgressBar, StatusBadge } from "@/components/FeedbackUI";
import { formatBDT, formatDateBn } from "@/lib/format";
import {
  getMonthBusinessPosition,
  getMonthCashHandover,
  getSalaryStatus,
  getTodaysCollection,
} from "@/lib/calculations";
import { getPatientFinancialPosition } from "@/lib/patients";
import { getScopedCashPosition } from "@/lib/scopedCash";
import { getOwnerControlSnapshot } from "@/lib/controls";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { allowedScopesForContext, resolveAuthorizedScope } from "@/lib/webos/scope";

function percent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

function CashRow({ label, value, total }: { label: string; value: number; total: number }) {
  const share = total > 0 ? Math.max(0, (value / total) * 100) : 0;
  return <div><div className="flex items-center justify-between gap-3"><span className="text-xs font-medium text-slate-600">{label}</span><span className="text-sm font-bold tabular-nums text-slate-900">{formatBDT(value)}</span></div><ProgressBar value={share} label={`${Math.round(share)}% of current cash`} tone="primary" className="mt-2" /></div>;
}

function TruthCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: number | null;
  detail: string;
  tone: string;
}) {
  return (
    <div className={`rounded-xl p-3 ring-1 ring-inset ring-slate-200/70 ${tone}`}>
      <p className="text-[11px] font-semibold text-slate-700">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-slate-950">
        {value === null ? "—" : formatBDT(value)}
      </p>
      <p className="mt-1 text-[10px] leading-4 text-slate-500">{detail}</p>
    </div>
  );
}

export default async function FinancePage() {
  const context = await requireCurrentAccessContext();
  if (!context.roles.includes("Owner")) redirect("/operations");
  const cookieStore = await cookies();
  const allowedScopes = allowedScopesForContext(context);
  const scope = resolveAuthorizedScope(context, cookieStore.get("relife_scope")?.value);
  const now = new Date();
  const [cash, todays, month, salary, monthHandover, receivables, controls] = await Promise.all([
    getScopedCashPosition(scope, now),
    getTodaysCollection(now),
    getMonthBusinessPosition(scope, now),
    getSalaryStatus(scope, now),
    getMonthCashHandover(scope, now),
    getPatientFinancialPosition(scope),
    getOwnerControlSnapshot(),
  ]);

  const scopeCollection = scope === "physio" ? todays.physio : scope === "dental" ? todays.dental : todays.combined;
  const recovery = month.totalBusinessLiability > 0 ? percent((month.monthCollection / month.totalBusinessLiability) * 100) : 0;
  const salaryPaidPct = salary.fixedCommitment > 0 ? Math.min(100, percent((salary.ledgerPaid / salary.fixedCommitment) * 100)) : 0;
  const pendingExpenses = controls.pendingExpenses.filter((item) => scope === "combined" || item.workbook === scope);
  const pendingCash = controls.pendingCashMovements.filter((item) => scope === "combined" || item.workbook === scope);
  const pendingTotal = pendingExpenses.length + pendingCash.length;
  const uncovered = month.surplusOrUncovered < 0;

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl bg-gradient-to-br from-blue-950 via-blue-900 to-slate-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">Owner finance</p><h1 className="mt-1 text-2xl font-bold">Financial position</h1><p className="mt-1 text-xs text-blue-100/80">{formatDateBn(now)} · live clinic ledger view</p></div><StatusBadge tone={pendingTotal ? "warning" : "success"} className="border-white/10">{pendingTotal ? `${pendingTotal} pending` : "Up to date"}</StatusBadge></div>
        <div className="mt-5"><p className="text-xs text-blue-100/75">Collections today</p><p className="mt-1 text-3xl font-bold tabular-nums">{formatBDT(scopeCollection)}</p></div>
      </section>

      <ScopeSelector current={scope} allowed={allowedScopes} />

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div><h2 className="text-base font-semibold text-slate-900">Finance truth</h2><p className="mt-0.5 text-xs text-slate-500">Each number keeps its own source and accounting meaning.</p></div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <TruthCard label="Billed Services" value={receivables.billedServices} detail="Service charges / receivable. Legacy Total_Bill coverage is incomplete, so no forced total." tone="bg-violet-50" />
          <TruthCard label="Collections" value={month.monthCollection} detail="This month · canonical 06_Payments only." tone="bg-blue-50" />
          <TruthCard label="Outstanding" value={receivables.outstanding} detail="Current patient Due balance. Not cash collected." tone="bg-red-50" />
          <TruthCard label="Cash Handover" value={monthHandover} detail="This month · accepted 21_Cash_Movement. Custody-only; never revenue." tone="bg-sky-50" />
        </div>
        <p className="mt-2 text-[11px] leading-4 text-slate-400">{scope === "combined" ? "Combined is a read-only Physio + Dental aggregation; it is not a third finance department." : `${scope === "physio" ? "Physio" : "Dental"} remains independently reconcilable.`}</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-900">This month</h2><p className="mt-0.5 text-xs text-slate-500">Collections against business commitments</p></div><StatusBadge tone={uncovered ? "warning" : "success"}>{uncovered ? "Cost not recovered" : "Recovered"}</StatusBadge></div>
        <div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-lg bg-blue-50 p-3"><p className="text-[11px] font-medium text-blue-700">Collections</p><p className="mt-1 text-lg font-bold tabular-nums text-blue-950">{formatBDT(month.monthCollection)}</p></div><div className={`rounded-lg p-3 ${uncovered ? "bg-red-50" : "bg-emerald-50"}`}><p className={`text-[11px] font-medium ${uncovered ? "text-red-700" : "text-emerald-700"}`}>{uncovered ? "Still uncovered" : "Surplus"}</p><p className={`mt-1 text-lg font-bold tabular-nums ${uncovered ? "text-red-900" : "text-emerald-900"}`}>{formatBDT(Math.abs(month.surplusOrUncovered))}</p></div></div>
        <ProgressBar value={recovery} label="Business cost recovery" className="mt-4" />
        <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-100">{[["Clinic Expense · variable", month.variableClinicExpense], ["Fixed overhead", month.fixedOverhead], ["Salary Commitment", month.fixedSalaryCommitment], ["Total business liability", month.totalBusinessLiability]].map(([label, value]) => <div key={String(label)} className="flex items-center justify-between gap-3 px-3 py-2.5"><span className="text-xs text-slate-600">{label}</span><span className="text-xs font-semibold tabular-nums text-slate-900">{formatBDT(Number(value))}</span></div>)}</div>
        <p className="mt-2 text-[11px] leading-4 text-slate-400">Internal cash transfers are not included as business expense.</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-900">Current Cash Position</h2><p className="mt-0.5 text-xs text-slate-500">Carry-forward custody from the approved ledger cutover; accepted movements only</p></div><span className="text-lg font-bold tabular-nums text-slate-950">{formatBDT(cash.total)}</span></div>
        <div className="mt-4 space-y-4"><CashRow label="Reception" value={cash.reception} total={cash.total} /><CashRow label="Home Treasury" value={cash.homeTreasury} total={cash.total} /><CashRow label="Digital / Bank" value={cash.bank} total={cash.total} /></div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-900">Salary position</h2><p className="mt-0.5 text-xs text-slate-500">Salary Commitment versus actual 13_Salary ledger payments</p></div><StatusBadge tone={salary.remainingDue > 0 ? "warning" : salary.excessAmount > 0 ? "info" : "success"}>{salary.remainingDue > 0 ? "Due remains" : salary.excessAmount > 0 ? "Over commitment" : "Commitment covered"}</StatusBadge></div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-slate-50 p-2"><p className="text-[10px] text-slate-500">Commitment</p><p className="mt-1 text-xs font-bold tabular-nums">{formatBDT(salary.fixedCommitment)}</p></div><div className="rounded-lg bg-emerald-50 p-2"><p className="text-[10px] text-emerald-700">Ledger paid</p><p className="mt-1 text-xs font-bold tabular-nums text-emerald-900">{formatBDT(salary.ledgerPaid)}</p></div><div className="rounded-lg bg-red-50 p-2"><p className="text-[10px] text-red-700">Remaining</p><p className="mt-1 text-xs font-bold tabular-nums text-red-900">{formatBDT(salary.remainingDue)}</p></div></div>
        <ProgressBar value={salaryPaidPct} label="Payroll coverage this month" className="mt-4" />
        {(salary.legacyExpenseSettlement || 0) > 0 && <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-[11px] leading-4 text-blue-800">Includes {formatBDT(salary.legacyExpenseSettlement || 0)} verified legacy cleaner payroll paid through the expense ledger. The cash deduction remains in 07_Expenses.</p>}
        {(salary.legacyPayrollConflictCount || 0) > 0 && <InlineNotice tone="warning" className="mt-2">{salary.legacyPayrollConflictCount} legacy payroll-looking expense could not be linked safely. It remains visible as a clinic expense and requires manual reconciliation.</InlineNotice>}
        {salary.excessAmount > 0 && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-800">Staff overpaid by {formatBDT(salary.excessAmount)} this month. Tracked separately; does not reduce commitment next month.</p>}
        <Link href="/salary" className="mt-3 flex min-h-11 items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-800 hover:bg-blue-100"><span>Open salary management</span><span aria-hidden="true">→</span></Link>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Finance workflows</h2><p className="mt-0.5 text-xs text-slate-500">Use the correct ledger workflow for each action.</p>
        <div className="mt-4 grid grid-cols-2 gap-2">{[
          ["Collections", "Patient payment / receipt", "/payments", "bg-blue-50 text-blue-800"],
          ["Clinic Expense", "Request · approve · pay", "/operations?tab=expenses", "bg-amber-50 text-amber-800"],
          ["Cash Handover", "Internal custody transfer", "/operations?tab=cash", "bg-sky-50 text-sky-800"],
          ["Salary", "Staff payroll ledger", "/salary", "bg-emerald-50 text-emerald-800"],
        ].map(([title, subtitle, href, tone]) => <Link key={String(title)} href={String(href)} className={`min-h-24 rounded-xl p-3 ring-1 ring-inset ring-slate-200/70 ${tone}`}><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-[11px] leading-4 opacity-80">{subtitle}</p></Link>)}</div>
        <Link href="/finance/history" className="mt-3 flex min-h-11 items-center justify-between rounded-lg border border-slate-200 px-3 text-xs font-semibold text-blue-800 hover:bg-slate-50"><span>Transaction history & evidence</span><span aria-hidden="true">→</span></Link>
      </section>

      <section id="approvals" className="scroll-mt-24">
        <div className="mb-2 flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-900">Needs approval</h2><p className="mt-0.5 text-xs text-slate-500">Expense decisions and cash receiver confirmation</p></div>{pendingTotal > 0 && <StatusBadge tone="warning">{pendingTotal} pending</StatusBadge>}</div>
        <OwnerControlsClient snapshot={controls} />
      </section>
    </div>
  );
}
