import Link from "next/link";
import { cookies } from "next/headers";
import DailyOperationsClient from "@/components/DailyOperationsClient";
import type { Department, Scope } from "@/lib/types";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { resolveAuthorizedScope } from "@/lib/webos/scope";
import { getDailyOperationsSnapshot } from "@/lib/webos/attendance";

function department(value: string): Department | null {
  if (value === "Physio" || value === "Dental" || value === "All") return value;
  return null;
}

const LABEL: Record<Scope, string> = { combined: "Combined", physio: "Physio", dental: "Dental" };

export default async function DailyPage() {
  const cookieStore = await cookies();
  const context = await requireCurrentAccessContext();
  const scope = resolveAuthorizedScope(context, cookieStore.get("relife_scope")?.value);
  const snapshot = await getDailyOperationsSnapshot(context, scope);
  const safeSnapshot = snapshot.attendance.canReadTeam
    ? {
        ...snapshot,
        attendance: {
          ...snapshot.attendance,
          team: snapshot.attendance.team.filter((staff) => {
            const target = department(staff.department);
            return target ? canPerform(context, "attendance.read_team", target) : false;
          }),
        },
      }
    : snapshot;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Web OS · W4</p>
          <h1 className="text-lg font-semibold text-slate-900">Daily Operations</h1>
          <p className="mt-0.5 text-xs text-slate-500">{safeSnapshot.date} · {LABEL[scope]}</p>
        </div>
        <Link href="/home" className="min-h-12 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 active:bg-slate-50">
          Home
        </Link>
      </div>
      <DailyOperationsClient snapshot={safeSnapshot} />
    </div>
  );
}
