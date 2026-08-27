import Link from "next/link";
import { cookies } from "next/headers";
import CashMovementForm from "@/components/CashMovementForm";
import { PageHeading } from "@/components/WorkspaceUI";
import type { Scope } from "@/lib/types";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { resolveAuthorizedScope } from "@/lib/webos/scope";

type Department = "Physio" | "Dental";

function scopeAllows(scope: Scope, department: Department): boolean {
  return scope === "combined" || (scope === "physio" ? department === "Physio" : department === "Dental");
}

export default async function CashMovementPage() {
  const [context, cookieStore] = await Promise.all([requireCurrentAccessContext(), cookies()]);
  const scope = resolveAuthorizedScope(context, cookieStore.get("relife_scope")?.value);
  const departments = (["Physio", "Dental"] as Department[]).filter(
    (department) => scopeAllows(scope, department) && canPerform(context, "cash.request", department)
  );

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <PageHeading title="Cash movement" subtitle="Request Reception cash custody transfer to Home Treasury or Bank" />
        <Link href="/finance/operations" className="flex min-h-11 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">Back</Link>
      </div>
      {departments.length > 0 ? (
        <CashMovementForm departments={departments} />
      ) : (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">No cash.request permission in the active scope.</div>
      )}
    </div>
  );
}
