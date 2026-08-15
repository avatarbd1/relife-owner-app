import { redirect } from "next/navigation";
import SettingsAdminClient from "@/components/SettingsAdminClient";
import { StatusBadge } from "@/components/FeedbackUI";
import { actionsForRoles, type WebRole } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { getWebStaffDirectory, toAccessContext } from "@/lib/webos/staffDirectory";

const ROLES: WebRole[] = [
  "Owner",
  "Manager",
  "Receptionist",
  "Therapist",
  "Dentist",
  "Dental_Assistant",
  "Auditor",
  "System Admin",
];

export default async function SettingsPage() {
  const context = await requireCurrentAccessContext();
  if (!context.roles.includes("Owner") && !context.roles.includes("System Admin")) {
    redirect("/more");
  }

  const directory = await getWebStaffDirectory();
  const active = directory.filter((item) => item.status === "Active");
  const roles = ROLES.map((role) => ({
    role,
    actions: actionsForRoles([role]).sort(),
    staffCount: active.filter((staff) => staff.roles.includes(role)).length,
  }));
  const staff = active.map((item) => ({
    staffId: item.staffId,
    fullName: item.fullName,
    roles: item.roles,
    departments: item.departmentAccess,
    ready: Boolean(toAccessContext(item)),
  }));

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 to-blue-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">Administration</p>
            <h1 className="mt-1 text-2xl font-bold">Settings & administration</h1>
            <p className="mt-1 text-xs leading-5 text-slate-300">System defaults, access posture, supported data tools and backup capability status.</p>
          </div>
          <StatusBadge tone="success" className="border-white/10">Server enforced</StatusBadge>
        </div>
      </section>

      <SettingsAdminClient roles={roles} staff={staff} />
    </div>
  );
}
