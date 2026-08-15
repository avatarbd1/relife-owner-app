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
              Telegram → Web parity
            </p>
            <h1 className="mt-1 text-lg font-semibold">🗑️ আজকের এন্ট্রি মুছুন</h1>
            <p className="mt-1 text-xs leading-5 text-slate-300">
              শুধু আপনার নিজের আজকের entry। Patient-এর latest entry না হলে, stale balance হলে বা department mismatch হলে delete হবে না।
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
        Delete মানে শুধু row মুছা নয়: patient Paid/Due reverse হবে, Physio package session থাকলে ফেরত যাবে, তারপর Delete_Log + audit record লেখা হবে।
      </section>

      <OwnCorrectionsClient entries={entries} />
    </div>
  );
}
