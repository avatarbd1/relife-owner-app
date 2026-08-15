import BottomNav from "@/components/BottomNav";
import ProfileMenu from "@/components/ProfileMenu";
import { IS_LIVE_DATA } from "@/lib/data";
import { actionsForRoles, type WebRole } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

function displayRole(role: WebRole): string {
  return role === "Dental_Assistant" ? "Dental Assistant" : role;
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await requireCurrentAccessContext();
  const roleLabel = context.roles.map(displayRole).join(" · ");
  const actions = actionsForRoles(context.roles);
  const hasPhysioAccess =
    context.departmentAccess.includes("Physio") ||
    context.departmentAccess.includes("All");
  const isOwner = context.roles.includes("Owner");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-900 px-4 pb-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <div className="flex min-h-12 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Relife Clinic
            </p>
            <p className="mt-0.5 truncate text-sm font-medium text-slate-200">
              {isOwner ? "Owner workspace" : roleLabel}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {!IS_LIVE_DATA && (
              <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-[10px] font-semibold text-amber-300">
                Sample
              </span>
            )}
            <ProfileMenu roleLabel={roleLabel} isOwner={isOwner} />
          </div>
        </div>
      </header>

      <main className="flex-1 bg-slate-50 px-4 py-4 pb-24">{children}</main>

      <BottomNav
        roles={context.roles}
        actions={actions}
        hasPhysioAccess={hasPhysioAccess}
      />
    </div>
  );
}
