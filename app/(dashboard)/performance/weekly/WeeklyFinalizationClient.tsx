"use client";

import { useState } from "react";

interface WeeklyPerformanceRow {
  id: string;
  staffId: string;
  department: string;
  roleContext: string;
  normalizedScore: number | null;
  provisionalScore: number | null;
  scoreCoveredWeight: number;
  missingScoreMetrics: string[];
  rank: number | null;
  rewardCreditsEarned: number;
  eligibilityReason: string;
  scoreConfigVersion: number | null;
  earningConfigVersion: number | null;
}

interface Finalization {
  finalizationId: string;
  weekStart: string;
  weekEnd: string;
  status: string;
  triggerSource: string;
  resultSummary: Record<string, unknown>;
  performance: WeeklyPerformanceRow[];
}

function metricLabel(key: string): string {
  const labels: Record<string, string> = {
    quality: "Quality verified source",
    reliability: "Reliability verified source",
    appointment_accuracy: "Appointment Accuracy verified source",
    error_control: "Error Control verified source",
    cash_accuracy: "Cash reconciliation source",
    documentation: "Treatment documentation source",
    attendance: "Attendance source",
    productivity: "Completed-session source",
    workflow: "Workflow source",
    role_config_or_verified_sources: "Role config / verified sources",
  };
  return labels[key] || key.replaceAll("_", " ");
}

function eligibilityLabel(reason: string): string {
  const labels: Record<string, string> = {
    eligible: "RC earned",
    not_eligible_incomplete_score: "No RC · incomplete official score",
    not_eligible_earning_disabled: "No RC · earning config disabled",
    not_eligible_no_tier: "No RC · no matching tier",
    not_eligible_role_config: "No RC · role config unavailable",
  };
  return labels[reason] || reason.replaceAll("_", " ");
}

function PerformanceCard({ row }: { row: WeeklyPerformanceRow }) {
  const official = row.normalizedScore !== null;
  const score = official ? row.normalizedScore : row.provisionalScore;
  const coverage = Math.round(Math.max(0, Math.min(1, row.scoreCoveredWeight)) * 100);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-950">{row.staffId}</p>
          <p className="mt-0.5 text-[10px] text-slate-500">
            {row.roleContext} · {row.department}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${
            official
              ? "bg-emerald-50 text-emerald-700"
              : "bg-amber-50 text-amber-800"
          }`}
        >
          {official ? `Official${row.rank ? ` · #${row.rank}` : ""}` : "Provisional"}
        </span>
      </div>

      <div className="mt-3 flex items-end gap-2">
        <p className="text-2xl font-black tabular-nums text-slate-950">
          {score === null ? "—" : score.toFixed(1)}
        </p>
        <p className="pb-1 text-xs font-semibold text-slate-500">/100</p>
      </div>
      {!official && (
        <p className="mt-1 text-xs font-semibold text-amber-800">
          {coverage}% verified metric coverage
        </p>
      )}

      {!official && row.missingScoreMetrics.length > 0 && (
        <div className="mt-3 rounded-xl bg-amber-50 p-3">
          <p className="text-[10px] font-bold text-amber-950">Incomplete — verified sources missing</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {row.missingScoreMetrics.map((metric) => (
              <span
                key={metric}
                className="rounded-full bg-white px-2 py-1 text-[9px] font-semibold text-amber-900 ring-1 ring-amber-200"
              >
                {metricLabel(metric)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-[10px]">
        <span className="font-semibold text-slate-600">{eligibilityLabel(row.eligibilityReason)}</span>
        <span className="font-bold text-violet-700">
          {row.rewardCreditsEarned > 0 ? `+${row.rewardCreditsEarned} RC` : "0 RC"}
        </span>
      </div>
      <p className="mt-2 text-[9px] text-slate-400">
        Score config v{row.scoreConfigVersion ?? "—"} · Earning config v{row.earningConfigVersion ?? "—"}
      </p>
    </div>
  );
}

export function WeeklyFinalizationClient({
  initialFinalization,
}: {
  initialFinalization: Finalization | null;
}) {
  const [finalization, setFinalization] = useState<Finalization | null>(initialFinalization);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    const response = await fetch("/api/v1/gamification/weekly/finalize", {
      method: "GET",
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) {
      throw new Error(String(payload?.error || "Weekly finalization status failed"));
    }
    setFinalization(payload.finalization || null);
  }

  async function finalizePreviousWeek() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/gamification/weekly/finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok !== true) {
        throw new Error(String(payload?.error || "Weekly finalization failed"));
      }
      setMessage(
        payload.alreadyFinalized
          ? "Previous week was already finalized. No duplicate score or RC was created."
          : `Week ${payload.weekStart} → ${payload.weekEnd} finalized.`
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Weekly finalization failed");
    } finally {
      setBusy(false);
    }
  }

  const official = finalization?.performance.filter((row) => row.normalizedScore !== null) || [];
  const provisional = finalization?.performance.filter((row) => row.normalizedScore === null) || [];
  const earningEnabled = finalization?.resultSummary?.earningEnabled === true;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-950">Weekly finalizer recovery</h2>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Monday cron-এর একই idempotent finalizer manually retry করুন। Finalized week আবার চালালে duplicate RC হবে না।
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={finalizePreviousWeek}
            className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Finalizing…" : "Finalize previous week"}
          </button>
        </div>
        {message && (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">{message}</p>
        )}
      </section>

      {!finalization ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-xs leading-5 text-slate-500">
          কোনো weekly finalization snapshot এখনও নেই। Cron বা Owner recovery run-এর পর এখানে immutable week snapshot দেখা যাবে।
        </section>
      ) : (
        <>
          <section className="rounded-2xl bg-slate-950 p-4 text-white shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Latest finalized week</p>
            <p className="mt-1 text-lg font-black">{finalization.weekStart} → {finalization.weekEnd}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-white/[0.07] p-2.5">
                <p className="text-base font-black">{official.length}</p>
                <p className="text-[9px] text-slate-400">Official</p>
              </div>
              <div className="rounded-xl bg-white/[0.07] p-2.5">
                <p className="text-base font-black">{provisional.length}</p>
                <p className="text-[9px] text-slate-400">Provisional</p>
              </div>
              <div className="rounded-xl bg-white/[0.07] p-2.5">
                <p className="text-base font-black">{earningEnabled ? "On" : "Off"}</p>
                <p className="text-[9px] text-slate-400">RC earning</p>
              </div>
            </div>
          </section>

          {!earningEnabled && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
              Score-tier RC earning config এখন disabled। Verified scores snapshot হবে, কিন্তু Owner tier values lock না করা পর্যন্ত automatic RC earn হবে না।
            </section>
          )}

          {official.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-sm font-bold text-slate-950">Official leaderboard eligible</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {official.map((row) => <PerformanceCard key={row.id} row={row} />)}
              </div>
            </section>
          )}

          {provisional.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-sm font-bold text-slate-950">Provisional · awaiting verified sources</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {provisional.map((row) => <PerformanceCard key={row.id} row={row} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
