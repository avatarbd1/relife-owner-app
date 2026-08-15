"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Movement = {
  movementId: string;
  date: string;
  department: "Physio" | "Dental";
  fromCustodian: string;
  toCustodian: string;
  requestedAmount: number;
  movedBy: string;
  note: string;
  requestedAt: string;
};

function bdt(value: number): string {
  return `৳${new Intl.NumberFormat("en-BD", { maximumFractionDigits: 0 }).format(value)}`;
}

export default function CashAcceptanceClient({ movements }: { movements: Movement[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [received, setReceived] = useState<Record<string, string>>(
    Object.fromEntries(movements.map((item) => [item.movementId, String(item.requestedAmount)]))
  );
  const [message, setMessage] = useState<string | null>(null);

  async function decide(item: Movement, decision: "Accepted" | "Rejected") {
    setBusy(item.movementId);
    setMessage(null);
    try {
      const response = await fetch("/api/finance/cash/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          movementId: item.movementId,
          department: item.department,
          decision,
          receivedAmount: decision === "Accepted" ? Number(received[item.movementId] || 0) : undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "CASH_ACCEPT_FAILED");
      const difference = Number(payload.difference || 0);
      setMessage(
        decision === "Accepted"
          ? `✓ ${item.movementId} গ্রহণ হয়েছে${difference ? ` · Difference ${bdt(difference)}` : ""}`
          : `✓ ${item.movementId} rejected`
      );
      if (navigator.vibrate) navigator.vibrate(18);
      router.refresh();
    } catch (error) {
      setMessage(`✕ ${error instanceof Error ? error.message : "Action failed"}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {message && (
        <p className={`rounded-xl p-3 text-xs ${message.startsWith("✓") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`} role="status">
          {message}
        </p>
      )}
      {movements.map((item) => (
        <section key={`${item.department}-${item.movementId}`} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">{item.fromCustodian} → {item.toCustodian}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">{item.movementId} · {item.department} · {item.date}</p>
            </div>
            <p className="shrink-0 text-base font-bold text-slate-900">{bdt(item.requestedAmount)}</p>
          </div>
          <p className="mt-2 text-xs text-slate-500">Moved by {item.movedBy || "Unknown"}{item.requestedAt ? ` · ${item.requestedAt}` : ""}</p>
          {item.note && <p className="mt-2 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">{item.note}</p>}

          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-slate-600">Actual received amount</label>
            <input
              type="number"
              min="0"
              step="1"
              value={received[item.movementId] ?? String(item.requestedAmount)}
              onChange={(event) => setReceived((current) => ({ ...current, [item.movementId]: event.target.value }))}
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
            />
            <p className="mt-1 text-[10px] text-slate-400">Requested {bdt(item.requestedAmount)} · কম/বেশি হলে Difference record হবে।</p>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => decide(item, "Rejected")}
              className="min-h-11 rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 disabled:opacity-40"
            >
              Reject
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => decide(item, "Accepted")}
              className="min-h-11 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white disabled:opacity-40"
            >
              {busy === item.movementId ? "Saving…" : "✅ গ্রহণ"}
            </button>
          </div>
        </section>
      ))}
      {movements.length === 0 && (
        <section className="rounded-2xl bg-white p-6 text-center text-sm text-slate-400 shadow-sm ring-1 ring-slate-200">
          Pending cash handover নেই।
        </section>
      )}
    </div>
  );
}
