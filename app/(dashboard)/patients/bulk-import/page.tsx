import Link from "next/link";
import PatientBulkImportClient from "@/components/PatientBulkImportClient";
import { PageHeading } from "@/components/WorkspaceUI";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

export default async function BulkImportPage() {
  const context = await requireCurrentAccessContext();
  const canImportPhysio = canPerform(context, "patient.create", "Physio");
  const canImportDental = canPerform(context, "patient.create", "Dental");

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <PageHeading title="Bulk patient import" subtitle="Validated CSV import through the same patient registration domain" />
        <Link href="/patients" className="flex min-h-11 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">Back</Link>
      </div>

      {canImportPhysio || canImportDental ? (
        <PatientBulkImportClient canImportPhysio={canImportPhysio} canImportDental={canImportDental} />
      ) : (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          This account does not have patient.create permission for an accessible department.
        </div>
      )}
    </div>
  );
}
