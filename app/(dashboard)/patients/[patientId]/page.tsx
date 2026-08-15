import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Row } from "@/components/Card";
import PatientEditForm from "@/components/PatientEditForm";
import PatientMediaGallery from "@/components/PatientMediaGallery";
import PatientReportUpload from "@/components/PatientReportUpload";
import { formatBDT } from "@/lib/format";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import {
  getPatientAppointmentsForContext,
  getPatientForContext,
} from "@/lib/webos/reception";
import { getPatientReportsForContext } from "@/lib/webos/reports";

function isPhoto(fileType: string, fileName: string): boolean {
  const normalizedType = fileType.trim().toLowerCase();
  if (normalizedType === "photo" || normalizedType.startsWith("image/")) return true;
  return /\.(?:jpe?g|png|webp|gif|heic|heif)$/i.test(fileName.trim());
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

  const canEditPatient = canPerform(context, "patient.update", patient.department);
  const canSeeMoney = canPerform(context, "payment.read_amount", patient.department);
  const canCreateAppointment = canPerform(context, "appointment.create", patient.department);
  const canSeeClinical = canPerform(context, "clinical.read", patient.department);
  const canSeeReports = canPerform(context, "patient.report.read", patient.department);
  const canUploadReports = canPerform(context, "patient.report.upload", patient.department);
  const [appointments, reports] = await Promise.all([
    getPatientAppointmentsForContext(context, patient),
    canSeeReports
      ? getPatientReportsForContext(context, patient)
      : Promise.resolve([]),
  ]);

  const mediaItems = reports.map((report) => ({
    id: report.reportId,
    url: `/api/patients/${encodeURIComponent(patient.patientId)}/reports/${encodeURIComponent(report.reportId)}/media`,
    fileName: report.fileName,
    fileType: report.fileType,
    uploadDate: report.uploadDate,
    uploadedBy: report.uploadedBy,
    photo: isPhoto(report.fileType, report.fileName),
  }));

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

      {canEditPatient && (
        <PatientEditForm
          patientId={patient.patientId}
          initial={{
            fullName: patient.fullName,
            phone: patient.phone.replace(/^'/, ""),
            age: patient.age,
            gender: patient.gender,
            address: patient.address,
            diagnosis: patient.diagnosis,
            therapist: patient.therapist,
            status: patient.status || "Active",
          }}
        />
      )}

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

      {canUploadReports && <PatientReportUpload patientId={patient.patientId} />}

      {canSeeReports && (
        <PatientMediaGallery items={mediaItems} patientName={patient.fullName} />
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
