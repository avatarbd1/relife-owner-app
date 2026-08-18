import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import TreatmentEntryForm from "@/components/TreatmentEntryForm";
import TreatmentCaseStudy from "@/components/TreatmentCaseStudy";
import { getAppointment, getPatient } from "@/lib/data";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

interface PageProps {
  searchParams: Promise<{
    appointmentId?: string;
    patientId?: string;
  }>;
}

export default async function TreatmentRecordPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const appointmentId = params.appointmentId || params.patientId;

  if (!appointmentId) {
    redirect("/treatment");
  }

  const context = await requireCurrentAccessContext();

  // If appointmentId, fetch appointment and patient
  let appointment: any = null;
  let patient: any = null;

  if (params.appointmentId) {
    try {
      appointment = await getAppointment(params.appointmentId);
      if (!appointment) {
        notFound();
      }

      if (!canPerform(context, "treatment.record", appointment.department)) {
        redirect("/treatment");
      }

      patient = await getPatient(appointment.patientId);
    } catch (error) {
      console.error("Error fetching appointment:", error);
      notFound();
    }
  } else if (params.patientId) {
    // Create new treatment for patient (no appointment)
    try {
      patient = await getPatient(params.patientId);
      if (!patient) {
        notFound();
      }

      if (!canPerform(context, "treatment.record", patient.department)) {
        redirect("/treatment");
      }
    } catch (error) {
      console.error("Error fetching patient:", error);
      notFound();
    }
  }

  if (!patient) {
    notFound();
  }

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Link
        href="/treatment"
        className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700"
      >
        ← Back to Treatment Hub
      </Link>

      {/* Main Form */}
      <div className="max-w-2xl">
        <Suspense
          fallback={
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-600">
              Loading treatment form...
            </div>
          }
        >
          <TreatmentEntryForm
            appointmentId={appointment?.id || `adhoc-${patient.id}`}
            patientId={patient.id}
            patientName={patient.fullName}
            department={patient.department}
            appointmentType={appointment?.appointmentType || "General"}
            patientHistory={patient.clinicalNotes}
            onSuccess={() => {
              // Callback after successful treatment recording
            }}
          />
        </Suspense>
      </div>

      {/* Case Study Preview (shown after treatment recorded) */}
      {appointment && (
        <div className="max-w-2xl rounded-lg border border-purple-200 bg-purple-50 p-4">
          <p className="text-sm font-semibold text-purple-900">
            💡 Tip: After recording the treatment, you can create a case study from it
          </p>
          <p className="mt-1 text-xs text-purple-700">
            Case studies help document interesting cases and share learnings with your team
          </p>
        </div>
      )}
    </div>
  );
}
