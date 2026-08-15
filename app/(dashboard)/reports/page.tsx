import { cookies } from "next/headers";
import ScopeSelector from "@/components/ScopeSelector";
import { ProgressBar, StatusBadge } from "@/components/FeedbackUI";
import { formatBDT } from "@/lib/format";
import {
  getMonthBusinessPosition,
  getSalaryStatus,
  getTodaysCollection,
} from "@/lib/calculations";
import { getPayments } from "@/lib/data";
import { getPatients } from "@/lib/patients";
import type { Department, Scope } from "@/lib/types";
import { actionsForRoles, canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { allowedScopesForContext, resolveAuthorizedScope } from "@/lib/webos/scope";

function scopeAllows(scope: Scope, department: Department): boolean {
  if (scope === "combined") return department === "Physio" || department === "Dental";
  return department === (scope === "physio" ? "Physio" : "Dental");
}

function bdMonthKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function pct(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export default async function ReportsPage() {
  const [cookieStore, context] = await Promise.all([cookies(), requireCurrentAccessContext()]);
  const actions = new Set(actionsForRoles(context.roles));
  const canReadOperational = actions.has("report.read_operational");
  const canReadFinancial = actions.has("report.read_financial");

  if (!canReadOperational && !canReadFinancial) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">এই account-এর জন্য Reports access দেওয়া নেই।</div>;
  }

  const scope = resolveAuthorizedScope(context, cookieStore.get("relife_scope")?.value);
  const allowedScopes = allowedScopesForContext(context);
  const now = new Date();
  const monthKey = bdMonthKey(now);

  const [allPatients, financial, payments] = await Promise.all([
    canReadOperational ? getPatients() : Promise.resolve([]),
    canReadFinancial
      ? Promise.all([getTodaysCollection(now), getMonthBusinessPosition(scope, now), getSalaryStatus(scope, now)])
      : Promise.resolve(null),
    canReadFinancial ? getPayments() : Promise.resolve([]),
  ]);

  const patients = allPatients.filter(
    (patient) => scopeAllows(scope, patient.department) && canPerform(context, "report.read_operational", patient.department)
  );
  const activePatients = patients.filter((patient) => patient.status.toLowerCase() === "active").length;
  const newPatients = patients.filter((patient) => patient.registrationDate.startsWith(monthKey)).length;
  const patientDue = patients.reduce((sum, patient) => sum + patient.due, 0);

  const todays = financial?.[0];
  const month = financial?.[1];
  const salary = financial?.[2];
  const todayCollection = todays
    ? scope === "physio" ? todays.physio : scope === "dental" ? todays.dental : todays.combined
    : 0;
  const recovery = month && month.totalBusinessLiability > 0 ? pct((month.monthCollection / month.totalBusinessLiability) * 100) : 0;
  const salaryPaid = salary && salary.fixedCommitment > 0 ? pct((salary.paidOrAdvance / salary.fixedCommitment) * 100) : 0;

  const financialPayments = payments.filter(
    (payment) =>
      payment.date.startsWith(monthKey) &&
      scopeAllows(scope, payment.department) &&
      canPerform(context, "report.read_financial", payment.department)
  );
  const byDate = new Map<string, number>();
  for (const payment of financialPayments) byDate.set(payment.date, (byDate.get(payment.date) || 0) + payment.amount);
  const dailyTrend = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-10);
  const maxDaily = Math.max(1, ...dailyTrend.map(([, value]) => value));

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 to-blue-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">Analytics</p><h1 className="mt-1 text-2xl font-bold">Reports</h1><p className="mt-1 text-xs leading-5 text-slate-300">Operational and financial health from live clinic records.</p></div>
          <StatusBadge tone="info" className="border-white/10">{scope}</StatusBadge>
        </div>
      </section>

      {allowedScopes.length > 1 && <ScopeSelector current={scope} allowed={allowedScopes} />}

      {canReadOperational && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div><h2 className="text-base font-semibold text-slate-900">Patient performance</h2><p className="mt-0.5 text-xs text-slate-500">Current month</p></div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-blue-50 p-3"><p className="text-[10px] text-blue-700">Patients</p><p className="mt-1 text-lg font-bold text-blue-950">{patients.length}</p></div>
            <div className="rounded-lg bg-emerald-50 p-3"><p className="text-[10px] text-emerald-700">Active</p><p className="mt-1 text-lg font-bold text-emerald-950">{activePatients}</p></div>
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-[10px] text-slate-500">New</p><p className="mt-1 text-lg font-bold text-slate-950">{newPatients}</p></div>
          </div>
          {canReadFinancial && patientDue > 0 && <div className="mt-3 flex items-center justify-between rounded-lg bg-red-50 px-3 py-2.5"><span className="text-xs text-red-700">Patient master due</span><strong className="text-sm tabular-nums text-red-900">{formatBDT(patientDue)}</strong></div>}
        </section>
      )}

      {canReadFinancial && month && salary && (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-900">Business performance</h2><p className="mt-0.5 text-xs text-slate-500">Current month commitments and recovery</p></div><StatusBadge tone={month.surplusOrUncovered >= 0 ? "success" : "warning"}>{month.surplusOrUncovered >= 0 ? "Recovered" : "Uncovered"}</StatusBadge></div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-blue-50 p-3"><p className="text-[10px] text-blue-700">Today collection</p><p className="mt-1 text-base font-bold tabular-nums text-blue-950">{formatBDT(todayCollection)}</p></div>
              <div className="rounded-lg bg-blue-50 p-3"><p className="text-[10px] text-blue-700">Month collection</p><p className="mt-1 text-base font-bold tabular-nums text-blue-950">{formatBDT(month.monthCollection)}</p></div>
              <div className="rounded-lg bg-amber-50 p-3"><p className="text-[10px] text-amber-700">Variable expense</p><p className="mt-1 text-base font-bold tabular-nums text-amber-950">{formatBDT(month.variableClinicExpense)}</p></div>
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-[10px] text-slate-500">Fixed overhead</p><p className="mt-1 text-base font-bold tabular-nums text-slate-950">{formatBDT(month.fixedOverhead)}</p></div>
            </div>
            <ProgressBar value={recovery} label="Cost recovery" className="mt-4" />
            <div className={`mt-3 flex items-center justify-between rounded-lg px-3 py-2.5 ${month.surplusOrUncovered >= 0 ? "bg-emerald-50" : "bg-red-50"}`}><span className={`text-xs ${month.surplusOrUncovered >= 0 ? "text-emerald-700" : "text-red-700"}`}>{month.surplusOrUncovered >= 0 ? "Surplus" : "Still uncovered"}</span><strong className={`text-sm tabular-nums ${month.surplusOrUncovered >= 0 ? "text-emerald-900" : "text-red-900"}`}>{formatBDT(Math.abs(month.surplusOrUncovered))}</strong></div>
            <p className="mt-2 text-[11px] leading-4 text-slate-400">Internal cash transfers are excluded from business expense.</p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div><h2 className="text-base font-semibold text-slate-900">Collection trend</h2><p className="mt-0.5 text-xs text-slate-500">Latest payment days in the current month</p></div>
            <div className="mt-4 space-y-2.5">
              {dailyTrend.map(([date, value]) => (
                <div key={date} className="grid grid-cols-[76px_1fr_auto] items-center gap-2"><span className="text-[11px] text-slate-500">{date.slice(5)}</span><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full origin-left rounded-full bg-blue-700" style={{ transform: `scaleX(${Math.max(0, value / maxDaily)})` }} /></div><span className="text-[11px] font-semibold tabular-nums text-slate-700">{formatBDT(value)}</span></div>
              ))}
              {dailyTrend.length === 0 && <p className="py-4 text-center text-xs text-slate-400">এই মাসে payment trend data নেই।</p>}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-900">Salary position</h2><p className="mt-0.5 text-xs text-slate-500">Fixed commitment and paid / advance</p></div><StatusBadge tone={salary.remainingDue > 0 ? "warning" : "success"}>{Math.round(salaryPaid)}% paid</StatusBadge></div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-slate-50 p-2"><p className="text-[10px] text-slate-500">Commitment</p><p className="mt-1 text-xs font-bold">{formatBDT(salary.fixedCommitment)}</p></div><div className="rounded-lg bg-emerald-50 p-2"><p className="text-[10px] text-emerald-700">Paid</p><p className="mt-1 text-xs font-bold text-emerald-900">{formatBDT(salary.paidOrAdvance)}</p></div><div className="rounded-lg bg-red-50 p-2"><p className="text-[10px] text-red-700">Remaining</p><p className="mt-1 text-xs font-bold text-red-900">{formatBDT(salary.remainingDue)}</p></div></div>
            <ProgressBar value={salaryPaid} label="Payroll paid" className="mt-4" />
          </section>
        </>
      )}
    </div>
  );
}
