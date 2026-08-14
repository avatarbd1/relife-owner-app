import Link from "next/link";
import { cookies } from "next/headers";
import { Card, Row } from "@/components/Card";
import { formatBDT, formatDateBn } from "@/lib/format";
import {
  getTodaysCollection,
  getMonthBusinessPosition,
  getSalaryStatus,
} from "@/lib/calculations";
import { getScopedCashPosition } from "@/lib/scopedCash";
import { getOwnerControlSnapshot } from "@/lib/controls";
import {
  getAppointmentsForContext,
  todayDhaka,
} from "@/lib/webos/reception";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import type { Scope } from "@/lib/types";

function readScope(value: string | undefined): Scope {
  if (value === "physio" || value === "dental" || value === "combined") {
    return value;
  }
  return "combined";
}

const SCOPE_LABEL: Record<Scope, string> = {
  combined: "Combined",
  physio: "Physio",
  dental: "Dental",
};

function QuickAction({
  href,
  icon,
  title,
  subtitle,
  badge,
}: {
  href: string;
  icon: string;
  title: string;
  subtitle: string;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className="relative flex min-h-24 select-none flex-col justify-between rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition duration-100 active:scale-[0.98] active:bg-slate-50"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xl" aria-hidden="true">
          {icon}
        </span>
        {badge !== undefined && badge > 0 && (
          <span className="min-w-6 rounded-full bg-red-600 px-2 py-1 text-center text-[11px] font-bold text-white">
            {badge}
          </span>
        )}
      </div>
      <div className="mt-3">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{subtitle}</p>
      </div>
    </Link>
  );
}

export default async function HomePage() {
  const cookieStore = await cookies();
  const scope = readScope(cookieStore.get("relife_scope")?.value);
  const now = new Date();
  const context = await requireCurrentAccessContext();
  const today = todayDhaka();

  const [cash, todays, month, salary, appointments, controls] = await Promise.all([
    getScopedCashPosition(scope, now),
    getTodaysCollection(now),
    getMonthBusinessPosition(scope, now),
    getSalaryStatus(scope, now),
    getAppointmentsForContext(context, scope, today),
    getOwnerControlSnapshot(),
  ]);

  const completedAppointments = appointments.filter(
    (item) => item.status.trim().toLowerCase() === "completed"
  ).length;
  const missedAppointments = appointments.filter((item) =>
    ["no-show", "cancelled", "canceled"].includes(
      item.status.trim().toLowerCase()
    )
  ).length;
  const openAppointments = Math.max(
    0,
    appointments.length - completedAppointments - missedAppointments
  );

  const scopedExpenses = controls.pendingExpenses.filter(
    (item) => scope === "combined" || item.workbook === scope
  );
  const scopedCash = controls.pendingCashMovements.filter(
    (item) => scope === "combined" || item.workbook === scope
  );
  const pendingActions = scopedExpenses.length + scopedCash.length;

  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">
        {formatDateBn(now)} &middot; স্কোপ: {SCOPE_LABEL[scope]}
      </p>

      <section className="mb-4 rounded-2xl bg-slate-900 p-4 text-white shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Today
            </p>
            <h2 className="mt-1 text-lg font-semibold">আজকের clinic snapshot</h2>
          </div>
          <Link
            href="/daily"
            className="min-h-12 shrink-0 select-none rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition duration-100 active:scale-[0.97] active:bg-slate-100"
          >
            Daily Ops
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-white/10 p-3">
            <p className="text-xl font-bold">{appointments.length}</p>
            <p className="mt-0.5 text-[11px] text-slate-300">Bookings</p>
          </div>
          <div className="rounded-xl bg-white/10 p-3">
            <p className="text-xl font-bold">{completedAppointments}</p>
            <p className="mt-0.5 text-[11px] text-slate-300">Completed</p>
          </div>
          <div className="rounded-xl bg-white/10 p-3">
            <p className="text-xl font-bold">{openAppointments}</p>
            <p className="mt-0.5 text-[11px] text-slate-300">Open</p>
          </div>
        </div>
      </section>

      {(pendingActions > 0 || missedAppointments > 0) && (
        <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
            Needs attention
          </p>
          <div className="mt-2 divide-y divide-amber-200">
            {pendingActions > 0 && (
              <Link
                href="/more"
                className="flex min-h-12 items-center justify-between gap-3 py-3 text-sm font-semibold text-slate-900 active:text-amber-800"
              >
                <span>Pending owner approvals</span>
                <span className="rounded-full bg-amber-200 px-2.5 py-1 text-xs text-amber-900">
                  {pendingActions}
                </span>
              </Link>
            )}
            {missedAppointments > 0 && (
              <Link
                href="/appointments"
                className="flex min-h-12 items-center justify-between gap-3 py-3 text-sm font-semibold text-slate-900 active:text-amber-800"
              >
                <span>আজকের no-show / cancelled</span>
                <span className="rounded-full bg-amber-200 px-2.5 py-1 text-xs text-amber-900">
                  {missedAppointments}
                </span>
              </Link>
            )}
          </div>
        </section>
      )}

      <section className="mb-4">
        <div className="mb-2 flex items-end justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Quick actions</h2>
            <p className="text-[11px] text-slate-500">এক tap-এ frequent workflow</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <QuickAction
            href="/appointments"
            icon="🗓️"
            title="Today Schedule"
            subtitle="Booking, status, patient flow"
          />
          <QuickAction
            href="/patients/new"
            icon="➕"
            title="New Patient"
            subtitle="Fast reception registration"
          />
          <QuickAction
            href="/operations"
            icon="⚡"
            title="Finance Ops"
            subtitle="Payment, expense, cash, salary"
          />
          <QuickAction
            href="/more"
            icon="✅"
            title="Approvals"
            subtitle="Owner approval and cash acceptance"
            badge={pendingActions}
          />
        </div>
      </section>

      <Card title="আজকের আদায়" subtitle="Source: 06_Payments">
        <Row label="Physio collection" value={formatBDT(todays.physio)} />
        <Row label="Dental collection" value={formatBDT(todays.dental)} />
        <div className="mt-2 border-t border-slate-100 pt-2">
          <Row label="Combined" value={formatBDT(todays.combined)} emphasis />
        </div>
      </Card>

      <Card title="Current Cash Position" subtitle={`Current month custody balance · ${SCOPE_LABEL[scope]}`}>
        <Row label="Reception" value={formatBDT(cash.reception)} />
        <Row label="Home Treasury" value={formatBDT(cash.homeTreasury)} />
        <Row label="Digital / Bank" value={formatBDT(cash.bank)} />
        <div className="mt-2 border-t border-slate-100 pt-2">
          <Row label="Total cash position" value={formatBDT(cash.total)} emphasis />
        </div>
      </Card>

      <Card
        title="এই মাসের ব্যবসার অবস্থা"
        subtitle={`Scope: ${SCOPE_LABEL[scope]}`}
      >
        <Row label="Month collection" value={formatBDT(month.monthCollection)} />
        <Row
          label="Variable clinic expense"
          value={formatBDT(month.variableClinicExpense)}
        />
        <Row label="Fixed overhead" value={formatBDT(month.fixedOverhead)} />
        <Row
          label="Fixed salary commitment"
          value={formatBDT(month.fixedSalaryCommitment)}
        />
        <div className="mt-2 border-t border-slate-100 pt-2">
          <Row
            label="Total business liability"
            value={formatBDT(month.totalBusinessLiability)}
          />
        </div>
        <div className="mt-2 border-t border-slate-100 pt-2">
          <Row
            label={month.surplusOrUncovered >= 0 ? "Surplus" : "এখনও খরচ ওঠেনি"}
            value={formatBDT(Math.abs(month.surplusOrUncovered))}
            emphasis
            tone={month.surplusOrUncovered >= 0 ? "positive" : "negative"}
          />
        </div>
      </Card>

      <Card title="Salary" subtitle={`Scope: ${SCOPE_LABEL[scope]}`}>
        <Row
          label="Fixed commitment"
          value={formatBDT(salary.fixedCommitment)}
        />
        <Row label="Paid / advance" value={formatBDT(salary.paidOrAdvance)} />
        <div className="mt-2 border-t border-slate-100 pt-2">
          <Row
            label="Remaining due"
            value={formatBDT(salary.remainingDue)}
            emphasis
            tone={salary.remainingDue > 0 ? "negative" : "positive"}
          />
        </div>
      </Card>
    </div>
  );
}
