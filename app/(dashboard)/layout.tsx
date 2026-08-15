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
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-900 px-4 pb-2 pt-[max(env(safe-area-inset-top),0.45rem)] shadow-sm">
        <div className="flex min-h-9 items-center justify-between gap-3">
          <div className="min-w-0 leading-tight">
            <p className="text-[9px] font-semibold uppercase tracking-[0.17em] text-slate-400">
              Relife Clinic
            </p>
            <p className="mt-0.5 truncate text-[12px] font-medium text-slate-200">
              {isOwner ? "Owner workspace" : roleLabel}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {!IS_LIVE_DATA && (
              <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[9px] font-semibold text-amber-300">
                Sample
              </span>
            )}
            <ProfileMenu roleLabel={roleLabel} isOwner={isOwner} />
          </div>
        </div>
      </header>

      <main className="flex-1 bg-slate-50 px-4 py-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
        {children}
      </main>

      <BottomNav
        roles={context.roles}
        actions={actions}
        hasPhysioAccess={hasPhysioAccess}
      />
    </div>
  );
}
