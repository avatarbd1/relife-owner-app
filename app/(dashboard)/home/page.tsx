import Link from "next/link";
import { redirect } from "next/navigation";
import AppIcon from "@/components/AppIcon";
import { formatBDT, formatDateBn } from "@/lib/format";
import { getTodaysCollection } from "@/lib/calculations";
import { getPayments } from "@/lib/data";
import { getScopedCashPosition } from "@/lib/scopedCash";
import { getOwnerControlSnapshot } from "@/lib/controls";
import {
  getAppointmentsForContext,
  todayDhaka,
} from "@/lib/webos/reception";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import {
  PageHeading,
  QuickButton,
  Section,
  ActionRow,
} from "@/components/WorkspaceUI";

function paymentSessionCount(remarks?: string): number {
  const match = /(?:^|\|)\s*Sessions:\s*(\d+)/i.exec(String(remarks || ""));
  if (!match) return 1;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function cashShare(value: number, total: number): number {
  if (total <= 0 || value <= 0) return 0;
  return Math.min(100, (value / total) * 100);
}

export default async function HomePage() {
  const context = await requireCurrentAccessContext();

  if (!context.roles.includes("Owner")) {
    if (context.roles.includes("Auditor")) redirect("/reports");
    if (context.roles.includes("System Admin")) redirect("/tools");
    if (
      context.roles.includes("Manager") ||
      context.roles.includes("Receptionist") ||
      context.roles.includes("Therapist") ||
      context.roles.includes("Dentist")
    ) {
      redirect("/daily");
    }

    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-sm">
        এই role-এর জন্য operational workspace enable করা নেই।
      </div>
    );
  }

  const now = new Date();
  const today = todayDhaka();
  const scope = "combined" as const;

  const [cash, todays, appointments, controls, payments] = await Promise.all([
    getScopedCashPosition(scope, now),
    getTodaysCollection(now),
    getAppointmentsForContext(context, scope, today),
    getOwnerControlSnapshot(),
    getPayments(),
  ]);

  const todayPayments = payments.filter(
    (payment) => payment.date.trim().slice(0, 10) === today
  );
  const patientKeys = new Set(
    todayPayments
      .map((payment) => payment.patientId.trim() || payment.patientName.trim())
      .filter(Boolean)
  );
  const todayPatientCount = patientKeys.size;
  const todaySessionCount = todayPayments.reduce(
    (sum, payment) => sum + paymentSessionCount(payment.remarks),
    0
  );

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
  const pendingApprovals =
    controls.pendingExpenses.length + controls.pendingCashMovements.length;

  const cashTotal = cash.reception + cash.homeTreasury + cash.bank;
  const positiveCashTotal =
    Math.max(0, cash.reception) +
    Math.max(0, cash.homeTreasury) +
    Math.max(0, cash.bank);
  const cashRows = [
    {
      label: "Reception",
      value: cash.reception,
      barClass: "bg-blue-700",
    },
    {
      label: "Home Treasury",
      value: cash.homeTreasury,
      barClass: "bg-emerald-600",
    },
    {
      label: "Digital / Bank",
      value: cash.bank,
      barClass: "bg-slate-500",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeading
        title="Overview"
        subtitle={`${formatDateBn(now)} · Combined clinic view`}
        action={
          <Link
            href="/daily"
            className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 active:scale-[0.98]"
          >
            <AppIcon name="attendance" className="h-4 w-4" />
            Daily Ops
          </Link>
        }
      />

      <section className="mb-5 overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">
              Today&apos;s collection
            </p>
            <p className="mt-2 text-[32px] font-bold leading-none tracking-tight tabular-nums">
              {formatBDT(todays.combined)}
            </p>
            <p className="mt-2 text-xs text-slate-400">Combined Physio + Dental</p>
          </div>

          {pendingApprovals > 0 && (
            <Link
              href="/more"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-amber-300/15 px-3 py-1.5 text-[11px] font-semibold text-amber-200 ring-1 ring-amber-200/15"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
              {pendingApprovals} pending
            </Link>
          )}
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2.5">
          <div className="rounded-xl bg-white/[0.07] p-3 ring-1 ring-white/10">
            <p className="text-xl font-semibold tabular-nums">{todayPatientCount}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">Patients</p>
          </div>
          <div className="rounded-xl bg-white/[0.07] p-3 ring-1 ring-white/10">
            <p className="text-xl font-semibold text-emerald-300 tabular-nums">{todaySessionCount}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">Sessions</p>
          </div>
          <div className="rounded-xl bg-white/[0.07] p-3 ring-1 ring-white/10">
            <p className="text-xl font-semibold tabular-nums">{openAppointments}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">Open</p>
          </div>
        </div>
      </section>

      <section className="mb-5">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Quick actions</h2>
          <span className="text-[11px] font-medium text-slate-400">Owner shortcuts</span>
        </div>
        <div className="grid grid-cols-4 gap-2.5">
          <QuickButton href="/patients/new" icon="userPlus" label="Register" />
          <QuickButton href="/operations" icon="payment" label="Payment" />
          <QuickButton href="/operations" icon="expense" label="Expense" />
          <QuickButton href="/appointments/new" icon="calendar" label="Booking" />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <Section title="Cash position" subtitle="Current custody position · transfers are not expenses">
          <div className="px-4 pb-4">
            <div className="space-y-4">
              {cashRows.map((row) => {
                const width = cashShare(row.value, positiveCashTotal);
                return (
                  <div key={row.label}>
                    <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-slate-600">{row.label}</span>
                      <span className="font-semibold text-slate-950 tabular-nums">{formatBDT(row.value)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${row.barClass}`}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Total cash</p>
                <p className="mt-1 text-xl font-bold text-slate-950 tabular-nums">{formatBDT(cashTotal)}</p>
              </div>
              <Link
                href="/finance"
                className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 active:bg-slate-100"
              >
                Finance details <span aria-hidden="true">›</span>
              </Link>
            </div>
          </div>
        </Section>

        <Section title="Needs attention" subtitle="Owner decisions and appointment exceptions">
          {pendingApprovals > 0 ? (
            <ActionRow
              href="/more"
              icon="approval"
              title="Approvals waiting"
              subtitle="Expense and cash handover decisions"
              meta={pendingApprovals}
            />
          ) : (
            <div className="border-t border-slate-100 px-4 py-4 text-sm text-slate-500">
              No approval is waiting right now.
            </div>
          )}
          {missedAppointments > 0 && (
            <ActionRow
              href="/appointments"
              icon="calendar"
              title="No-show / cancelled"
              subtitle="Review today’s appointment exceptions"
              meta={missedAppointments}
            />
          )}
        </Section>
      </div>
    </div>
  );
}
