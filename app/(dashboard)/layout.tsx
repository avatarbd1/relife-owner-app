import { cookies } from "next/headers";
import ScopeSelector from "@/components/ScopeSelector";
import BottomNav from "@/components/BottomNav";
import LogoutButton from "@/components/LogoutButton";
import { IS_LIVE_DATA } from "@/lib/data";
import { actionsForRoles, type WebRole } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import {
  allowedScopesForContext,
  resolveAuthorizedScope,
} from "@/lib/webos/scope";

function displayRole(role: WebRole): string {
  return role === "Dental_Assistant" ? "Dental Assistant" : role;
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [cookieStore, context] = await Promise.all([
    cookies(),
    requireCurrentAccessContext(),
  ]);
  const allowedScopes = allowedScopesForContext(context);
  const scope = resolveAuthorizedScope(
    context,
    cookieStore.get("relife_scope")?.value
  );
  const roleLabel = context.roles.map(displayRole).join(" · ");
  const actions = actionsForRoles(context.roles);
  const hasPhysioAccess =
    context.departmentAccess.includes("Physio") ||
    context.departmentAccess.includes("All");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 bg-slate-900 px-4 pb-3 pt-[max(env(safe-area-inset-top),0.75rem)] shadow-sm">
        <div className="flex min-h-12 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
              Relife Clinic
            </p>
            <h1 className="truncate text-lg font-semibold leading-tight text-white">
              {roleLabel}
            </h1>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {!IS_LIVE_DATA && (
              <span className="rounded-full bg-amber-400/20 px-2.5 py-1 text-[10px] font-medium text-amber-300">
                Sample
              </span>
            )}
            <ScopeSelector current={scope} allowed={allowedScopes} />
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="flex-1 bg-slate-100 px-4 py-4 pb-24">{children}</main>

      <BottomNav
        roles={context.roles}
        actions={actions}
        hasPhysioAccess={hasPhysioAccess}
      />
    </div>
  );
}
