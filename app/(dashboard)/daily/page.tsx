import Link from "next/link";
import { cookies } from "next/headers";
import DailyOperationsClient from "@/components/DailyOperationsClient";
import { PageHeading } from "@/components/WorkspaceUI";
import { getPayments } from "@/lib/data";
import type { Department, Scope } from "@/lib/types";
import { canPerform } from "@/lib/webos/access";
import { getDailyOperationsSnapshot } from "@/lib/webos/attendance";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { resolveAuthorizedScope } from "@/lib/webos/scope";

function department(value: string): Department | null {
  if (value === "Physio" || value === "Dental" || value === "All") return value;
  return null;
}

function paymentInScope(scope: Scope, value: Department): boolean {
  if (value === "All") return false;
  if (scope === "combined") return value === "Physio" || value === "Dental";
  return value === (scope === "physio" ? "Physio" : "Dental");
}

function paymentSessionCount(remarks?: string): number {
  const match = /(?:^|\|)\s*Sessions:\s*(\d+)/i.exec(String(remarks || ""));
  if (!match) return 1;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
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

  const [snapshot, payments] = await Promise.all([
    getDailyOperationsSnapshot(context, scope),
    getPayments(),
  ]);

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

  const todayPayments = payments.filter(
    (payment) =>
      payment.date.trim().slice(0, 10) === safeSnapshot.date &&
      paymentInScope(scope, payment.department)
  );
  const patientKeys = new Set(
    todayPayments
      .map((payment) => {
        const identity = payment.patientId.trim() || payment.patientName.trim();
        return identity ? `${payment.department}:${identity}` : "";
      })
      .filter(Boolean)
  );
  const activityCounts = {
    patients: patientKeys.size,
    sessions: todayPayments.reduce(
      (sum, payment) => sum + paymentSessionCount(payment.remarks),
      0
    ),
    appointments: safeSnapshot.appointmentCounts.total,
  };

  return (
    <div>
      <PageHeading
        title="Daily Operations"
        subtitle={`${safeSnapshot.date} · ${LABEL[scope]} · attendance & patient flow`}
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
