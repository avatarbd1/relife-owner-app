import { PageHeading } from "@/components/WorkspaceUI";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { getPerformanceSnapshot } from "@/lib/webos/performance";
import {
  PERFORMANCE_REWARD_CATALOG,
  PERFORMANCE_SALARY_POLICY,
  weeklyWinnerReward,
} from "@/lib/webos/performanceRewards";

function medal(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

export default async function PerformancePage() {
  const context = await requireCurrentAccessContext();
  const snapshot = await getPerformanceSnapshot(context);
  const winnerReward = weeklyWinnerReward(snapshot.leaderboard);
  const current = snapshot.current;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeading
        title="Performance"
        subtitle={`${snapshot.weekStart} → ${snapshot.weekEnd} · ${snapshot.scopeLabel}`}
      />

      <section className="mb-4 overflow-hidden rounded-2xl bg-gradient-to-br from-blue-950 via-slate-950 to-violet-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-200">
              Your weekly score
            </p>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-4xl font-black tabular-nums">{current.points}</span>
              <span className="pb-1 text-sm font-semibold text-blue-200">points</span>
            </div>
            <p className="mt-2 text-xs text-slate-300">
              Today +{current.todayPoints} · Rank {medal(current.rank)}
            </p>
          </div>
          <div className="rounded-2xl bg-white/10 px-4 py-3 text-center ring-1 ring-white/10">
            <p className="text-2xl">{current.rank <= 3 ? medal(current.rank) : "🎯"}</p>
            <p className="mt-1 text-[10px] font-semibold text-slate-300">This week</p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-white/[0.07] p-3 ring-1 ring-white/10">
            <p className="text-lg font-bold tabular-nums">{current.metrics.completedSessions}</p>
            <p className="mt-0.5 text-[9px] text-slate-400">Sessions</p>
          </div>
          <div className="rounded-xl bg-white/[0.07] p-3 ring-1 ring-white/10">
            <p className="text-lg font-bold tabular-nums">{current.metrics.onTimeDays}</p>
            <p className="mt-0.5 text-[9px] text-slate-400">On-time days</p>
          </div>
          <div className="rounded-xl bg-white/[0.07] p-3 ring-1 ring-white/10">
            <p className="text-lg font-bold tabular-nums">{current.pendingRewardPreview}</p>
            <p className="mt-0.5 text-[9px] text-slate-400">৳ preview</p>
          </div>
        </div>
      </section>

      <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🏆</span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-amber-950">{winnerReward.title}</h2>
            <p className="mt-1 text-xs leading-5 text-amber-800">{winnerReward.description}</p>
            {winnerReward.eligible && (
              <p className="mt-2 text-xs font-bold text-amber-950">
                Current #1: {winnerReward.winnerName}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {winnerReward.perks.map((perk) => (
                <span
                  key={perk}
                  className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-amber-900 ring-1 ring-amber-200"
                >
                  {perk}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mb-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80">
        <div className="border-b border-slate-100 px-4 py-3.5">
          <h2 className="text-sm font-bold text-slate-950">Weekly leaderboard</h2>
          <p className="mt-0.5 text-[10px] text-slate-400">Live from verified clinic work</p>
        </div>
        {snapshot.leaderboard.map((entry) => (
          <div
            key={entry.staffId}
            className={`flex min-h-[66px] items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 ${
              entry.staffId === current.staffId ? "bg-blue-50/70" : "bg-white"
            }`}
          >
            <div className="w-9 shrink-0 text-center text-lg font-bold text-slate-800">
              {medal(entry.rank)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-950">{entry.fullName}</p>
              <p className="mt-0.5 truncate text-[10px] text-slate-500">
                {entry.roleLabel} · {entry.departmentLabel}
              </p>
            </div>
            <div className="text-right">
              <p className="text-base font-black tabular-nums text-blue-800">{entry.points}</p>
              <p className="text-[9px] text-slate-400">points</p>
            </div>
          </div>
        ))}
      </section>

      <section className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-950">Use points for time off</h2>
            <p className="mt-0.5 text-[10px] text-slate-400">Owner-approved reward wallet direction</p>
          </div>
          <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-bold text-violet-700">
            {current.points} pts
          </span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {PERFORMANCE_REWARD_CATALOG.map((reward) => (
            <div key={reward.key} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-start gap-2.5">
                <span className="text-xl">{reward.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-slate-900">{reward.title}</p>
                  <p className="mt-1 text-[10px] leading-4 text-slate-500">{reward.description}</p>
                  <p className="mt-2 text-[9px] font-semibold uppercase tracking-wide text-amber-700">
                    Point rate pending Owner approval
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-4 rounded-2xl border border-blue-200 bg-blue-50 p-4">
        <h2 className="text-sm font-bold text-blue-950">📈 {PERFORMANCE_SALARY_POLICY.label}</h2>
        <p className="mt-1 text-xs leading-5 text-blue-800">{PERFORMANCE_SALARY_POLICY.note}</p>
      </section>

      <section className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
        <h2 className="text-sm font-bold text-slate-950">Milestones</h2>
        <div className="mt-3 space-y-2">
          {current.milestones.map((milestone) => {
            const percent = Math.min(100, Math.round((milestone.progress / milestone.target) * 100));
            return (
              <div key={milestone.key} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-lg">{milestone.icon}</span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-slate-900">{milestone.title}</p>
                      <p className="mt-0.5 text-[10px] text-slate-500">{milestone.description}</p>
                    </div>
                  </div>
                  <span className={`shrink-0 text-[10px] font-bold ${milestone.unlocked ? "text-emerald-700" : "text-slate-500"}`}>
                    {milestone.unlocked ? "Unlocked" : `${milestone.progress}/${milestone.target}`}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-blue-700" style={{ width: `${percent}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <p className="px-1 pb-3 text-[10px] leading-4 text-slate-400">{snapshot.scoringNote}</p>
    </div>
  );
}
