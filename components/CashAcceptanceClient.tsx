"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { InlineNotice, Spinner, StatusBadge } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

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
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  async function decide(item: Movement, decision: "Accepted" | "Rejected") {
    if (!isOnline) {
      setMessage("✕ Internet connection required for cash acceptance");
      haptic("error");
      return;
    }
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
      setMessage(decision === "Accepted" ? `✓ ${item.movementId} accepted${difference ? ` · Difference ${bdt(difference)}` : ""}` : `✓ ${item.movementId} rejected`);
      haptic("success");
      router.refresh();
    } catch (error) {
      setMessage(`✕ ${error instanceof Error ? error.message : "Action failed"}`);
      haptic("error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <InlineNotice tone="info" title="Cash custody transfer">Acceptance confirms the actual amount received. This is an internal cash movement, not an expense.</InlineNotice>
      {!isOnline && <InlineNotice tone="warning">Offline — receiver confirmation requires internet.</InlineNotice>}
      {message && <div className={message.startsWith("✓") ? "relife-success-flash" : "relife-error-shake"}><InlineNotice tone={message.startsWith("✓") ? "success" : "error"}>{message}</InlineNotice></div>}
      {movements.map((item) => {
        const actual = Number(received[item.movementId] ?? item.requestedAmount);
        const difference = Number.isFinite(actual) ? actual - item.requestedAmount : 0;
        const variance = item.requestedAmount > 0 ? Math.abs(difference) / item.requestedAmount : 0;
        const major = variance > 0.05;
        const matches = Math.abs(difference) <= 0.009;
        return (
          <section key={`${item.department}-${item.movementId}`} className={`rounded-xl border bg-white p-4 shadow-sm ${major ? "border-red-300" : matches ? "border-emerald-200" : "border-amber-200"}`}>
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-sm font-semibold text-slate-900">{item.fromCustodian} → {item.toCustodian}</p><p className="mt-0.5 text-[11px] text-slate-500">{item.movementId} · {item.department} · {item.date}</p></div>
              <div className="text-right"><p className="text-base font-bold tabular-nums text-slate-900">{bdt(item.requestedAmount)}</p><div className="mt-1"><StatusBadge tone="warning">Pending</StatusBadge></div></div>
            </div>
            <p className="mt-2 text-xs text-slate-500">Moved by {item.movedBy || "Unknown"}{item.requestedAt ? ` · ${item.requestedAt}` : ""}</p>
            {item.note && <p className="mt-2 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">{item.note}</p>}

            <div className="mt-3">
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">Actual received amount</label>
              <input type="number" min="0" step="1" value={received[item.movementId] ?? String(item.requestedAmount)} onChange={(event) => setReceived((current) => ({ ...current, [item.movementId]: event.target.value }))} className={`min-h-11 w-full rounded-lg border bg-white px-3 text-sm text-slate-900 outline-none focus:ring-2 ${major ? "border-red-400 focus:border-red-600 focus:ring-red-100" : matches ? "border-emerald-300 focus:border-emerald-600 focus:ring-emerald-100" : "border-amber-300 focus:border-amber-600 focus:ring-amber-100"}`} />
              {matches ? (
                <div className="mt-2"><InlineNotice tone="success">Matches ✓ · actual amount equals the requested amount.</InlineNotice></div>
              ) : (
                <div className="mt-2"><InlineNotice tone={major ? "error" : "warning"}>{difference < 0 ? "Shortfall" : "Excess"}: {bdt(Math.abs(difference))} · {(variance * 100).toFixed(1)}% variance. Accepted amount will drive the cash effect.</InlineNotice></div>
              )}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button type="button" disabled={!isOnline || busy !== null} onClick={() => decide(item, "Rejected")} className="min-h-11 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 hover:bg-red-50">Reject discrepancy</button>
              <button type="button" disabled={!isOnline || busy !== null} onClick={() => decide(item, "Accepted")} className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:shadow-none">{busy === item.movementId && <Spinner size="sm" className="border-white/30 border-t-white" label="Accepting handover" />}{busy === item.movementId ? "Saving…" : matches ? "Accept matched amount" : "Accept with discrepancy"}</button>
            </div>
          </section>
        );
      })}
      {movements.length === 0 && <InlineNotice tone="success">Pending cash handover নেই।</InlineNotice>}
    </div>
  );
}
