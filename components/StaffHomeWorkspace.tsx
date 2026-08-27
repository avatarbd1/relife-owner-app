import Link from "next/link";
import AppIcon, { type AppIconName } from "@/components/AppIcon";
import HomeActionSlide from "@/components/HomeActionSlide";
import HomeSwipeLoop from "@/components/HomeSwipeLoop";
import { PageHeading, QuickButton } from "@/components/WorkspaceUI";
import { formatDateBn } from "@/lib/format";
import type { StaffHomeSnapshot } from "@/lib/webos/staffHome";

interface QuickAction {
  href: string;
  icon: AppIconName;
  label: string;
}

function scopeLabel(scope: StaffHomeSnapshot["scope"]): string {
  if (scope === "physio") return "Physio";
  if (scope === "dental") return "Dental";
  return "Combined";
}

function quickActions(snapshot: StaffHomeSnapshot): QuickAction[] {
  const { role, capabilities } = snapshot;
  const actions: QuickAction[] = [];

  if (role === "Receptionist") {
    if (capabilities.patientCreate) actions.push({ href: "/patients/new", icon: "userPlus", label: "New patient" });
    if (capabilities.appointmentCreate) actions.push({ href: "/appointments/new", icon: "calendar", label: "Booking" });
    if (capabilities.paymentCreate) actions.push({ href: "/payments", icon: "payment", label: "Payment" });
    if (capabilities.cashRequest) actions.push({ href: "/finance/cash-movement", icon: "cash", label: "Handover" });
    if (actions.length < 4 && capabilities.registerRead) actions.push({ href: "/register", icon: "register", label: "Register" });
  } else if (role === "Manager") {
    if (capabilities.patientRead) actions.push({ href: "/patients", icon: "patients", label: "Patients" });
    if (capabilities.appointmentRead) actions.push({ href: "/appointments", icon: "calendar", label: "Schedule" });
    if (capabilities.chamberRead) actions.push({ href: "/chamber", icon: "chamber", label: "Chamber" });
    if (capabilities.paymentCreate) actions.push({ href: "/payments", icon: "payment", label: "Payment" });
  } else if (role === "Therapist") {
    if (capabilities.chamberRun) actions.push({ href: "/chamber", icon: "chamber", label: "Chamber" });
    if (capabilities.patientRead) actions.push({ href: "/patients?view=today", icon: "patients", label: "My patients" });
    if (capabilities.appointmentRead) actions.push({ href: "/appointments", icon: "calendar", label: "Schedule" });
    if (capabilities.appointmentCreate) actions.push({ href: "/appointments/new", icon: "calendar", label: "Booking" });
  } else {
    if (capabilities.patientRead) actions.push({ href: "/patients?view=today", icon: "patients", label: "My patients" });
    if (capabilities.appointmentRead) actions.push({ href: "/appointments", icon: "calendar", label: "Schedule" });
    if (capabilities.appointmentCreate) actions.push({ href: "/appointments/new", icon: "calendar", label: "Booking" });
    if (capabilities.registerRead) actions.push({ href: "/register", icon: "register", label: "Register" });
  }

  if (capabilities.chamberRead) {
    actions.push({ href: "/chamber?tab=team", icon: "chat", label: "Live chat" });
  }

  return actions;
}

function statusTone(status: string): string {
  const value = status.trim().toLowerCase();
  if (value === "completed") return "bg-emerald-50 text-emerald-700";
  if (["arrived", "waiting", "in treatment"].includes(value)) return "bg-amber-50 text-amber-700";
  if (["cancelled", "canceled", "no-show"].includes(value)) return "bg-red-50 text-red-700";
  return "bg-slate-100 text-slate-600";
}

export default function StaffHomeWorkspace({ snapshot }: { snapshot: StaffHomeSnapshot }) {
  const actions = quickActions(snapshot);
  const clinician = snapshot.role === "Therapist" || snapshot.role === "Dentist";
  const scope = scopeLabel(snapshot.scope);
  const queueTitle = clinician ? "My patients today" : "Today’s queue";
  const heroTitle = clinician
    ? `Good morning, ${snapshot.staffName}`
    : `${snapshot.counts.appointments} appointments today`;
  const heroSubtitle = clinician
    ? `${snapshot.counts.appointments} assigned · ${snapshot.counts.ready} ready / active`
    : `${snapshot.counts.ready} waiting / active · ${snapshot.counts.open} open`;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeading
        title="Home"
        subtitle={`${formatDateBn(new Date())} · ${scope}`}
        action={
          snapshot.capabilities.attendanceSelf ? (
            <Link
              href="/daily"
              className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-sm active:scale-[0.98]"
            >
              <AppIcon name="attendance" className="h-4 w-4" />
              Daily Ops
            </Link>
          ) : undefined
        }
      />

      <HomeSwipeLoop>
        <div data-home-feed-slide>
          <section className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-700">
              {snapshot.role === "Receptionist"
                ? "Front desk"
                : snapshot.role === "Manager"
                  ? "Clinic operations"
                  : snapshot.role === "Therapist"
                    ? "Physio clinical"
                    : "Dental clinical"}
            </p>
            <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-950">{heroTitle}</h1>
            <p className="mt-1 text-xs text-slate-500">{heroSubtitle}</p>

            {!clinician && snapshot.counts.exceptions > 0 && (
              <Link
                href={`/appointments?date=${encodeURIComponent(snapshot.date)}&scope=${encodeURIComponent(snapshot.scope)}&focus=exceptions`}
                className="mt-3 flex min-h-11 items-center justify-between rounded-xl bg-amber-50 px-3.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200"
              >
                <span>{snapshot.counts.exceptions} appointment exception{snapshot.counts.exceptions === 1 ? "" : "s"}</span>
                <span aria-hidden="true">Review →</span>
              </Link>
            )}
          </section>

          {actions.length > 0 && (
            <section className="mb-5">
              <div className="mb-2.5 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">Quick actions</h2>
                <span className="text-[10px] font-medium text-slate-400">Daily work</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {actions.map((action) => (
                  <QuickButton key={`${action.href}-${action.label}`} {...action} />
                ))}
              </div>
            </section>
          )}

          <section className="mb-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">{queueTitle}</h2>
                <p className="mt-0.5 text-[10px] text-slate-400">Tap a patient to continue the work</p>
              </div>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-semibold text-blue-700">
                {snapshot.counts.appointments}
              </span>
            </div>

            {snapshot.appointments.slice(0, 6).map((appointment) => (
              <Link
                key={appointment.appointmentId}
                href={`/patients/${encodeURIComponent(appointment.patientId)}`}
                className="flex min-h-[68px] items-center gap-3 border-b border-slate-100 px-4 py-3 active:bg-slate-50"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-blue-800">
                  {(appointment.patientName || appointment.patientId || "P").trim().slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-blue-800">
                      {appointment.time || "—"}
                    </span>
                    <span className="truncate text-sm font-semibold text-slate-950">
                      {appointment.patientName || appointment.patientId}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">
                    {appointment.department}
                    {!clinician && appointment.therapist ? ` · ${appointment.therapist}` : ""}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-semibold ${statusTone(appointment.status)}`}>
                  {appointment.status || "Booked"}
                </span>
              </Link>
            ))}

            {snapshot.appointments.length === 0 && (
              <div className="px-4 py-8 text-center">
                <p className="text-sm font-semibold text-slate-700">
                  {clinician ? "No patients assigned today" : "No appointments today"}
                </p>
                <p className="mt-1 text-xs text-slate-400">Nothing needs attention here right now.</p>
              </div>
            )}

            {snapshot.capabilities.appointmentRead && (
              <Link
                href={`/appointments?date=${encodeURIComponent(snapshot.date)}&scope=${encodeURIComponent(snapshot.scope)}`}
                className="flex min-h-12 items-center justify-between px-4 text-xs font-semibold text-blue-800 active:bg-slate-50"
              >
                <span>Open full schedule</span>
                <span aria-hidden="true">→</span>
              </Link>
            )}
          </section>
        </div>

        {actions.map((action) => (
          <HomeActionSlide
            key={`home-action-${action.href}-${action.label}`}
            {...action}
            subtitle={action.label === "Live chat" ? "Open the clinic team chat" : "Open this quick action"}
          />
        ))}
      </HomeSwipeLoop>
    </div>
  );
}
