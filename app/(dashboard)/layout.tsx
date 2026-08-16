import BottomNav from "@/components/BottomNav";
import ChamberAlertListener from "@/components/ChamberAlertListener";
import InteractionLayer from "@/components/InteractionLayer";
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
  const canChamber = hasPhysioAccess && actions.includes("chamber.read");
  const isOwner = context.roles.includes("Owner");

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <header className="relife-app-header sticky top-0 z-20 border-b border-slate-800/90 bg-slate-950 px-4 pb-2.5 pt-[max(env(safe-area-inset-top),0.55rem)] shadow-sm sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-10 w-full max-w-7xl items-center justify-between gap-3">
          <div className="min-w-0 leading-tight">
            <p className="relife-app-brand text-[9px] font-semibold uppercase tracking-[0.18em] text-blue-200">
              Relife Clinic OS
            </p>
            <p className="mt-0.5 truncate text-xs font-medium text-slate-200">
              {isOwner ? "Owner workspace" : roleLabel}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {!IS_LIVE_DATA && (
              <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-[9px] font-semibold text-amber-300 ring-1 ring-amber-300/10">
                Sample
              </span>
            )}
            <ProfileMenu roleLabel={roleLabel} isOwner={isOwner} />
          </div>
        </div>
      </header>

      <main
        data-dashboard-content
        className="relife-dashboard-content flex-1 bg-slate-50 px-4 py-4 pb-[calc(4.75rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:py-6"
      >
        {children}
      </main>

      <InteractionLayer />
      {canChamber && <ChamberAlertListener currentStaffId={context.staffId} />}
      <BottomNav
        roles={context.roles}
        actions={actions}
        hasPhysioAccess={hasPhysioAccess}
      />
    </div>
  );
}
