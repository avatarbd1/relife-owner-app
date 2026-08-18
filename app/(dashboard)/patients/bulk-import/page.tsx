import Link from "next/link";
import PatientBulkImportClient from "@/components/PatientBulkImportClient";
import { PageHeading } from "@/components/WorkspaceUI";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { canPerform } from "@/lib/webos/access";

export default async function BulkImportPage() {
  const context = await requireCurrentAccessContext();

  const canImportPhysio = canPerform(context, "patient.create", "Physio");
  const canImportDental = canPerform(context, "patient.create", "Dental");

  if (!canImportPhysio && !canImportDental) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <PageHeading
          title="Bulk Patient Import"
          subtitle="Import multiple patients from CSV"
        />
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          এই account-এ patient.create permission নেই।
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <PageHeading
          title="Bulk Patient Import"
          subtitle="Import multiple patients from CSV file"
        />
        <Link
          href="/patients"
          className="relife-interactive rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600"
        >
          Back
        </Link>
      </div>

      <PatientBulkImportClient
        canImportPhysio={canImportPhysio}
        canImportDental={canImportDental}
      />
    </div>
  );
}
