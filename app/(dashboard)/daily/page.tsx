import Link from "next/link";
import { cookies } from "next/headers";
import DailyOperationsClient from "@/components/DailyOperationsClient";
import { PageHeading } from "@/components/WorkspaceUI";
import type { Department, Scope } from "@/lib/types";
import { canPerform } from "@/lib/webos/access";
import { getDailyOperationsSnapshot } from "@/lib/webos/attendance";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { getDailyClinicalActivity } from "@/lib/webos/dailyClinicalActivity";
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

  return (
    <div>
      <PageHeading
        title="Daily Operations"
        subtitle={`${safeSnapshot.date} · ${LABEL[scope]} · attendance & completed clinical work`}
        action={
          <Link
            href="/appointments"
            className="shrink-0 rounded-xl bg-blue-800 px-3.5 py-2.5 text-xs font-semibold text-white shadow-sm active:scale-[0.98]"
          >
            Schedule
          </Link>
        }
      />
      <DailyOperationsClient
        snapshot={safeSnapshot}
        activityCounts={activityCounts}
      />
    </div>
  );
}
