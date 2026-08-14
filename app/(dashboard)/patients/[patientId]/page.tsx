import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Row } from "@/components/Card";
import { formatBDT } from "@/lib/format";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import {
  getPatientAppointmentsForContext,
  getPatientForContext,
} from "@/lib/webos/reception";

export default async function PatientFilePage({
  params,
}: {
  params: Promise<{ patientId: string }>;
}) {
  const context = await requireCurrentAccessContext();
  const { patientId } = await params;
  const patient = await getPatientForContext(context, decodeURIComponent(patientId));
  if (!patient || patient.department === "All") notFound();

  const appointments = await getPatientAppointmentsForContext(context, patient);
  const canSeeMoney = canPerform(context, "payment.read_amount", patient.department);
  const canCreateAppointment = canPerform(context, "appointment.create", patient.department);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-400">Patient file · {patient.department}</p>
          <h2 className="truncate text-lg font-semibold text-slate-900">{patient.fullName}</h2>
          <p className="text-xs text-slate-500">{patient.patientId}</p>
        </div>
        <Link href="/patients" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600">
          Back
        </Link>
      </div>

      <Card title="Patient profile" subtitle={`Registered ${patient.registrationDate || "-"}`}>
        <Row label="Status" value={patient.status || "Active"} />
        <Row label="Phone" value={patient.phone || "-"} />
        <Row label="Age / Gender" value={[patient.age && `${patient.age}y`, patient.gender].filter(Boolean).join(" · ") || "-"} />
        <Row label="Address" value={patient.address || "-"} />
        <Row label="Clinician" value={patient.therapist || "Unassigned"} />
        {canSeeMoney && (
          <>
            <Row label="Paid" value={formatBDT(patient.paid)} />
            <Row label="Due" value={formatBDT(patient.due)} tone={patient.due > 0 ? "negative" : "neutral"} />
          </>
        )}
      </Card>

      <Card title="Diagnosis / complaint">
        <p className="text-sm leading-6 text-slate-700">{patient.diagnosis || "No diagnosis recorded."}</p>
      </Card>

      {canCreateAppointment && (
        <Link
          href={`/appointments/new?patientId=${encodeURIComponent(patient.patientId)}`}
          className="block rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-semibold text-white"
        >
          + নতুন Appointment
        </Link>
      )}

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Appointment history</h3>
            <p className="mt-0.5 text-xs text-slate-400">04_Appointments · latest first</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{appointments.length}</span>
        </div>
        <div className="space-y-2">
          {appointments.slice(0, 30).map((appointment) => (
            <div key={`${appointment.department}-${appointment.appointmentId}`} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{appointment.date} · {appointment.time}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{appointment.therapist || "Unassigned"} · {appointment.appointmentId}</p>
                </div>
                <span className="rounded-full bg-white px-2 py-1 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200">
                  {appointment.status}
                </span>
              </div>
            </div>
          ))}
          {appointments.length === 0 && (
            <p className="py-5 text-center text-sm text-slate-400">Appointment history নেই।</p>
          )}
        </div>
      </section>
    </div>
  );
}
