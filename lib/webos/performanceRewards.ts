import type { PerformanceEntry } from "@/lib/webos/performance";

export type PerformanceRewardKind =
  | "leave"
  | "family_time"
  | "recognition"
  | "salary_review"
  | "treat";

export interface PerformanceRewardOption {
  key: string;
  icon: string;
  title: string;
  description: string;
  kind: PerformanceRewardKind;
  pointCost: number;
  ownerApprovalRequired: boolean;
  enabledForClaim: boolean;
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

/**
 * XP/Points এবং Reward Credit আলাদা রাখা হয়। Leaderboard Points কখনও spend হয় না;
 * Reward Credit spend করলে rank বা earned Points কমে না। Claim writer Phase 1-এ
 * disabled থাকে, যাতে Owner approval ছাড়া leave/payroll mutation না হয়।
 */
export const PERFORMANCE_REWARD_CATALOG: PerformanceRewardOption[] = [
  {
    key: "two_hour_break",
    icon: "☕",
    title: "2-hour Break",
    description: "40 Reward Credit হলে 2-hour Break request করতে পারবেন।",
    kind: "leave",
    pointCost: 40,
    ownerApprovalRequired: true,
    enabledForClaim: false,
  },
  {
    key: "half_day_family_time",
    icon: "👨‍👩‍👧‍👦",
    title: "Half-day Family Time",
    description: "70 Reward Credit হলে Half-day Family Time request করতে পারবেন।",
    kind: "family_time",
    pointCost: 70,
    ownerApprovalRequired: true,
    enabledForClaim: false,
  },
  {
    key: "paid_half_day",
    icon: "🌤️",
    title: "Paid Half-day",
    description: "100 Reward Credit হলে Paid Half-day request করতে পারবেন।",
    kind: "leave",
    pointCost: 100,
    ownerApprovalRequired: true,
    enabledForClaim: false,
  },
  {
    key: "priority_off_day",
    icon: "🏖️",
    title: "Priority Off-day",
    description: "110 Reward Credit হলে পরের roster-এ Priority Off-day request করতে পারবেন।",
    kind: "leave",
    pointCost: 110,
    ownerApprovalRequired: true,
    enabledForClaim: false,
  },
  {
    key: "salary_review",
    icon: "📈",
    title: "Salary Bonus Review",
    description: "120 Reward Credit হলে Salary Bonus review request করতে পারবেন। Salary automatic change হবে না।",
    kind: "salary_review",
    pointCost: 120,
    ownerApprovalRequired: true,
    enabledForClaim: false,
  },
  {
    key: "family_treat",
    icon: "🍽️",
    title: "Family Treat / Outing",
    description: "150 Reward Credit হলে Family Treat বা Outing support request করতে পারবেন।",
    kind: "treat",
    pointCost: 150,
    ownerApprovalRequired: true,
    enabledForClaim: false,
  },
];

/**
 * Weekly rank থেকে Reward Credit preview। Persistence/claim পরের controlled writer-এ যাবে.
 */
export function weeklyRewardCredits(entry: PerformanceEntry): number {
  if (entry.scoreCoverage !== "live" || entry.points <= 0) return 0;
  if (entry.rank === 1) return 50;
  if (entry.rank === 2) return 30;
  if (entry.rank === 3) return 20;
  return entry.points >= 5 ? 10 : 0;
}

export function weeklyWinnerReward(
  leaderboard: PerformanceEntry[]
): WeeklyWinnerReward {
  const winner =
    leaderboard.find(
      (entry) => entry.scoreCoverage === "live" && entry.rank === 1 && entry.points > 0
    ) || null;
  return {
    eligible: Boolean(winner),
    title: "Weekly #1 Winner Pack",
    description:
      "Weekly #1 হলে 50 Reward Credit পাবেন এবং Owner approval অনুযায়ী Family time, Half-day, Clinic treat/outing বা Priority Off-day থেকে একটি perk বেছে নিতে পারবেন।",
    winnerStaffId: winner?.staffId || null,
    winnerName: winner?.fullName || null,
    rewardCredits: winner ? 50 : 0,
    perks: ["Family time", "Half-day", "Clinic treat / outing", "Priority Off-day"],
  };
}

export const PERFORMANCE_SALARY_POLICY = {
  automaticSalaryChange: false,
  label: "Salary Bonus Review",
  note:
    "ভালো Performance Salary Bonus review-এর evidence হবে। Base salary বা payroll কোনোভাবেই Leaderboard rank থেকে automatic change হবে না; Owner approval লাগবে।",
} as const;
