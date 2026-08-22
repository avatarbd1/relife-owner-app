"use client";

import { useState } from "react";

type MonthlyFinalization = {
  finalizationId: string;
  month: string;
  status: string;
  resultSummary: Record<string, unknown>;
};

export function MonthlyFinalizationClient({
  initialFinalization,
}: {
  initialFinalization: MonthlyFinalization | null;
}) {
  const [month, setMonth] = useState("");
  const [finalization, setFinalization] = useState(initialFinalization);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function finalize() {
    if (!month) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/gamification/monthly/finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ month }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) throw new Error(String(payload.error || "MONTHLY_FINALIZE_FAILED"));
      setMessage(payload.alreadyFinalized ? "এই month আগে finalize হয়েছে; duplicate RC হয়নি।" : `${month} RC finalized হয়েছে।`);
      const statusResponse = await fetch(`/api/v1/gamification/monthly/finalize?month=${encodeURIComponent(month)}`, { cache: "no-store" });
      const statusPayload = await statusResponse.json().catch(() => ({}));
      if (statusResponse.ok && statusPayload.ok === true) setFinalization(statusPayload.finalization || null);
    } catch (error) {
      const code = error instanceof Error ? error.message : "MONTHLY_FINALIZE_FAILED";
      const labels: Record<string, string> = {
        MONTH_NOT_FINISHED: "Month শেষ হওয়ার আগে RC finalize করা যাবে না।",
        MONTHLY_ROSTER_NOT_PUBLISHED: "৭ জনের Published Staff_Shifts সম্পূর্ণ নয়।",
        MONTHLY_SCORE_INCOMPLETE: "সব verified weekly official score complete নয়; কোনো RC লেখা হয়নি।",
        MONTHLY_REWARD_CONFIG_MISSING: "Monthly RC policy এখনও provision হয়নি।",
      };
      setMessage(labels[code] || code);
    } finally {
      setBusy(false);
    }
  }

  const summary = finalization?.resultSummary || {};
  const allocations = Array.isArray(summary.allocations) ? summary.allocations as Array<Record<string, unknown>> : [];

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-sm font-bold text-slate-950">Monthly RC finalizer</h2>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          ৳1600 = 160 RC; 6 RC reserve। Official role-normalized score tiers: 90→22, 80→18, 70→14, 60→8।
        </p>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm"
          />
          <button
            type="button"
            disabled={!month || busy}
            onClick={finalize}
            className="min-h-11 rounded-xl bg-violet-700 px-4 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy ? "Checking…" : "Finalize RC"}
          </button>
        </div>
        {message && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">{message}</p>}
      </section>

      {finalization && (
        <section className="rounded-2xl bg-slate-950 p-4 text-white shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Finalized month</p>
          <p className="mt-1 text-lg font-black">{finalization.month}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl bg-white/10 p-3">
              <p className="text-lg font-black">{Number(summary.awardedCredits || 0)}</p>
              <p className="text-[9px] text-slate-400">RC awarded</p>
            </div>
            <div className="rounded-xl bg-white/10 p-3">
              <p className="text-lg font-black">{Number(summary.reserveCredits || 0)}</p>
              <p className="text-[9px] text-slate-400">RC remaining</p>
            </div>
          </div>
          {allocations.length > 0 && (
            <div className="mt-3 space-y-1 text-xs">
              {allocations.map((item) => (
                <div key={String(item.staffId)} className="flex justify-between rounded-lg bg-white/5 px-3 py-2">
                  <span>{String(item.staffId)} · {Number(item.officialScore || 0).toFixed(1)}</span>
                  <span className="font-bold">+{Number(item.rewardCredits || 0)} RC</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
