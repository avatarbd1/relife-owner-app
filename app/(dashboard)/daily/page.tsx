import Link from "next/link";
import { cookies } from "next/headers";
import DailyOperationsClient from "@/components/DailyOperationsClient";
import type { Scope } from "@/lib/types";
import { getDailyOperationsSnapshot } from "@/lib/webos/attendance";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

function readScope(value: string | undefined): Scope {
  if (value === "physio" || value === "dental" || value === "combined") return value;
  return "combined";
}

const LABEL: Record<Scope, string> = { combined: "Combined", physio: "Physio", dental: "Dental" };

export default async function DailyPage() {
  const cookieStore = await cookies();
  const scope = readScope(cookieStore.get("relife_scope")?.value);
  const context = await requireCurrentAccessContext();
  const snapshot = await getDailyOperationsSnapshot(context, scope);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Web OS · W4</p>
          <h1 className="text-lg font-semibold text-slate-900">Daily Operations</h1>
          <p className="mt-0.5 text-xs text-slate-500">{snapshot.date} · {LABEL[scope]}</p>
        </div>
        <Link href="/home" className="min-h-12 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 active:bg-slate-50">
          Home
        </Link>
      </div>
      <DailyOperationsClient snapshot={snapshot} />
    </div>
  );
}
