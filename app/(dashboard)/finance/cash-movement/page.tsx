import Link from "next/link";
import { cookies } from "next/headers";
import CashMovementForm from "@/components/CashMovementForm";
import { PageHeading } from "@/components/WorkspaceUI";
import type { Scope } from "@/lib/types";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { resolveAuthorizedScope } from "@/lib/webos/scope";

function readScope(value: string | undefined): Scope {
  if (value === "physio" || value === "dental" || value === "combined") return value;
  return "combined";
}

export default async function CashMovementPage() {
  const cookieStore = await cookies();
  const context = await requireCurrentAccessContext();
  const scope = readScope(cookieStore.get("relife_scope")?.value);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <PageHeading
          title="Cash Movement"
          subtitle="Request transfer between Reception → Treasury → Bank"
        />
        <Link
          href="/finance/operations"
          className="relife-interactive rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600"
        >
          Back
        </Link>
      </div>

      <CashMovementForm scope={scope} context={context} />
    </div>
  );
}
