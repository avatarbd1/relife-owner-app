"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Entry = {
  receiptNo: string;
  department: "Physio" | "Dental";
  patientId: string;
  patientName: string;
  amount: number;
  discount: number;
  due: number;
  sessions: number;
  receivedBy: string;
  paymentMethod: string;
};

function bdt(value: number): string {
  return `৳${new Intl.NumberFormat("en-BD", { maximumFractionDigits: 0 }).format(value)}`;
}

export default function OwnCorrectionsClient({ entries }: { entries: Entry[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function remove(entry: Entry) {
    const confirmed = window.confirm(
      `${entry.receiptNo} · ${entry.patientName}\n${bdt(entry.amount)} entry delete + reverse করবেন?\n\nশুধু আজকের নিজের latest entry-ই delete হবে।`
    );
    if (!confirmed) return;

    setBusy(`${entry.department}:${entry.receiptNo}`);
    setMessage(null);
    try {
      const response = await fetch("/api/corrections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          department: entry.department,
          receiptNo: entry.receiptNo,
          confirmReceiptNo: entry.receiptNo,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "CORRECTION_FAILED");
      }
      setMessage(
        `✓ ${entry.receiptNo} reversed · ${entry.department} · ${bdt(Number(payload.reversedAmount || 0))}`
      );
      if (navigator.vibrate) navigator.vibrate(20);
      router.refresh();
    } catch (error) {
      setMessage(`✕ ${error instanceof Error ? error.message : "Correction failed"}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {message && (
        <p
          role="status"
          className={`rounded-xl p-3 text-xs ${
            message.startsWith("✓")
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {message}
        </p>
      )}

      {entries.map((entry) => {
        const key = `${entry.department}:${entry.receiptNo}`;
        return (
          <section
            key={key}
            className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {entry.patientName || entry.patientId}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {entry.receiptNo} · {entry.department} · {entry.patientId}
                </p>
              </div>
              <p className="shrink-0 text-base font-bold text-slate-900">
                {bdt(entry.amount)}
              </p>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
              {entry.sessions > 0 && <span>{entry.sessions} session</span>}
              {entry.discount > 0 && <span>Discount {bdt(entry.discount)}</span>}
              <span>Due snapshot {bdt(entry.due)}</span>
              {entry.paymentMethod && <span>{entry.paymentMethod}</span>}
            </div>
            <p className="mt-2 text-[10px] text-slate-400">
              Entry by {entry.receivedBy}
            </p>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => remove(entry)}
              className="mt-3 min-h-11 w-full rounded-xl bg-red-600 px-4 text-xs font-semibold text-white active:scale-[0.99] disabled:opacity-40"
            >
              {busy === key ? "Reversing…" : "🗑️ Delete + reverse"}
            </button>
          </section>
        );
      })}

      {entries.length === 0 && (
        <section className="rounded-2xl bg-white p-6 text-center text-sm text-slate-400 shadow-sm ring-1 ring-slate-200">
          আজ আপনার নামে correction-যোগ্য payment/session entry নেই।
        </section>
      )}
    </div>
  );
}
