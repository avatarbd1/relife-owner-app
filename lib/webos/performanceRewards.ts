import "server-only";

import {
  gamificationSupabaseConfigured,
  getGamificationConfig,
} from "@/lib/data/supabaseGamification";
import {
  parseRewardCatalog,
  parseRewardRankConfig,
  parseWeeklyWinnerChoices,
  type RewardRankConfig,
} from "@/lib/domain/gamification/config";
import type { PerformanceEntry } from "@/lib/webos/performance";

export interface PerformanceRewardOption {
  key: string;
  icon: string;
  title: string;
  description: string;
  kind: string;
  creditCost: number;
  coverageRequired: boolean;
  cooldownDays: number | null;
  maxPerMonth: number | null;
  maxPerQuarter: number | null;
  enabledForClaim: false;
}

export interface PerformanceRewardPolicy {
  configured: boolean;
  rank: RewardRankConfig | null;
  catalog: PerformanceRewardOption[];
  winnerChoices: string[];
}

export interface WeeklyWinnerReward {
  eligible: boolean;
  title: string;
  description: string;
  winnerStaffId: string | null;
  winnerName: string | null;
  rewardCredits: number;
  perks: string[];
}

const REWARD_PRESENTATION: Record<
  string,
  { icon: string; title: string; description: string }
> = {
  two_hour_early_leave: {
    icon: "🕑",
    title: "2-hour Early Leave",
    description: "Family Time হিসেবে 2 ঘণ্টা আগে ছুটির request।",
  },
  half_day_family_time: {
    icon: "👨‍👩‍👧‍👦",
    title: "Half-day Family Time",
    description: "Coverage থাকা সাপেক্ষে Half-day Family Time request।",
  },
  paid_half_day: {
    icon: "🌤️",
    title: "Paid Half-day",
    description: "Approved হলে base salary না কমিয়ে Paid Half-day।",
  },
  priority_weekly_off: {
    icon: "🏖️",
    title: "Priority Weekly Off",
    description: "Roster capacity অনুযায়ী weekly off-এর priority request।",
  },
  meal_voucher: {
    icon: "🎁",
    title: "Meal / Treat Voucher",
    description: "Configured Meal বা Treat voucher।",
  },
  family_treat_outing: {
    icon: "🍽️",
    title: "Family Treat / Outing",
    description: "Family Treat বা Outing allowance request।",
  },
};

const WINNER_CHOICE_LABELS: Record<string, string> = {
  family_half_day: "Family half-day",
  dinner_treat: "Dinner / treat",
  voucher_300_500: "৳300–500 voucher",
  priority_weekly_off: "Priority weekly off",
  two_hour_early_leave: "2-hour early leave",
};

function fallbackTitle(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Reward values are loaded from versioned Owner configuration. If the config
 * service is unavailable or invalid, rewards fail closed instead of falling
 * back to hard-coded business amounts.
 */
export async function getPerformanceRewardPolicy(): Promise<PerformanceRewardPolicy> {
  if (!gamificationSupabaseConfigured()) {
    return { configured: false, rank: null, catalog: [], winnerChoices: [] };
  }

  try {
    const snapshot = await getGamificationConfig("All");
    const rank = parseRewardRankConfig(snapshot.configs);
    const catalog = parseRewardCatalog(snapshot.configs).map((item) => {
      const presentation = REWARD_PRESENTATION[item.key];
      return {
        key: item.key,
        icon: presentation?.icon || "🎁",
        title: presentation?.title || fallbackTitle(item.key),
        description:
          presentation?.description || "Owner-configured Reward Credit redemption.",
        kind: item.type,
        creditCost: item.creditCost,
        coverageRequired: item.coverageRequired,
        cooldownDays: item.cooldownDays,
        maxPerMonth: item.maxPerMonth,
        maxPerQuarter: item.maxPerQuarter,
        enabledForClaim: false as const,
      };
    });
    const winnerChoices = parseWeeklyWinnerChoices(snapshot.configs).map(
      (key) => WINNER_CHOICE_LABELS[key] || fallbackTitle(key)
    );
    return {
      configured: Boolean(rank && catalog.length > 0),
      rank,
      catalog,
      winnerChoices,
    };
  } catch (error) {
    console.error("Gamification reward policy unavailable", error);
    return { configured: false, rank: null, catalog: [], winnerChoices: [] };
  }
}

/**
 * v2 weekly placement credits are only a preview until the immutable Reward
 * Credit writer is wired. Incomplete/provisional scores never earn credits.
 */
export function weeklyRewardCredits(
  entry: PerformanceEntry,
  rankConfig: RewardRankConfig | null
): number {
  if (
    !rankConfig ||
    entry.scoreCoverage !== "complete" ||
    entry.normalizedScore === null ||
    entry.rank === null
  ) {
    return 0;
  }
  if (entry.rank === 1) return rankConfig.rank1;
  if (entry.rank === 2) return rankConfig.rank2;
  if (entry.rank === 3) return rankConfig.rank3;
  return rankConfig.participation;
}

export function weeklyWinnerReward(
  leaderboard: PerformanceEntry[],
  rankConfig: RewardRankConfig | null,
  winnerChoices: string[]
): WeeklyWinnerReward {
  const winner =
    leaderboard.find(
      (entry) =>
        entry.scoreCoverage === "complete" &&
        entry.normalizedScore !== null &&
        entry.rank === 1
    ) || null;
  const rewardCredits = winner && rankConfig ? rankConfig.rank1 : 0;

  return {
    eligible: Boolean(winner && rankConfig),
    title: "Weekly #1 Winner Choice",
    description: rankConfig
      ? `Weekly #1 normalized score winner ${rankConfig.rank1} Reward Credit পাবে; configured choice reward আলাদা approval/coverage workflow মেনে চলবে।`
      : "Weekly winner reward configuration unavailable; কোনো Reward Credit award করা হবে না।",
    winnerStaffId: winner?.staffId || null,
    winnerName: winner?.fullName || null,
    rewardCredits,
    perks: winnerChoices,
  };
}

export const PERFORMANCE_SALARY_POLICY = {
  automaticSalaryChange: false,
  rewardCreditsCanBuySalaryBonus: false,
  monthlyBonusOwnerApprovalRequired: true,
  label: "Performance Bonus",
  note:
    "Base salary Gamification থেকে automatic change হবে না। Monthly normalized performance tier থেকে আলাদা Performance Bonus proposal তৈরি হবে; Owner approval-এর পরেই payroll-এ যাবে।",
} as const;
