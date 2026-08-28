import { notFound } from "next/navigation";
import PlatformOwnerConsole from "@/components/platform/PlatformOwnerConsole";
import { callPlatformControl } from "@/lib/data/platformControlClient";
import type { PlatformOwnerSnapshot } from "@/lib/data/platformOwner";
import { getCurrentPlatformOwner } from "@/lib/platform/currentPlatformOwner";

export const dynamic = "force-dynamic";

export default async function PlatformOwnerPage() {
  const owner = await getCurrentPlatformOwner();
  if (!owner) notFound();

  let snapshot: PlatformOwnerSnapshot;
  try {
    const result = await callPlatformControl<{ ok: true; snapshot: PlatformOwnerSnapshot }>({
      action: "snapshot",
      actorStaffId: owner.staffId,
    });
    snapshot = result.snapshot;
  } catch (error) {
    const code = error instanceof Error ? error.message : "PLATFORM_CONTROL_UNAVAILABLE";
    return (
      <main className="min-h-dvh bg-slate-50 px-4 py-8">
        <div className="mx-auto max-w-lg rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-700">Platform infrastructure</p>
          <h1 className="mt-2 text-lg font-bold text-slate-950">Platform workspace is temporarily unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">Your Platform Owner session is valid. Clinic tenant access is not being used.</p>
          <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs text-slate-600">{code}</p>
          <a href="/platform" className="mt-4 inline-flex min-h-10 items-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">Retry</a>
        </div>
      </main>
    );
  }

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
