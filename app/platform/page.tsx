import { notFound } from "next/navigation";
import PlatformOwnerConsole from "@/components/platform/PlatformOwnerConsole";
import { listPlatformOwnerSnapshot } from "@/lib/data/platformOwner";
import { getCurrentPlatformOwner } from "@/lib/platform/currentPlatformOwner";

export const dynamic = "force-dynamic";

export default async function PlatformOwnerPage() {
  if (!(await getCurrentPlatformOwner())) notFound();
  const snapshot = await listPlatformOwnerSnapshot();
  return (
    <main className="min-h-dvh bg-slate-50 pb-10">
      <header className="border-b border-slate-800 bg-slate-950 px-4 py-4 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-200">Clinic SaaS Control Plane</p>
            <h1 className="mt-1 text-lg font-bold">Platform Owner</h1>
            <p className="mt-0.5 text-xs text-slate-400">Global platform authority · no clinic tenant binding</p>
          </div>
          <span className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300">Platform workspace</span>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-5">
        <PlatformOwnerConsole initialSnapshot={snapshot} />
      </div>
    </main>
  );
}
