import Link from "next/link";
import AppIcon, { type AppIconName } from "@/components/AppIcon";
import {
  ActionRow,
  MetricGrid,
  PageHeading,
  QuickButton,
  Section,
} from "@/components/WorkspaceUI";
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

function roleCopy(role: StaffHomeSnapshot["role"]): {
  eyebrow: string;
  title: string;
  subtitle: string;
} {
  if (role === "Receptionist") {
    return {
      eyebrow: "Front desk",
      title: "Reception workspace",
      subtitle: "Patients, bookings, payments and today’s queue",
    };
  }
  if (role === "Manager") {
    return {
      eyebrow: "Operations",
      title: "Manager workspace",
      subtitle: "Clinic flow, patient activity and daily exceptions",
    };
  }
  if (role === "Therapist") {
    return {
      eyebrow: "Physio clinical",
      title: "My treatment day",
      subtitle: "Assigned appointments, Chamber and patient work",
    };
  }
  return {
    eyebrow: "Dental clinical",
    title: "My dental day",
    subtitle: "Assigned appointments, patient files and clinical work",
  };
}

function quickActions(snapshot: StaffHomeSnapshot): QuickAction[] {
  const { role, capabilities } = snapshot;
  const actions: QuickAction[] = [];

  if (role === "Receptionist") {
    if (capabilities.patientCreate) actions.push({ href: "/patients/new", icon: "userPlus", label: "New patient" });
    if (capabilities.appointmentCreate) actions.push({ href: "/appointments/new", icon: "calendar", label: "Booking" });
    if (capabilities.paymentCreate) actions.push({ href: "/payments", icon: "payment", label: "Payment" });
    if (capabilities.registerRead) actions.push({ href: "/register", icon: "register", label: "Register" });
  } else if (role === "Manager") {
    if (capabilities.patientRead) actions.push({ href: "/patients", icon: "patients", label: "Patients" });
    if (capabilities.appointmentRead) actions.push({ href: "/appointments", icon: "calendar", label: "Schedule" });
    if (capabilities.paymentCreate) actions.push({ href: "/payments", icon: "payment", label: "Payment" });
    if (capabilities.registerRead) actions.push({ href: "/register", icon: "register", label: "Register" });
  } else if (role === "Therapist") {
    if (capabilities.chamberRun) actions.push({ href: "/chamber", icon: "chamber", label: "Chamber" });
    if (capabilities.patientRead) actions.push({ href: "/patients", icon: "patients", label: "Patients" });
    if (capabilities.appointmentRead) actions.push({ href: "/appointments", icon: "calendar", label: "Schedule" });
    if (capabilities.appointmentCreate) actions.push({ href: "/appointments/new", icon: "calendar", label: "Booking" });
  } else {
    if (capabilities.patientRead) actions.push({ href: "/patients", icon: "patients", label: "Patients" });
    if (capabilities.appointmentRead) actions.push({ href: "/appointments", icon: "calendar", label: "Schedule" });
    if (capabilities.appointmentCreate) actions.push({ href: "/appointments/new", icon: "calendar", label: "Booking" });
    if (capabilities.registerRead) actions.push({ href: "/register", icon: "register", label: "Register" });
  }

  return actions.slice(0, 4);
}

export default function StaffHomeWorkspace({ snapshot }: { snapshot: StaffHomeSnapshot }) {
  const copy = roleCopy(snapshot.role);
  const actions = quickActions(snapshot);
  const clinician = snapshot.role === "Therapist" || snapshot.role === "Dentist";
  const scheduleTitle = clinician ? "My appointments" : "Today’s schedule";
  const scope = scopeLabel(snapshot.scope);

  const metricItems = [
    { label: clinician ? "My appointments" : "Appointments", value: String(snapshot.counts.appointments) },
    { label: "Open", value: String(snapshot.counts.open), tone: snapshot.counts.open > 0 ? "warning" as const : "default" as const },
    { label: "Ready / active", value: String(snapshot.counts.ready), tone: snapshot.counts.ready > 0 ? "positive" as const : "default" as const },
    { label: "Clinical sessions", value: String(snapshot.counts.sessions), tone: "positive" as const },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeading
        title="Home"
        subtitle={`${formatDateBn(new Date())} · ${scope} · ${snapshot.staffName}`}
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

      <section className="mb-4 overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-5 text-white shadow-lg">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-200">{copy.eyebrow}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{copy.title}</h1>
        <p className="mt-1 text-xs leading-5 text-slate-300">{copy.subtitle}</p>
        <div className="mt-5">
          <MetricGrid items={metricItems} />
        </div>
      </section>

      {actions.length > 0 && (
        <section className="mb-4">
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Quick actions</h2>
            <span className="text-[10px] font-medium text-slate-400">Role-aware</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {actions.map((action) => (
              <QuickButton key={`${action.href}-${action.label}`} {...action} />
            ))}
          </div>
        </section>
      )}

      <Section
        title={scheduleTitle}
        subtitle={`${snapshot.date} · ${scope}${clinician ? " · assigned to you" : ""}`}
      >
        {snapshot.appointments.slice(0, 6).map((appointment) => (
          <ActionRow
            key={appointment.appointmentId}
            href={`/patients/${encodeURIComponent(appointment.patientId)}`}
            icon={clinician ? "clinical" : "calendar"}
            title={appointment.patientName || appointment.patientId}
            subtitle={`${appointment.time || "Time not set"} · ${appointment.department}${appointment.therapist ? ` · ${appointment.therapist}` : ""}`}
            meta={appointment.status}
          />
        ))}
        {snapshot.appointments.length === 0 && (
          <div className="border-t border-slate-100 px-4 py-5 text-sm text-slate-500">
            {clinician ? "আজ আপনার নামে assigned appointment নেই।" : "আজ visible appointment নেই।"}
          </div>
        )}
        {snapshot.capabilities.appointmentRead && (
          <Link
            href={`/appointments?date=${encodeURIComponent(snapshot.date)}&scope=${encodeURIComponent(snapshot.scope)}`}
            className="flex min-h-12 items-center justify-between border-t border-slate-100 px-4 text-xs font-semibold text-blue-800 hover:bg-slate-50"
          >
            <span>Open full schedule</span>
            <span aria-hidden="true">→</span>
          </Link>
        )}
      </Section>

      {(snapshot.counts.exceptions > 0 || snapshot.capabilities.inventoryRead || snapshot.capabilities.expenseRequest || snapshot.capabilities.cashRead || snapshot.capabilities.chamberRead) && (
        <Section title="Work shortcuts" subtitle="Only actions this account is allowed to use">
          {snapshot.counts.exceptions > 0 && !clinician && (
            <ActionRow
              href={`/appointments?date=${encodeURIComponent(snapshot.date)}&scope=${encodeURIComponent(snapshot.scope)}&focus=exceptions`}
              icon="calendar"
              title="Appointment exceptions"
              subtitle="No-show / cancelled appointments need review"
              meta={snapshot.counts.exceptions}
            />
          )}
          {snapshot.capabilities.chamberRead && snapshot.role !== "Therapist" && (
            <ActionRow href="/chamber" icon="chamber" title="Chamber" subtitle="Patient flow and treatment-bed status" />
          )}
          {snapshot.capabilities.inventoryRead && (
            <ActionRow href="/inventory" icon="inventory" title="Inventory" subtitle="Stock status and movement history" />
          )}
          {snapshot.capabilities.expenseRequest && (
            <ActionRow href="/expenses" icon="expense" title="Expense request" subtitle="Submit clinic expense for approval" />
          )}
          {snapshot.capabilities.cashRead && (
            <ActionRow href="/finance/operations?tab=cash" icon="cash" title="Cash handover" subtitle="View or request authorized cash movement" />
          )}
        </Section>
      )}
    </div>
  );
}
