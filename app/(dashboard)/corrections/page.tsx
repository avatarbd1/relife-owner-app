import Link from "next/link";
import OwnCorrectionsClient from "@/components/OwnCorrectionsClient";
import { listOwnTodayCorrectionEntries } from "@/lib/webos/ownCorrections";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

export default async function CorrectionsPage() {
  const context = await requireCurrentAccessContext();
  const entries = await listOwnTodayCorrectionEntries(context);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-slate-900 p-4 text-white shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
              Safe correction
            </p>
            <h1 className="mt-1 text-lg font-semibold">↩️ আজকের payment reverse</h1>
            <p className="mt-1 text-xs leading-5 text-slate-300">
              শুধু আপনার নিজের আজকের latest entry। Patient state stale হলে, পরে আরেকটি payment থাকলে বা department mismatch হলে reverse হবে না।
            </p>
          </div>
          <Link
            href="/menu"
            className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white"
          >
            Menu
          </Link>
        </div>
      </section>

      <section className="rounded-2xl bg-amber-50 p-3 text-xs leading-5 text-amber-800 ring-1 ring-amber-200">
        Original payment row delete হবে না। একটি negative reversal row যোগ হবে, patient Paid/Due reverse হবে, Physio package session থাকলে ফেরত যাবে এবং correction log + audit record লেখা হবে।
      </section>

      <OwnCorrectionsClient entries={entries} />
    </div>
  );
}
