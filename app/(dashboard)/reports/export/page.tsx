import Link from "next/link";
import { cookies } from "next/headers";
import CsvExportClient from "@/components/CsvExportClient";
import { PageHeading } from "@/components/WorkspaceUI";
import type { Scope } from "@/lib/types";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { resolveAuthorizedScope } from "@/lib/webos/scope";
import { canPerform } from "@/lib/webos/access";

function readScope(value: string | undefined): Scope {
  if (value === "physio" || value === "dental" || value === "combined") return value;
  return "combined";
}

export default async function ExportPage() {
  const cookieStore = await cookies();
  const context = await requireCurrentAccessContext();
  const scope = readScope(cookieStore.get("relife_scope")?.value);

  const canExportPhysio = canPerform(context, "patient.read", "Physio") || canPerform(context, "appointment.read", "Physio");
  const canExportDental = canPerform(context, "patient.read", "Dental") || canPerform(context, "appointment.read", "Dental");

  if (!canExportPhysio && !canExportDental) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <PageHeading title="Data Export" subtitle="Export patients, appointments, and sessions" />
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          এই account-এ data export permission নেই।
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <PageHeading title="Data Export" subtitle="Export patients, appointments, sessions, and transactions to CSV" />
        <Link
          href="/reports"
          className="relife-interactive rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600"
        >
          Back
        </Link>
      </div>

      <CsvExportClient scope={scope} canExportPhysio={canExportPhysio} canExportDental={canExportDental} />
    </div>
  );
}
