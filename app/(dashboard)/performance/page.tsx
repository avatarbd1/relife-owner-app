import Link from "next/link";
import { PageHeading } from "@/components/WorkspaceUI";
import {
  getGamificationStaffSummary,
  type GamificationStaffSummary,
} from "@/lib/data/supabaseGamification";
import { isGamificationEligibleStaffId } from "@/lib/domain/gamification/monthlyPolicy";
import type { TenantScope } from "@/lib/domain/tenancy/policy";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { getPerformanceSnapshot } from "@/lib/webos/performance";
import {
  getPerformanceRewardPolicy,
  PERFORMANCE_SALARY_POLICY,
} from "@/lib/webos/performanceRewards";

function medal(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

function xpDirections(roleLabel: string): string[] {
  const role = roleLabel.toLowerCase();
  const rows: string[] = [];

  if (role.includes("therapist") || role.includes("dentist")) {
    rows.push("Verified session");
  }
  if (role.includes("receptionist")) {
    rows.push("Patient registration", "Payment processing", "Appointment booking");
  }
  rows.push("On-time attendance");

  if (role.includes("manager") || role.includes("owner")) {
    rows.push("Verified manager metrics");
  }
  return rows;
}

function metricLabel(key: string): string {
  const labels: Record<string, string> = {
    documentation: "Documentation",
    quality: "Patient Quality / Rating",
    reliability: "Reliability / Cancellation",
    cash_accuracy: "Cash Accuracy",
    appointment_accuracy: "Appointment Accuracy",
    error_control: "Error Control",
    coordination: "Coordination",
    incidents: "Incident Resolution",
    schedule: "Schedule Quality",
    staff_satisfaction: "Staff Satisfaction",
    role_config_or_verified_sources: "Role scoring config / verified sources",
    single_scoring_role_required: "Single scoring role",
  };
  return labels[key] || key.replaceAll("_", " ");
}

async function loadLedgerSummary(
  tenant: TenantScope,
  input: {
    staffId: string;
    weekStart: string;
    weekEnd: string;
    today: string;
  }
): Promise<GamificationStaffSummary | null> {
  try {
    return await getGamificationStaffSummary(tenant, input);
  } catch (error) {
    console.error("Gamification ledger summary unavailable", error);
    return null;
  }
}

export default async function PerformancePage() {
  const { access: context, tenant } = await requireCurrentTenantAccessContext();
  if (!isGamificationEligibleStaffId(context.staffId)) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageHeading title="Performance" subtitle="Staff-ID scoped gamification" />
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-950">এই Staff_ID gamification cohort-এ নেই</h2>
          <p className="mt-2 text-xs leading-5 text-slate-600">
            XP, RC এবং official leaderboard শুধু eligible Staff_ID-এর জন্য active।
          </p>
          {context.roles.includes("Owner") && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/performance/weekly" className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-bold text-white">Weekly review</Link>
              <Link href="/performance/monthly" className="rounded-xl bg-violet-700 px-4 py-2.5 text-xs font-bold text-white">Monthly RC</Link>
            </div>
          )}
        </section>
      </div>
    );
  }

  const snapshot = await getPerformanceSnapshot(context);
  const [rewardPolicy, ledger] = await Promise.all([
    getPerformanceRewardPolicy(tenant),
    loadLedgerSummary(tenant, {
      staffId: context.staffId,
      weekStart: snapshot.weekStart,
      weekEnd: snapshot.weekEnd,
      today: snapshot.today,
    }),
  ]);
  const current = snapshot.current;
  const displayedScore = current.normalizedScore ?? current.provisionalScore;
  const scoreIsOfficial = current.normalizedScore !== null;
  const rewardBalanceValid = Boolean(ledger?.rewardCredits.valid);
  const availableRc = rewardBalanceValid && ledger
    ? ledger.rewardCredits.availableBalance
    : null;
  const leaderboardPreview = snapshot.leaderboard.slice(0, 3);
  const milestonePreview = current.milestones.slice(0, 3);
  const remainingMilestones = current.milestones.slice(3);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeading
        title="Performance"
        subtitle={`${snapshot.weekStart} → ${snapshot.weekEnd} · ${snapshot.scopeLabel}`}
      />

      <section className="mb-4 overflow-hidden rounded-2xl bg-gradient-to-br from-blue-950 via-slate-950 to-violet-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-200">Weekly normalized score</p>
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${scoreIsOfficial ? "bg-emerald-400/15 text-emerald-200" : "bg-amber-400/15 text-amber-200"}`}>
                {scoreIsOfficial ? "Official" : "Provisional"}
              </span>
            </div>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-4xl font-black tabular-nums">
                {displayedScore === null ? "—" : displayedScore.toFixed(1)}
              </span>
              <span className="pb-1 text-sm font-semibold text-blue-200">/100</span>
            </div>
          </div>
          <div className="rounded-2xl bg-white/10 px-4 py-3 text-center ring-1 ring-white/10">
            <p className="text-2xl">{current.rank !== null && current.rank <= 3 ? medal(current.rank) : "🎯"}</p>
            <p className="mt-1 text-[10px] font-semibold text-slate-300">
              Rank {current.rank === null ? "—" : medal(current.rank)}
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-white/[0.07] p-3 ring-1 ring-white/10">
            <p className="text-lg font-bold tabular-nums">{ledger ? ledger.lifetimeXp : "—"}</p>
            <p className="mt-0.5 text-[9px] text-slate-400">Lifetime XP</p>
          </div>
          <div className="rounded-xl bg-white/[0.07] p-3 ring-1 ring-white/10">
            <p className="text-lg font-bold tabular-nums">{ledger ? ledger.weekXp : "—"}</p>
            <p className="mt-0.5 text-[9px] text-slate-400">Week XP{ledger ? ` · +${ledger.todayXp}` : ""}</p>
          </div>
          <div className="rounded-xl bg-white/[0.07] p-3 ring-1 ring-white/10">
            <p className="text-lg font-bold tabular-nums">{availableRc ?? "—"}</p>
            <p className="mt-0.5 text-[9px] text-slate-400">Available RC</p>
          </div>
        </div>

        {!ledger && (
          <p className="mt-3 text-[10px] text-slate-400">
            Ledger unavailable — XP/RC-কে 0 ধরে দেখানো হচ্ছে না।
          </p>
        )}
        {ledger && !rewardBalanceValid && <p className="mt-3 text-[10px] text-amber-200">RC balance unavailable</p>}
      </section>

      {current.scoreCoverage !== "complete" && (
        <details className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <summary className="cursor-pointer list-none text-sm font-bold text-amber-950">
            ⚠ Official Rank এখনো locked · {Math.round(current.scoreCoveredWeight * 100)}% ready
          </summary>
          <p className="mt-2 text-[10px] leading-4 text-amber-800">Missing verified metrics are not counted as zero.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {current.missingScoreMetrics.map((metric) => (
              <span key={metric} className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-amber-900 ring-1 ring-amber-200">
                {metricLabel(metric)}
              </span>
            ))}
          </div>
        </details>
      )}

      <section className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-slate-950">My Missions · কী করলে XP বাড়বে</h2>
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-700">XP</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {xpDirections(current.roleLabel).map((direction) => (
            <div key={direction} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-700">
              <span aria-hidden="true">✓</span>
              <span>{direction}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
          <h2 className="text-sm font-bold text-slate-950">Weekly Leaderboard</h2>
          <Link href="/performance/weekly" className="text-[10px] font-bold text-blue-700">View all</Link>
        </div>
        {leaderboardPreview.length > 0 ? (
          leaderboardPreview.map((entry) => (
            <div
              key={entry.staffId}
              className={`flex min-h-[60px] items-center gap-3 border-b border-slate-100 px-4 py-2.5 last:border-b-0 ${entry.staffId === current.staffId ? "bg-blue-50/70" : "bg-white"}`}
            >
              <div className="w-8 shrink-0 text-center text-lg font-bold text-slate-800">{entry.rank === null ? "—" : medal(entry.rank)}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-950">{entry.fullName}</p>
                <p className="truncate text-[10px] text-slate-500">{entry.roleLabel}</p>
              </div>
              <p className="text-base font-black tabular-nums text-blue-800">{entry.normalizedScore?.toFixed(1)}</p>
            </div>
          ))
        ) : (
          <div className="px-4 py-6 text-center text-xs text-slate-500">Official ranking pending</div>
        )}
      </section>

      <section className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-slate-950">Rewards</h2>
          <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-bold text-violet-700">
            {availableRc === null ? "RC —" : `${availableRc} RC`}
          </span>
        </div>

        {ledger && rewardBalanceValid && ledger.rewardCredits.reservedBalance > 0 && (
          <p className="mt-2 text-[10px] text-slate-500">{ledger.rewardCredits.reservedBalance} RC reserved</p>
        )}

        {rewardPolicy.catalog.length > 0 ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {rewardPolicy.catalog.map((reward) => (
              <div key={reward.key} className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <span className="text-xl">{reward.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-slate-900">{reward.title}</p>
                  <p className="mt-0.5 text-[10px] font-bold text-violet-700">{reward.creditCost} RC</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-xs text-slate-500">Reward catalog unavailable</div>
        )}

        <Link href="/performance/claims" className="mt-4 block w-full rounded-xl bg-violet-700 px-4 py-3 text-center text-sm font-bold text-white">
          Reward Claims
        </Link>
      </section>

      <section className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
        <h2 className="text-sm font-bold text-slate-950">Milestones</h2>
        <div className="mt-3 space-y-2">
          {milestonePreview.map((milestone) => {
            const percent = Math.min(100, Math.round((milestone.progress / milestone.target) * 100));
            return (
              <div key={milestone.key} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-lg">{milestone.icon}</span>
                    <p className="truncate text-xs font-bold text-slate-900">{milestone.title}</p>
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

        {remainingMilestones.length > 0 && (
          <details className="mt-3 rounded-xl bg-slate-50 p-3">
            <summary className="cursor-pointer list-none text-[10px] font-bold text-slate-600">+ {remainingMilestones.length} more milestones</summary>
            <div className="mt-3 space-y-2">
              {remainingMilestones.map((milestone) => {
                const percent = Math.min(100, Math.round((milestone.progress / milestone.target) * 100));
                return (
                  <div key={milestone.key} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="text-lg">{milestone.icon}</span>
                        <p className="truncate text-xs font-bold text-slate-900">{milestone.title}</p>
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
          </details>
        )}
      </section>

      <details className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 text-xs leading-5 text-slate-600 shadow-sm">
        <summary className="cursor-pointer list-none text-sm font-bold text-slate-950">Rules & details</summary>
        <div className="mt-3 space-y-3">
          <div>
            <p className="font-bold text-slate-900">XP, Score আর Reward Credit আলাদা</p>
            <p>XP = lifetime progress · Score = weekly 0–100 · RC = spendable rewards.</p>
            <p>Spendable balance immutable RC ledger থেকে আসে.</p>
            <p>Raw session/payment count নয়—official rank normalized verified score থেকে আসে.</p>
          </div>
          <div>
            <p className="font-bold text-slate-900">Reward Credits</p>
            <p>Catalog uses configured reward credit cost; no fallback cost is invented.</p>
            <p>Claim Writer v1 active; claims reserve available RC before redemption.</p>
          </div>
          <div>
            <p className="font-bold text-slate-900">Monthly RC tiers</p>
            <p>90+ = 22 RC · 80+ = 18 RC · 70+ = 14 RC · 60+ = 8 RC.</p>
            <p>Published roster + complete verified score required for monthly RC.</p>
            <p>Incomplete verified data does not become a zero score.</p>
          </div>
          <div>
            <p className="font-bold text-slate-900">Reward claims</p>
            <p>Claim requests reserve available RC; deny/cancel releases it, fulfilled claims redeem it.</p>
          </div>
          <div>
            <p className="font-bold text-slate-900">Verified activity milestones</p>
            <p>Milestone progress comes from the existing verified activity sources.</p>
          </div>
          <div>
            <p className="font-bold text-slate-900">📈 {PERFORMANCE_SALARY_POLICY.label}</p>
            <p>{PERFORMANCE_SALARY_POLICY.note}</p>
          </div>
          <p className="text-[10px] text-slate-400">{snapshot.scoringNote}</p>
        </div>
      </details>
    </div>
  );
}
