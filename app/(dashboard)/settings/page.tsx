import { redirect } from "next/navigation";
import V1SettingsClient from "@/components/V1SettingsClient";
import { getCurrentStaffIdentity, requireCurrentAccessContext } from "@/lib/webos/currentUser";

export default async function SettingsPage() {
  const [context, identity] = await Promise.all([
    requireCurrentAccessContext(),
    getCurrentStaffIdentity(),
  ]);
  if (!identity) redirect("/login");

  const roleLabel = identity.roles.length > 0 ? identity.roles.join(" · ") : "Staff";
  const isOwner = context.roles.includes("Owner");

  return (
    <div className="mx-auto w-full max-w-xl space-y-5">
      <header className="px-1 pt-1">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Settings</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Account & clinic</h1>
        <p className="mt-1 text-sm leading-5 text-slate-500">Only settings backed by a real server workflow are editable.</p>
      </header>

      <V1SettingsClient
        initialProfile={{
          staffId: identity.staffId,
          fullName: identity.fullName,
          phone: identity.phone,
          roleLabel,
          departments: identity.departmentAccess,
        }}
        isOwner={isOwner}
      />
    </div>
  );
}
