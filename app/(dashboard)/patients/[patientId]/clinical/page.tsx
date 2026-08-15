import Link from "next/link";
import { notFound } from "next/navigation";
import ClinicalWorkspaceClient from "@/components/ClinicalWorkspaceClient";
import DentalClinicalWorkspaceClient from "@/components/DentalClinicalWorkspaceClient";
import { StatusBadge } from "@/components/FeedbackUI";
import { getClinicalWorkspace } from "@/lib/webos/clinical";
import { getDentalClinicalWorkspace } from "@/lib/webos/dentalClinical";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { getPatientForContext } from "@/lib/webos/reception";

export default async function ClinicalPage({
  params,
}: {
  params: Promise<{ patientId: string }>;
}) {
  const context = await requireCurrentAccessContext();
  const { patientId } = await params;
  const decodedId = decodeURIComponent(patientId);
  const patient = await getPatientForContext(context, decodedId);
  if (!patient || patient.department === "All") notFound();

  const ownerOnlyClinicalView =
    context.roles.includes("Owner") &&
    !context.roles.includes("Therapist") &&
    !context.roles.includes("Dentist");

  if (patient.department === "Dental") {
    const workspace = await getDentalClinicalWorkspace(context, patient.patientId);
    const dentalWorkspace = {
      ...workspace,
      patient: { ...workspace.patient, department: "Dental" as const },
    };
    return (
      <div className="space-y-4">
        <ClinicalHeader
          patientId={workspace.patient.patientId}
          fullName={workspace.patient.fullName}
          department="Dental"
          clinician={workspace.patient.therapist || "Unassigned dentist"}
          oversight={ownerOnlyClinicalView}
        />
        <DentalClinicalWorkspaceClient
          workspace={dentalWorkspace}
          oversight={ownerOnlyClinicalView}
        />
      </div>
    );
  }

  let workspace;
  try {
    workspace = await getClinicalWorkspace(context, patient.patientId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "PATIENT_NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="space-y-4">
      <ClinicalHeader
        patientId={workspace.patient.patientId}
        fullName={workspace.patient.fullName}
        department="Physio"
        clinician={workspace.patient.therapist || "Unassigned"}
        oversight={ownerOnlyClinicalView}
      />
      <ClinicalWorkspaceClient
        workspace={workspace}
        oversight={ownerOnlyClinicalView}
      />
    </div>
  );
}

function ClinicalHeader({
  patientId,
  fullName,
  department,
  clinician,
  oversight,
}: {
  patientId: string;
  fullName: string;
  department: "Physio" | "Dental";
  clinician: string;
  oversight: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 px-4 py-3">
        <Link
          href={`/patients/${encodeURIComponent(patientId)}`}
          aria-label="Back to patient file"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-lg font-semibold text-slate-600 hover:bg-slate-50"
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-bold text-slate-950">{fullName}</h1>
            <StatusBadge tone={department === "Dental" ? "success" : "info"}>
              {department}
            </StatusBadge>
            {oversight && <StatusBadge tone="warning">Owner oversight</StatusBadge>}
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {patientId} · {clinician}
          </p>
        </div>
        <Link
          href={`/patients/${encodeURIComponent(patientId)}`}
          className="flex min-h-11 shrink-0 items-center rounded-lg px-3 text-xs font-semibold text-blue-800 hover:bg-blue-50"
        >
          Patient file
        </Link>
      </div>
    </section>
  );
}
