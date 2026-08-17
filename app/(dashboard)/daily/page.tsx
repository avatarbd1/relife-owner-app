import Link from "next/link";
import { cookies } from "next/headers";
import DailyOperationsClient from "@/components/DailyOperationsClient";
import DailyRegisterBoard from "@/components/DailyRegisterBoard";
import { PageHeading } from "@/components/WorkspaceUI";
import type { Department, Scope } from "@/lib/types";
import { canPerform } from "@/lib/webos/access";
import { getDailyOperationsSnapshot } from "@/lib/webos/attendance";
import { getDailyRegisterSnapshot } from "@/lib/webos/dailyRegister";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { getDailyClinicalActivity } from "@/lib/webos/dailyClinicalActivity";
import { getPhysioInventorySnapshot } from "@/lib/webos/inventory";
import { resolveAuthorizedScope } from "@/lib/webos/scope";

function department(value: string): Department | null {
  if (value === "Physio" || value === "Dental" || value === "All") return value;
  return null;
}

const LABEL: Record<Scope, string> = {
  combined: "Combined",
  physio: "Physio",
  dental: "Dental",
};

export default async function DailyPage() {
  const cookieStore = await cookies();
  const context = await requireCurrentAccessContext();
  const scope = resolveAuthorizedScope(
    context,
    cookieStore.get("relife_scope")?.value
  );

  const snapshot = await getDailyOperationsSnapshot(context, scope);
  const registerData = await getDailyRegisterSnapshot(context, scope);

  const safeSnapshot = snapshot.attendance.canReadTeam
    ? {
        ...snapshot,
        attendance: {
          ...snapshot.attendance,
          team: snapshot.attendance.team.filter((staff) => {
            const target = department(staff.department);
            return target
              ? canPerform(context, "attendance.read_team", target)
              : false;
          }),
        },
      }
    : snapshot;

  const clinicalActivity = await getDailyClinicalActivity(scope, safeSnapshot.date);
  const activityCounts = {
    patients: clinicalActivity.patients,
    sessions: clinicalActivity.sessions,
    appointments: safeSnapshot.appointmentCounts.total,
  };

  // Get inventory alerts for physio if authorized
  const inventory = scope !== "dental" && canPerform(context, "inventory.read", "Physio")
    ? await getPhysioInventorySnapshot(context)
    : null;

  const lowStockCount = inventory?.items.filter((item) => item.lowStock).length || 0;

  return (
    <div className="space-y-4">
      <PageHeading
        title="Daily Operations"
        subtitle={`${safeSnapshot.date} · ${LABEL[scope]} · staff, patients, sessions & collections`}
        action={
          <Link
            href="/appointments"
            className="shrink-0 rounded-xl bg-blue-800 px-3.5 py-2.5 text-xs font-semibold text-white shadow-sm active:scale-[0.98]"
          >
            Schedule
          </Link>
        }
      />

      <DailyRegisterBoard
        registerData={registerData}
        activityCounts={activityCounts}
        lowStockCount={lowStockCount}
        isOwner={context.roles.includes("Owner")}
      />

      <DailyOperationsClient
        snapshot={safeSnapshot}
        activityCounts={activityCounts}
      />
    </div>
  );
}
