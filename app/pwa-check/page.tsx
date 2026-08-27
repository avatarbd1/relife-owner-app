import PwaStatusClient from "@/components/PwaStatusClient";

export default function PwaCheckPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <section className="overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 to-blue-950 p-5 text-white shadow-lg">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">Relife PWA diagnostic</p>
          <h1 className="mt-1 text-2xl font-bold">Install & service worker check</h1>
          <p className="mt-1 text-xs leading-5 text-slate-300">Public technical diagnostics only; no clinic data is exposed here.</p>
        </section>
        <PwaStatusClient />
      </div>
    </main>
  );
}
