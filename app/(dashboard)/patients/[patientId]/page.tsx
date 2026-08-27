import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Row } from "@/components/Card";
import PatientEditForm from "@/components/PatientEditForm";
import PatientMediaGallery from "@/components/PatientMediaGallery";
import PatientReportUpload from "@/components/PatientReportUpload";
import { StatusBadge } from "@/components/FeedbackUI";
import { getUnifiedPatientAppointmentsForContext } from "@/lib/domain/appointments/read";
import { formatBDT } from "@/lib/format";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { getPatientForContext } from "@/lib/webos/reception";
import { getPatientReportsForContext } from "@/lib/webos/reports";
import { getWebStaffDirectory } from "@/lib/webos/staffDirectory";

function isPhoto(fileType: string, fileName: string): boolean {
  const normalizedType = fileType.trim().toLowerCase();
  if (normalizedType === "photo" || normalizedType.startsWith("image/")) return true;
  return /\.(?:jpe?g|png|webp|gif|heic|heif)$/i.test(fileName.trim());
}

export default async function PatientFilePage({
  params,
  searchParams,
}: {
  params: Promise<{ patientId: string }>;
  searchParams?: Promise<{ edit?: string }>;
}) {
  const { access: context, tenant } = await requireCurrentTenantAccessContext();
  const [{ patientId }, query] = await Promise.all([
    params,
    searchParams ? searchParams : Promise.resolve({} as { edit?: string }),
  ]);
  const patient = await getPatientForContext(context, decodeURIComponent(patientId), tenant.organizationId, tenant.clinicId);
  if (!patient || patient.department === "All") notFound();

  const canEditPatient = canPerform(context, "patient.update", patient.department);
  const canSeeMoney = canPerform(context, "payment.read_amount", patient.department);
  const canCreatePayment = canPerform(context, "payment.create", patient.department);
  const canCreateAppointment = canPerform(context, "appointment.create", patient.department);
  const canSeeClinical = canPerform(context, "clinical.read", patient.department);
  const canSeeReports = canPerform(context, "patient.report.read", patient.department);
  const canUploadReports = canPerform(context, "patient.report.upload", patient.department);
  const [appointments, reports, staffDirectory] = await Promise.all([
    getUnifiedPatientAppointmentsForContext(context, patient),
    canSeeReports
      ? getPatientReportsForContext(context, patient)
      : Promise.resolve([]),
    canEditPatient ? getWebStaffDirectory() : Promise.resolve([]),
  ]);

  const clinicianRole = patient.department === "Dental" ? "Dentist" : "Therapist";
  const clinicianOptions = staffDirectory
    .filter(
      (staff) =>
        staff.status === "Active" &&
        staff.roles.includes(clinicianRole) &&
        (staff.departmentAccess.includes(patient.department) || staff.departmentAccess.includes("All"))
    )
    .map((staff) => ({ staffId: staff.staffId, fullName: staff.fullName }));

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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-slate-400">Patient file</p>
            <StatusBadge tone={patient.department === "Dental" ? "success" : "info"}>{patient.department}</StatusBadge>
          </div>
          <h1 className="mt-1 truncate text-xl font-bold text-slate-950">{patient.fullName}</h1>
          <p className="mt-0.5 text-xs text-slate-500">{patient.patientId}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {canEditPatient && (
            <Link
              href={`/patients/${encodeURIComponent(patient.patientId)}?edit=1#patient-edit`}
              className="flex min-h-11 items-center rounded-lg bg-blue-800 px-3 text-xs font-semibold text-white shadow-sm hover:bg-blue-900"
            >
              Edit
            </Link>
          )}
          <Link href="/patients" className="flex min-h-11 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            Back
          </Link>
        </div>
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
          defaultOpen={query.edit === "1"}
          clinicians={clinicianOptions}
          clinicianLabel={patient.department === "Dental" ? "Dentist" : "Therapist"}
          clinicianTone={patient.department === "Dental" ? "emerald" : "blue"}
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

      {(canSeeClinical || canCreateAppointment || canCreatePayment) && (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${[canSeeClinical, canCreateAppointment, canCreatePayment].filter(Boolean).length > 0 ? Math.min([canSeeClinical, canCreateAppointment, canCreatePayment].filter(Boolean).length, 2) : 1}, minmax(0, 1fr))` }}>
          {canSeeClinical && (
            <Link
              href={`/patients/${encodeURIComponent(patient.patientId)}/clinical`}
              className="flex min-h-14 items-center justify-center rounded-xl bg-emerald-600 px-4 py-3 text-center text-sm font-semibold text-white active:scale-[0.98]"
            >
              {patient.department === "Dental" ? "🦷 Dental clinical" : "Clinical file"}
            </Link>
          )}
          {canCreateAppointment && (
            <Link
              href={`/appointments/new?patientId=${encodeURIComponent(patient.patientId)}`}
              className="flex min-h-14 items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-center text-sm font-semibold text-white active:scale-[0.98]"
            >
              + Appointment
            </Link>
          )}
          {canCreatePayment && (
            <Link
              href={`/payments?patientId=${encodeURIComponent(patient.patientId)}`}
              className="flex min-h-14 items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-center text-sm font-semibold text-white active:scale-[0.98]"
            >
              💳 Payment
            </Link>
          )}
        </div>
      )}

      {canUploadReports && <PatientReportUpload patientId={patient.patientId} />}

      {canSeeReports && (
        <PatientMediaGallery items={mediaItems} patientName={patient.fullName} />
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Appointment history</h3>
            <p className="mt-0.5 text-xs text-slate-400">Appointments · latest first</p>
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
