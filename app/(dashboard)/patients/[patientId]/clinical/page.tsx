import Link from "next/link";
import { notFound } from "next/navigation";
import ClinicalWorkspaceClient from "@/components/ClinicalWorkspaceClient";
import DentalClinicalWorkspaceClient from "@/components/DentalClinicalWorkspaceClient";
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

  if (patient.department === "Dental") {
    const workspace = await getDentalClinicalWorkspace(context, patient.patientId);
    const dentalWorkspace = {
      ...workspace,
      patient: { ...workspace.patient, department: "Dental" as const },
    };
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Telegram → Web · Dental clinical</p>
            <h1 className="truncate text-lg font-semibold text-slate-900">{workspace.patient.fullName}</h1>
            <p className="text-xs text-slate-500">{workspace.patient.patientId} · Dental</p>
          </div>
          <Link
            href={`/patients/${encodeURIComponent(workspace.patient.patientId)}`}
            className="min-h-12 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 active:bg-slate-50"
          >
            Patient file
          </Link>
        </div>
        <DentalClinicalWorkspaceClient workspace={dentalWorkspace} />
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
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Telegram → Web · Physio clinical</p>
          <h1 className="truncate text-lg font-semibold text-slate-900">{workspace.patient.fullName}</h1>
          <p className="text-xs text-slate-500">{workspace.patient.patientId} · {workspace.patient.therapist || "Unassigned"}</p>
        </div>
        <Link
          href={`/patients/${encodeURIComponent(workspace.patient.patientId)}`}
          className="min-h-12 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 active:bg-slate-50"
        >
          Patient file
        </Link>
      </div>
      <ClinicalWorkspaceClient workspace={workspace} />
    </div>
  );
}
