import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AppIcon from "@/components/AppIcon";
import HomeActionSlide from "@/components/HomeActionSlide";
import HomeSwipeLoop from "@/components/HomeSwipeLoop";
import StaffHomeWorkspace from "@/components/StaffHomeWorkspace";
import {
  ActionRow,
  PageHeading,
  QuickButton,
  Section,
} from "@/components/WorkspaceUI";
import { getTodaysCollection } from "@/lib/calculations";
import { formatBDT, formatDateBn } from "@/lib/format";
import { getScopedCashPositionForAdminView } from "@/lib/scopedCash";
import { requireCurrentAccessContext, requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import {
  getAppointmentsForContext,
  todayDhaka,
} from "@/lib/webos/reception";
import { resolveAuthorizedScope } from "@/lib/webos/scope";
import {
  getStaffHomeSnapshot,
  resolveStaffHomeRole,
} from "@/lib/webos/staffHome";

export default async function HomePage() {
  const context = await requireCurrentAccessContext();

  if (!context.roles.includes("Owner")) {
    if (context.roles.includes("Auditor")) redirect("/reports");
    if (context.roles.includes("System Admin")) redirect("/tools");

    const staffRole = resolveStaffHomeRole(context);
    if (staffRole) {
      const cookieStore = await cookies();
      const scope = resolveAuthorizedScope(
        context,
        cookieStore.get("relife_scope")?.value
      );
      const snapshot = await getStaffHomeSnapshot(context, scope);
      return <StaffHomeWorkspace snapshot={snapshot} />;
    }

    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-sm">
        এই role-এর জন্য operational workspace enable করা নেই।
      </div>
    );
  }

  const { tenant } = await requireCurrentTenantAccessContext();
  const now = new Date();
  const today = todayDhaka();
  const [cash, todays, appointments] = await Promise.all([
    getScopedCashPositionForAdminView("combined", now),
    getTodaysCollection(now, tenant.organizationId, tenant.clinicId),
    getAppointmentsForContext(context, "combined", today, tenant.organizationId, tenant.clinicId),
  ]);

  const todayPatientCount = new Set(appointments.map((item) => item.patientId)).size;
  const todaySessionCount = appointments.filter((item) => item.status.trim().toLowerCase() === "completed").length;
  const completed = appointments.filter(
    (item) => item.status.trim().toLowerCase() === "completed"
  ).length;
  const exceptions = appointments.filter((item) =>
    ["no-show", "cancelled", "canceled"].includes(
      item.status.trim().toLowerCase()
    )
  ).length;
  const open = Math.max(0, appointments.length - completed - exceptions);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeading
        title="Home"
        subtitle={`${formatDateBn(now)} · ${tenant.clinicName} · ${tenant.timezone}`}
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

      <HomeSwipeLoop>
        <div data-home-feed-slide>
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
              <QuickButton href="/chamber?tab=team" icon="chat" label="Live chat" />
            </div>
          </section>

          {exceptions > 0 && (
            <Section title="Needs attention" subtitle="Only items that need an Owner decision">
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
            <Link
              href="/finance#approvals"
              className="flex min-h-12 items-center justify-between border-t border-slate-100 px-4 text-xs font-semibold text-blue-800"
            >
              <span>Review approvals</span>
              <span aria-hidden="true">→</span>
            </Link>
          </Section>
        </div>

        <HomeActionSlide href="/patients/new" icon="userPlus" label="Patient" subtitle="Register a new patient" />
        <HomeActionSlide href="/appointments/new" icon="calendar" label="Booking" subtitle="Create an appointment" />
        <HomeActionSlide href="/payments" icon="payment" label="Payment" subtitle="Receive or review payment" />
        <HomeActionSlide href="/expenses" icon="expense" label="Expense" subtitle="Open expense workflow" />
        <HomeActionSlide href="/chamber?tab=team" icon="chat" label="Live chat" subtitle="Open the clinic team chat" />
      </HomeSwipeLoop>
    </div>
  );
}
