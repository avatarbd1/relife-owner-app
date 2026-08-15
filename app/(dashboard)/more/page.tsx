import Link from "next/link";
import { cookies } from "next/headers";
import OwnerControlsClient from "@/components/OwnerControlsClient";
import { getOwnerControlSnapshot } from "@/lib/controls";
import type { Scope } from "@/lib/types";

function readScope(value: string | undefined): Scope {
  if (value === "physio" || value === "dental" || value === "combined") {
    return value;
  }
  return "combined";
}

export default async function MorePage() {
  const cookieStore = await cookies();
  const scope = readScope(cookieStore.get("relife_scope")?.value);
  const snapshot = await getOwnerControlSnapshot();

  const scopedSnapshot =
    scope === "combined"
      ? snapshot
      : {
          ...snapshot,
          pendingExpenses: snapshot.pendingExpenses.filter(
            (item) => item.workbook === scope
          ),
          pendingCashMovements: snapshot.pendingCashMovements.filter(
            (item) => item.workbook === scope
          ),
        };

  return (
    <div className="space-y-4">
      <Link
        href="/security/passkeys"
        className="flex min-h-14 items-center justify-between rounded-2xl bg-slate-900 px-4 py-3 text-white shadow-sm transition duration-150 active:scale-[0.99] motion-reduce:transition-none"
      >
        <div>
          <p className="text-sm font-semibold">🔐 Fingerprint / Face ID</p>
          <p className="mt-0.5 text-xs text-slate-400">Add or remove secure device passkeys</p>
        </div>
        <span aria-hidden="true" className="text-slate-400">›</span>
      </Link>

      <Link
        href="/security/staff-access"
        className="flex min-h-14 items-center justify-between rounded-2xl bg-white px-4 py-3 text-slate-900 shadow-sm ring-1 ring-slate-200 transition duration-150 active:scale-[0.99] motion-reduce:transition-none"
      >
        <div>
          <p className="text-sm font-semibold">👥 Staff Web Access</p>
          <p className="mt-0.5 text-xs text-slate-500">Create secure first-time setup links</p>
        </div>
        <span aria-hidden="true" className="text-slate-400">›</span>
      </Link>

      <OwnerControlsClient snapshot={scopedSnapshot} />
    </div>
  );
}
