import Link from "next/link";
import { redirect } from "next/navigation";
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
  MetricGrid,
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
      <div className="rounded-2xl bg-white p-5 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200">
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

  return (
    <div>
      <PageHeading
        title="Overview"
        subtitle={`${formatDateBn(now)} · Combined clinic view`}
        action={
          <Link
            href="/daily"
            className="shrink-0 rounded-xl bg-slate-900 px-3.5 py-2.5 text-xs font-semibold text-white active:scale-[0.98]"
          >
            Daily Ops
          </Link>
        }
      />

      <section className="mb-4 rounded-2xl bg-slate-900 p-4 text-white shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              Today
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {formatBDT(todays.combined)}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">Collected today</p>
          </div>
          {pendingApprovals > 0 && (
            <Link
              href="/more"
              className="rounded-full bg-amber-300/15 px-3 py-1.5 text-[11px] font-semibold text-amber-200"
            >
              {pendingApprovals} pending
            </Link>
          )}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-white/8 p-3">
            <p className="text-lg font-semibold">{todayPatientCount}</p>
            <p className="text-[11px] text-slate-400">Patients</p>
          </div>
          <div className="rounded-xl bg-white/8 p-3">
            <p className="text-lg font-semibold text-emerald-300">{todaySessionCount}</p>
            <p className="text-[11px] text-slate-400">Sessions</p>
          </div>
          <div className="rounded-xl bg-white/8 p-3">
            <p className="text-lg font-semibold">{openAppointments}</p>
            <p className="text-[11px] text-slate-400">Open</p>
          </div>
        </div>
      </section>

      <section className="mb-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Quick actions</h2>
        <div className="grid grid-cols-4 gap-2">
          <QuickButton href="/patients/new" icon="userPlus" label="Patient" />
          <QuickButton href="/operations" icon="payment" label="Payment" />
          <QuickButton href="/operations" icon="expense" label="Expense" />
          <QuickButton href="/appointments/new" icon="calendar" label="Booking" />
        </div>
      </section>

      <Section title="Cash position" subtitle="Combined · current custody position">
        <div className="px-4 pb-4">
          <MetricGrid
            items={[
              { label: "Reception", value: formatBDT(cash.reception) },
              { label: "Home Treasury", value: formatBDT(cash.homeTreasury) },
              { label: "Bank", value: formatBDT(cash.bank) },
            ]}
          />
          <Link
            href="/finance"
            className="mt-3 flex min-h-10 items-center justify-between border-t border-slate-100 pt-3 text-xs font-semibold text-slate-700"
          >
            View finance details
            <span className="text-slate-300">›</span>
          </Link>
        </div>
      </Section>

      {(pendingApprovals > 0 || missedAppointments > 0) && (
        <Section title="Needs attention">
          {pendingApprovals > 0 && (
            <ActionRow
              href="/more"
              icon="approval"
              title="Approvals waiting"
              subtitle="Expense and cash handover decisions"
              meta={pendingApprovals}
            />
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
      )}
    </div>
  );
}
