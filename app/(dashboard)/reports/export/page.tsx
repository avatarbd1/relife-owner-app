import Link from "next/link";
import CsvExportClient from "@/components/CsvExportClient";
import { PageHeading } from "@/components/WorkspaceUI";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

type Department = "Physio" | "Dental";
type ExportType = "patients" | "appointments" | "sessions" | "payments" | "expenses" | "salary";

function typeAllowed(context: Awaited<ReturnType<typeof requireCurrentAccessContext>>, type: ExportType, department: Department): boolean {
  if (type === "patients") return canPerform(context, "report.read_operational", department) && canPerform(context, "patient.read", department);
  if (type === "appointments") return canPerform(context, "report.read_operational", department) && canPerform(context, "appointment.read", department);
  if (type === "sessions") return canPerform(context, "report.read_operational", department) && canPerform(context, "clinical.read", department);
  if (type === "salary") return canPerform(context, "report.read_financial", department) && canPerform(context, "salary.read", department);
  return canPerform(context, "report.read_financial", department);
}

export default async function CsvExportPage() {
  const context = await requireCurrentAccessContext();
  const allTypes: ExportType[] = ["patients", "appointments", "sessions", "payments", "expenses", "salary"];
  const departments = (["Physio", "Dental"] as Department[]).filter((department) =>
    allTypes.some((type) => typeAllowed(context, type, department))
  );
  const allowedTypes = allTypes.filter((type) => departments.some((department) => typeAllowed(context, type, department)));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <PageHeading title="CSV export" subtitle="Permission-scoped operational and finance data export" />
        <Link href="/reports" className="flex min-h-11 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">Back</Link>
      </div>
      {allowedTypes.length > 0 && departments.length > 0 ? (
        <CsvExportClient allowedTypes={allowedTypes} allowedDepartments={departments} />
      ) : (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">This account has no exportable report scope.</div>
      )}
    </div>
  );
}
