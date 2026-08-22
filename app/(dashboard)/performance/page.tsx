import Link from "next/link";
import { PageHeading } from "@/components/WorkspaceUI";
import {
  getGamificationStaffSummary,
  type GamificationStaffSummary,
} from "@/lib/data/supabaseGamification";
import { isGamificationEligibleStaffId } from "@/lib/domain/gamification/monthlyPolicy";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
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
    rows.push("Verified Session completed হলে configured XP ledger-এ যোগ হবে।");
  }
  if (role.includes("receptionist")) {
    rows.push(
      "Verified Patient Registration activity configured threshold পূরণ করলে XP হবে।",
      "Verified Payment processing activity configured threshold পূরণ করলে XP হবে।",
      "Verified Appointment Booking activity configured threshold পূরণ করলে XP হবে।"
    );
  }
  rows.push("On-time Attendance verified হলে configured XP ledger-এ যোগ হবে।");

  if (role.includes("manager") || role.includes("owner")) {
    rows.push(
      "যে Manager/Owner metric-এর verified source এখনো connected নয়, সেটা XP বা official score-এ আন্দাজ করে যোগ হবে না।"
    );
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

async function loadLedgerSummary(input: {
  staffId: string;
  weekStart: string;
  weekEnd: string;
  today: string;
}): Promise<GamificationStaffSummary | null> {
  try {
    return await getGamificationStaffSummary(input);
  } catch (error) {
    console.error("Gamification ledger summary unavailable", error);
    return null;
  }
}

export default async function PerformancePage() {
  const context = await requireCurrentAccessContext();
  if (!isGamificationEligibleStaffId(context.staffId)) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageHeading title="Performance" subtitle="Staff-ID scoped gamification" />
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-950">এই Staff_ID gamification cohort-এ নেই</h2>
          <p className="mt-2 text-xs leading-5 text-slate-600">
            XP, RC এবং official leaderboard শুধু ST002, ST003, ST004, ST005, ST008, ST010 ও ST011-এর জন্য active। নাম দিয়ে eligibility বদলাবে না।
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
    getPerformanceRewardPolicy(),
    loadLedgerSummary({
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
  const availableRc = rewardBalanceValid
    ? ledger?.rewardCredits.availableBalance ?? null
    : null;

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
              Weekly normalized score
            </p>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-4xl font-black tabular-nums">
                {displayedScore === null ? "—" : displayedScore.toFixed(1)}
              </span>
              <span className="pb-1 text-sm font-semibold text-blue-200">/100</span>
            </div>
            <p className="mt-2 text-xs text-slate-300">
              {scoreIsOfficial
                ? "Official score"
                : current.provisionalScore !== null
                  ? `Provisional · ${Math.round(current.scoreCoveredWeight * 100)}% metric coverage`
                  : "Official scoring pending"}
            </p>
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
            <p className="mt-0.5 text-[9px] text-slate-400">
              Week XP{ledger ? ` · +${ledger.todayXp} today` : ""}
            </p>
          </div>
          <div className="rounded-xl bg-white/[0.07] p-3 ring-1 ring-white/10">
            <p className="text-lg font-bold tabular-nums">{availableRc ?? "—"}</p>
            <p className="mt-0.5 text-[9px] text-slate-400">
              Available RC
              {ledger && rewardBalanceValid && ledger.rewardCredits.reservedBalance > 0
                ? ` · ${ledger.rewardCredits.reservedBalance} reserved`
                : ""}
            </p>
          </div>
        </div>
        {!ledger && (
          <p className="mt-3 text-[10px] text-slate-400">
            Ledger unavailable — XP/RC-কে 0 ধরে দেখানো হচ্ছে না।
          </p>
        )}
        {ledger && !rewardBalanceValid && (
          <p className="mt-3 text-[10px] text-amber-200">
            Reward Credit ledger validation failed — spendable balance hidden রাখা হয়েছে।
          </p>
        )}
      </section>

      {current.scoreCoverage !== "complete" && (
        <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <h2 className="text-sm font-bold text-amber-950">Official Rank এখনো locked</h2>
          <p className="mt-1 text-xs leading-5 text-amber-800">
            Missing metric-কে 0 ধরে score কমানো হচ্ছে না। Required verified source complete হলে এই provisional score official হবে।
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {current.missingScoreMetrics.map((metric) => (
              <span
                key={metric}
                className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-amber-900 ring-1 ring-amber-200"
              >
                {metricLabel(metric)}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-950">My Missions · কী করলে XP বাড়বে</h2>
            <p className="mt-0.5 text-[10px] text-slate-400">শুধু immutable verified event + active Owner config থেকে XP হবে।</p>
          </div>
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-700">Ledger-backed</span>
        </div>
        <div className="mt-3 space-y-2">
          {xpDirections(current.roleLabel).map((direction) => (
            <div key={direction} className="flex gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-700">
              <span aria-hidden="true">✓</span>
              <p>{direction}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-4 rounded-2xl border border-violet-200 bg-violet-50 p-4">
        <h2 className="text-sm font-bold text-violet-950">XP, Score আর Reward Credit আলাদা</h2>
        <div className="mt-2 space-y-1 text-xs leading-5 text-violet-800">
          <p>• XP = immutable ledger-এর lifetime career progress; spend হবে না।</p>
          <p>• Weekly Score = role-normalized 0–100; official Leaderboard এই score দিয়ে হবে।</p>
          <p>• Reward Credit = আলাদা spendable ledger; Reward claim করলে XP বা score কমবে না।</p>
        </div>
      </section>

      <section className="mb-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80">
        <div className="border-b border-slate-100 px-4 py-3.5">
          <h2 className="text-sm font-bold text-slate-950">Weekly Leaderboard</h2>
          <p className="mt-0.5 text-[10px] text-slate-400">
            Raw session/payment count নয়—শুধু complete role-normalized score rank পাবে।
          </p>
        </div>
        {snapshot.leaderboard.length > 0 ? (
          snapshot.leaderboard.map((entry) => (
            <div
              key={entry.staffId}
              className={`flex min-h-[66px] items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 ${
                entry.staffId === current.staffId ? "bg-blue-50/70" : "bg-white"
              }`}
            >
              <div className="w-9 shrink-0 text-center text-lg font-bold text-slate-800">
                {entry.rank === null ? "—" : medal(entry.rank)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-950">{entry.fullName}</p>
                <p className="mt-0.5 truncate text-[10px] text-slate-500">
                  {entry.roleLabel} · {entry.departmentLabel}
                </p>
              </div>
              <div className="text-right">
                <p className="text-base font-black tabular-nums text-blue-800">
                  {entry.normalizedScore?.toFixed(1)}
                </p>
                <p className="text-[9px] text-slate-400">Score /100</p>
              </div>
            </div>
          ))
        ) : (
          <div className="px-4 py-8 text-center text-xs leading-5 text-slate-500">
            Required metric sources complete হলে official normalized Leaderboard শুরু হবে। Provisional score দিয়ে কাউকে rank দেওয়া হচ্ছে না।
          </div>
        )}
      </section>

      <section className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-950">Reward Credits</h2>
            <p className="mt-0.5 text-[10px] text-slate-400">Spendable balance immutable RC ledger থেকে আসে; monthly official score final হলে RC earn হয়।</p>
          </div>
          <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-bold text-violet-700">
            {availableRc === null ? "RC —" : `${availableRc} RC available`}
          </span>
        </div>

        {ledger && rewardBalanceValid && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-slate-50 p-2.5">
              <p className="text-sm font-bold tabular-nums text-slate-900">{ledger.rewardCredits.ledgerBalance}</p>
              <p className="mt-0.5 text-[9px] text-slate-500">Ledger RC</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-2.5">
              <p className="text-sm font-bold tabular-nums text-slate-900">{ledger.rewardCredits.reservedBalance}</p>
              <p className="mt-0.5 text-[9px] text-slate-500">Reserved</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-2.5">
              <p className="text-sm font-bold tabular-nums text-slate-900">{ledger.rewardCredits.availableBalance}</p>
              <p className="mt-0.5 text-[9px] text-slate-500">Available</p>
            </div>
          </div>
        )}

        <div className="mt-3 rounded-xl bg-violet-50 px-3 py-3 text-[10px] leading-5 text-violet-900">
          <p className="font-bold">Monthly RC tiers</p>
          <p>90+ = 22 RC · 80+ = 18 RC · 70+ = 14 RC · 60+ = 8 RC</p>
          <p>Published roster এবং সব verified weekly official score complete না হলে 0 RC; missing data-কে zero score ধরা হবে না।</p>
        </div>

        {rewardPolicy.catalog.length > 0 ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {rewardPolicy.catalog.map((reward) => (
              <div key={reward.key} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-start gap-2.5">
                  <span className="text-xl">{reward.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-900">{reward.title}</p>
                    <p className="mt-1 text-[10px] leading-4 text-slate-500">{reward.description}</p>
                    <p className="mt-2 text-[9px] font-semibold text-violet-700">
                      {reward.creditCost} RC
                      {reward.coverageRequired ? " · Coverage required" : ""}
                      {reward.cooldownDays !== null ? ` · ${reward.cooldownDays}d cooldown` : ""}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-xs text-slate-500">
            Reward catalog config unavailable—কোনো fallback cost দেখানো হচ্ছে না।
          </div>
        )}

        <Link
          href="/performance/claims"
          className="mt-4 block w-full rounded-xl bg-violet-700 px-4 py-3 text-center text-sm font-bold text-white"
        >
          Open Reward Claims
        </Link>
        <p className="mt-3 text-[10px] leading-4 text-slate-400">
          Claim Writer v1 active: request-এ RC reserve হয়, Owner approve করলে reserve held থাকে, deny/cancel-এ release হয়, আর fulfilled claim-এ redeem হয়।
        </p>
      </section>

      <section className="mb-4 rounded-2xl border border-blue-200 bg-blue-50 p-4">
        <h2 className="text-sm font-bold text-blue-950">📈 {PERFORMANCE_SALARY_POLICY.label}</h2>
        <p className="mt-1 text-xs leading-5 text-blue-800">{PERFORMANCE_SALARY_POLICY.note}</p>
      </section>

      <section className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
        <h2 className="text-sm font-bold text-slate-950">Verified activity milestones</h2>
        <p className="mt-0.5 text-[10px] text-slate-400">এগুলো canonical activity recognition; Lifetime XP-এর source হলো immutable XP ledger।</p>
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

      <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 text-xs leading-5 text-slate-600">
        <h2 className="text-sm font-bold text-slate-950">এখন কীভাবে কাজ করবে</h2>
        <div className="mt-2 space-y-1.5">
          <p>• নিজের নিয়মিত clinic কাজ app-এর ভেতর complete করুন।</p>
          <p>• Session, Payment, Registration, Booking ও Attendance verified event হলে server-side rule XP নির্ধারণ করবে।</p>
          <p>• Required role metrics complete না হওয়া পর্যন্ত provisional score দেখা যাবে, official rank নয়।</p>
          <p>• Reward Claims থেকে Family Time, Half-day, Priority Off-day বা Family Treat request করলে available RC transactionalভাবে reserve হবে।</p>
        </div>
      </section>

      <p className="px-1 pb-3 text-[10px] leading-4 text-slate-400">{snapshot.scoringNote}</p>
    </div>
  );
}
