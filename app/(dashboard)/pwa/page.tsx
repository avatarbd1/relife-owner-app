import PwaStatusClient from "@/components/PwaStatusClient";
import { StatusBadge } from "@/components/FeedbackUI";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

export default async function PwaPage() {
  const context = await requireCurrentAccessContext();

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 to-blue-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">Mobile app</p>
            <h1 className="mt-1 text-2xl font-bold">PWA & device status</h1>
            <p className="mt-1 text-xs leading-5 text-slate-300">Installability, service worker, storage, performance and safe offline policy.</p>
          </div>
          <StatusBadge tone="info" className="border-white/10">{context.staffId}</StatusBadge>
        </div>
      </section>
      <PwaStatusClient />
    </div>
  );
}
