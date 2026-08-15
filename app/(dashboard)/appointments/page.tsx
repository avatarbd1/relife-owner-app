import Link from "next/link";
import { cookies } from "next/headers";
import AppointmentStatusControl from "@/components/AppointmentStatusControl";
import { Card, Row } from "@/components/Card";
import type { Scope } from "@/lib/types";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import {
  getAppointmentsForContext,
  todayDhaka,
} from "@/lib/webos/reception";

function readScope(value: string | undefined): Scope {
  if (value === "physio" || value === "dental" || value === "combined") return value;
  return "combined";
}

const SCOPE_LABEL: Record<Scope, string> = {
  combined: "Combined",
  physio: "Physio",
  dental: "Dental",
};

function statusTone(status: string): string {
  const value = status.toLowerCase();
  if (value === "completed") return "bg-emerald-50 text-emerald-700";
  if (["no-show", "cancelled", "canceled"].includes(value)) return "bg-red-50 text-red-700";
  if (["arrived", "waiting", "in treatment"].includes(value)) return "bg-amber-50 text-amber-700";
  return "bg-sky-50 text-sky-700";
}

export default async function AppointmentsPage() {
  const context = await requireCurrentAccessContext();
  const cookieStore = await cookies();
  const scope = readScope(cookieStore.get("relife_scope")?.value);
  const today = todayDhaka();
  const appointments = await getAppointmentsForContext(context, scope, today);
  const scheduled = appointments.filter((row) => row.status.toLowerCase() === "scheduled").length;
  const completed = appointments.filter((row) => row.status.toLowerCase() === "completed").length;
  const noShow = appointments.filter((row) => row.status.toLowerCase() === "no-show").length;
  const canCreate = ["Physio", "Dental"].some((department) =>
    canPerform(context, "appointment.create", department as "Physio" | "Dental")
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-slate-400">Today · {today}</p>
          <h2 className="text-lg font-semibold text-slate-900">আজকের শিডিউল</h2>
          <p className="text-xs text-slate-500">Telegram parity · {SCOPE_LABEL[scope]}</p>
        </div>
        {canCreate && (
          <Link href="/appointments/new" className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white">
            + Appointment
          </Link>
        )}
      </div>

      <Card title="Today overview" subtitle="Source: 04_Appointments">
        <Row label="Total" value={String(appointments.length)} emphasis />
        <Row label="Scheduled" value={String(scheduled)} />
        <Row label="Completed" value={String(completed)} />
        <Row label="No-show" value={String(noShow)} />
      </Card>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Schedule</h3>
            <p className="mt-0.5 text-xs text-slate-400">আজকের appointment + permitted status workflow</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{appointments.length}</span>
        </div>

        <div className="space-y-2">
          {appointments.map((appointment) => {
            const canUpdate = canPerform(context, "appointment.update", appointment.department);
            return (
              <div
                key={`${appointment.department}-${appointment.appointmentId}`}
                className="rounded-xl border border-slate-100 bg-slate-50 p-3"
              >
                <Link href={`/patients/${encodeURIComponent(appointment.patientId)}`} className="block">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{appointment.time} · {appointment.patientName || appointment.patientId}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {appointment.patientId} · {appointment.department} · {appointment.therapist || "Unassigned"}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${statusTone(appointment.status)}`}>
                      {appointment.status}
                    </span>
                  </div>
                </Link>
                {canUpdate && (
                  <AppointmentStatusControl
                    appointmentId={appointment.appointmentId}
                    department={appointment.department}
                    currentStatus={appointment.status}
                  />
                )}
              </div>
            );
          })}
          {appointments.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400">আজ কোনো appointment নেই।</p>
          )}
        </div>
      </section>
    </div>
  );
}
