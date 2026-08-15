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
import { getPatientReportsForContext } from "@/lib/webos/reports";

function isPhoto(fileType: string, fileName: string): boolean {
  if (fileType.trim().toLowerCase() === "photo") return true;
  return /\.(?:jpe?g|png|webp|gif)$/i.test(fileName.trim());
}

export default async function PatientFilePage({
  params,
}: {
  params: Promise<{ patientId: string }>;
}) {
  const context = await requireCurrentAccessContext();
  const { patientId } = await params;
  const patient = await getPatientForContext(context, decodeURIComponent(patientId));
  if (!patient || patient.department === "All") notFound();

  const canSeeMoney = canPerform(context, "payment.read_amount", patient.department);
  const canCreateAppointment = canPerform(context, "appointment.create", patient.department);
  const canSeeClinical = canPerform(context, "clinical.read", patient.department);
  const [appointments, reports] = await Promise.all([
    getPatientAppointmentsForContext(context, patient),
    canSeeClinical
      ? getPatientReportsForContext(context, patient)
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-400">Patient file · {patient.department}</p>
          <h2 className="truncate text-lg font-semibold text-slate-900">{patient.fullName}</h2>
          <p className="text-xs text-slate-500">{patient.patientId}</p>
        </div>
        <Link href="/patients" className="min-h-12 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 active:bg-slate-50">
          Back
        </Link>
      </div>

      <Card title="Patient profile" subtitle={`Registered ${patient.registrationDate || "-"}`}>
        <Row label="Status" value={patient.status || "Active"} />
        <Row label="Phone" value={patient.phone || "-"} />
        <Row label="Age / Gender" value={[patient.age && `${patient.age}y`, patient.gender].filter(Boolean).join(" · ") || "-"} />
        <Row label="Address" value={patient.address || "-"} />
        <Row label={patient.department === "Dental" ? "Dentist / clinician" : "Therapist"} value={patient.therapist || "Unassigned"} />
        {canSeeMoney && (
          <>
            <Row label="Paid" value={formatBDT(patient.paid)} />
            <Row label="Due" value={formatBDT(patient.due)} tone={patient.due > 0 ? "negative" : "neutral"} />
          </>
        )}
      </Card>

      <Card title={patient.department === "Dental" ? "Complaint / diagnosis" : "Diagnosis / complaint"}>
        <p className="text-sm leading-6 text-slate-700">{patient.diagnosis || "No diagnosis recorded."}</p>
      </Card>

      {(canSeeClinical || canCreateAppointment) && (
        <div className="grid grid-cols-2 gap-3">
          {canSeeClinical && (
            <Link
              href={`/patients/${encodeURIComponent(patient.patientId)}/clinical`}
              className="flex min-h-14 items-center justify-center rounded-2xl bg-emerald-600 px-4 py-3 text-center text-sm font-semibold text-white active:scale-[0.98]"
            >
              {patient.department === "Dental" ? "🦷 Dental clinical" : "Clinical file"}
            </Link>
          )}
          {canCreateAppointment && (
            <Link
              href={`/appointments/new?patientId=${encodeURIComponent(patient.patientId)}`}
              className="flex min-h-14 items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-semibold text-white active:scale-[0.98]"
            >
              + Appointment
            </Link>
          )}
        </div>
      )}

      {canSeeClinical && (
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Photos & reports</h3>
              <p className="mt-0.5 text-xs text-slate-400">Patient-scoped clinical media · latest first</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
              {reports.length}
            </span>
          </div>

          {reports.length > 0 ? (
            <div className="grid grid-cols-2 gap-2.5 p-3">
              {reports.map((report) => {
                const mediaUrl = `/api/patients/${encodeURIComponent(patient.patientId)}/reports/${encodeURIComponent(report.reportId)}/media`;
                const photo = isPhoto(report.fileType, report.fileName);
                return (
                  <a
                    key={`${report.department}-${report.reportId}`}
                    href={mediaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="group overflow-hidden rounded-xl border border-slate-200 bg-slate-50 transition active:scale-[0.98]"
                  >
                    {photo ? (
                      <div className="aspect-[4/3] overflow-hidden bg-slate-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={mediaUrl}
                          alt={`${patient.fullName} · ${report.reportId}`}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover transition duration-200 group-active:scale-[0.99]"
                        />
                      </div>
                    ) : (
                      <div className="flex aspect-[4/3] items-center justify-center bg-slate-100 px-3 text-center">
                        <span className="text-sm font-semibold text-slate-600">
                          {report.fileType || "Document"}
                        </span>
                      </div>
                    )}
                    <div className="p-2.5">
                      <p className="truncate text-xs font-semibold text-slate-800">
                        {report.fileName || report.reportId}
                      </p>
                      <p className="mt-1 text-[10px] leading-4 text-slate-500">
                        {report.uploadDate || "Date unavailable"}
                      </p>
                      {report.uploadedBy && (
                        <p className="truncate text-[10px] leading-4 text-slate-400">
                          {report.uploadedBy}
                        </p>
                      )}
                    </div>
                  </a>
                );
              })}
            </div>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-slate-400">
              কোনো patient photo/report নেই।
            </p>
          )}
        </section>
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
