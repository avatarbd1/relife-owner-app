import { cookies } from "next/headers";
import ScopeSelector from "@/components/ScopeSelector";
import BottomNav from "@/components/BottomNav";
import { IS_LIVE_DATA } from "@/lib/data";
import type { Scope } from "@/lib/types";

function readScope(value: string | undefined): Scope {
  if (value === "physio" || value === "dental" || value === "combined") {
    return value;
  }
  return "combined";
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const scope = readScope(cookieStore.get("relife_scope")?.value);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 bg-slate-900 px-4 pb-4 pt-[max(env(safe-area-inset-top),1rem)]">
        <div className="flex items-center justify-between pb-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Relife Clinic
            </p>
            <h1 className="text-lg font-semibold text-white">Owner</h1>
          </div>
          {!IS_LIVE_DATA && (
            <span className="rounded-full bg-amber-400/20 px-2.5 py-1 text-[11px] font-medium text-amber-300">
              Sample data
            </span>
          )}
        </div>
        <ScopeSelector current={scope} />
      </header>

      <main className="flex-1 bg-slate-100 px-4 py-4 pb-24">{children}</main>

      <BottomNav />
    </div>
  );
}
