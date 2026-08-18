import Link from "next/link";
import { redirect } from "next/navigation";
import AppIcon from "@/components/AppIcon";
import {
  ActionRow,
  PageHeading,
  QuickButton,
  Section,
} from "@/components/WorkspaceUI";
import { formatBDT, formatDateBn } from "@/lib/format";
import { getTodaysCollection } from "@/lib/calculations";
import { getScopedCashPosition } from "@/lib/scopedCash";
import { getOwnerControlSnapshot } from "@/lib/controls";
import { getDailyClinicalActivity } from "@/lib/webos/dailyClinicalActivity";
import {
  getAppointmentsForContext,
  todayDhaka,
} from "@/lib/webos/reception";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

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
  const [cash, todays, appointments, controls, clinicalActivity] = await Promise.all([
    getScopedCashPosition("combined", now),
    getTodaysCollection(now),
    getAppointmentsForContext(context, "combined", today),
    getOwnerControlSnapshot(),
    getDailyClinicalActivity("combined", today),
  ]);

  const todayPatientCount = clinicalActivity.patients;
  const todaySessionCount = clinicalActivity.sessions;
  const completed = appointments.filter(
    (item) => item.status.trim().toLowerCase() === "completed"
  ).length;
  const exceptions = appointments.filter((item) =>
    ["no-show", "cancelled", "canceled"].includes(
      item.status.trim().toLowerCase()
    )
  ).length;
  const open = Math.max(0, appointments.length - completed - exceptions);
  const pendingApprovals =
    controls.pendingExpenses.length + controls.pendingCashMovements.length;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeading
        title="Home"
        subtitle={`${formatDateBn(now)} · Owner control tower`}
        action={
          <Link
            href="/daily"
            className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-sm active:scale-[0.98]"
          >
            <AppIcon name="attendance" className="h-4 w-4" />
            Daily Ops
          </Link>
        }
      />

      <section className="mb-4 overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-200">
              Collected today
            </p>
            <p className="mt-2 text-[32px] font-bold leading-none tracking-tight tabular-nums">
              {formatBDT(todays.combined)}
            </p>
            <p className="mt-2 text-[11px] text-slate-400">
              Physio {formatBDT(todays.physio)} · Dental {formatBDT(todays.dental)}
            </p>
          </div>
          {pendingApprovals > 0 && (
            <Link
              href="/finance#approvals"
              className="rounded-full bg-amber-300/15 px-3 py-1.5 text-[11px] font-semibold text-amber-200 ring-1 ring-amber-200/15"
            >
              {pendingApprovals} pending
            </Link>
          )}
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2.5 text-center">
          <div className="rounded-xl bg-white/[0.07] p-3 ring-1 ring-white/10">
            <p className="text-xl font-semibold tabular-nums">{todayPatientCount}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">Patients treated</p>
          </div>
          <div className="rounded-xl bg-white/[0.07] p-3 ring-1 ring-white/10">
            <p className="text-xl font-semibold text-emerald-300 tabular-nums">
              {todaySessionCount}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-400">Sessions done</p>
          </div>
          <div className="rounded-xl bg-white/[0.07] p-3 ring-1 ring-white/10">
            <p className="text-xl font-semibold tabular-nums">{open}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">Open</p>
          </div>
        </div>
      </section>

      <section className="mb-4">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Quick actions</h2>
          <span className="text-[10px] font-medium text-slate-400">Daily work</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <QuickButton href="/patients/new" icon="userPlus" label="Patient" />
          <QuickButton href="/appointments/new" icon="calendar" label="Booking" />
          <QuickButton href="/payments" icon="payment" label="Payment" />
          <QuickButton href="/expenses" icon="expense" label="Expense" />
        </div>
      </section>

      {(pendingApprovals > 0 || exceptions > 0) && (
        <Section title="Needs attention" subtitle="Only items that need an Owner decision">
          {pendingApprovals > 0 && (
            <ActionRow
              href="/finance#approvals"
              icon="approval"
              title="Approvals waiting"
              subtitle="Expense and cash handover decisions"
              meta={pendingApprovals}
            />
          )}
          {exceptions > 0 && (
            <ActionRow
              href={`/appointments?date=${encodeURIComponent(today)}&scope=combined&focus=exceptions`}
              icon="calendar"
              title="No-show / cancelled"
              subtitle="Review today’s appointment exceptions"
              meta={exceptions}
            />
          )}
        </Section>
      )}

      <Section title="Cash custody" subtitle="Current position · transfers are not expenses">
        <div className="grid grid-cols-3 gap-2 px-4 pb-4 text-center">
          <div className="rounded-lg bg-blue-50 p-3">
            <p className="text-[10px] text-blue-700">Reception</p>
            <p className="mt-1 text-sm font-bold tabular-nums text-blue-950">
              {formatBDT(cash.reception)}
            </p>
          </div>
          <div className="rounded-lg bg-emerald-50 p-3">
            <p className="text-[10px] text-emerald-700">Treasury</p>
            <p className="mt-1 text-sm font-bold tabular-nums text-emerald-950">
              {formatBDT(cash.homeTreasury)}
            </p>
          </div>
          <div className="rounded-lg bg-slate-100 p-3">
            <p className="text-[10px] text-slate-500">Bank</p>
            <p className="mt-1 text-sm font-bold tabular-nums text-slate-950">
              {formatBDT(cash.bank)}
            </p>
          </div>
        </div>
        <Link
          href="/finance"
          className="flex min-h-12 items-center justify-between border-t border-slate-100 px-4 text-xs font-semibold text-blue-800"
        >
          <span>Open Finance</span>
          <span aria-hidden="true">→</span>
        </Link>
      </Section>

      {/* Keyboard Shortcuts Indicator */}
      <div className="mt-6 rounded-lg border border-slate-200 bg-gradient-to-r from-slate-50 to-blue-50 p-3 text-center">
        <p className="text-[11px] text-slate-600">
          ⚡ Power user tip: Press <kbd className="inline-block rounded bg-slate-200 px-1.5 py-0.5 font-mono font-semibold text-slate-700">?</kbd> to view keyboard shortcuts
        </p>
        <p className="mt-1 text-[10px] text-slate-500">
          Quick: <kbd className="inline-block rounded bg-white px-1 py-0.5 font-mono font-semibold">P</kbd> = Payment ·
          <kbd className="inline-block rounded bg-white px-1 py-0.5 font-mono font-semibold ml-1">A</kbd> = Appointment ·
          <kbd className="inline-block rounded bg-white px-1 py-0.5 font-mono font-semibold ml-1">T</kbd> = Treatment
        </p>
      </div>
    </div>
  );
}
