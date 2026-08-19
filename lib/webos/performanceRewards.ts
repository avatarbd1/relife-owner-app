import type { PerformanceEntry } from "@/lib/webos/performance";

export type PerformanceRewardKind =
  | "leave"
  | "family_time"
  | "voucher"
  | "treat";

export type PerformanceRewardApprovalMode =
  | "coverage_auto"
  | "manager_coverage"
  | "owner";

export interface PerformanceRewardOption {
  key: string;
  icon: string;
  title: string;
  description: string;
  kind: PerformanceRewardKind;
  creditCost: number;
  approvalMode: PerformanceRewardApprovalMode;
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
 * Gamification v2 keeps three economies separate:
 * - XP / performance score is never spent.
 * - Reward Credit is spendable through controlled redemption.
 * - Performance Bonus is finance-controlled and cannot be purchased with Reward Credit.
 *
 * Claim writers stay disabled until the reservation/approval ledger is wired.
 */
export const PERFORMANCE_REWARD_CATALOG: PerformanceRewardOption[] = [
  {
    key: "two_hour_early_leave",
    icon: "🕑",
    title: "2-hour Early Leave",
    description: "40 Reward Credit হলে coverage থাকা সাপেক্ষে 2 ঘণ্টা আগে ছুটির request করা যাবে।",
    kind: "family_time",
    creditCost: 40,
    approvalMode: "coverage_auto",
    enabledForClaim: false,
  },
  {
    key: "half_day_family_time",
    icon: "👨‍👩‍👧‍👦",
    title: "Half-day Family Time",
    description: "70 Reward Credit হলে coverage plan সহ Half-day Family Time request করা যাবে।",
    kind: "family_time",
    creditCost: 70,
    approvalMode: "manager_coverage",
    enabledForClaim: false,
  },
  {
    key: "paid_half_day",
    icon: "🌤️",
    title: "Paid Half-day",
    description: "100 Reward Credit হলে Paid Half-day request করা যাবে; approval ছাড়া salary effect হবে না।",
    kind: "leave",
    creditCost: 100,
    approvalMode: "owner",
    enabledForClaim: false,
  },
  {
    key: "priority_weekly_off",
    icon: "🏖️",
    title: "Priority Weekly Off",
    description: "100 Reward Credit হলে coverage ও roster capacity অনুযায়ী priority off-day request করা যাবে।",
    kind: "leave",
    creditCost: 100,
    approvalMode: "manager_coverage",
    enabledForClaim: false,
  },
  {
    key: "meal_voucher",
    icon: "🎁",
    title: "Meal / Treat Voucher",
    description: "50 Reward Credit হলে configured voucher request করা যাবে।",
    kind: "voucher",
    creditCost: 50,
    approvalMode: "owner",
    enabledForClaim: false,
  },
  {
    key: "family_treat_outing",
    icon: "🍽️",
    title: "Family Treat / Outing",
    description: "150 Reward Credit হলে Family Treat বা Outing allowance request করা যাবে।",
    kind: "treat",
    creditCost: 150,
    approvalMode: "owner",
    enabledForClaim: false,
  },
];

/**
 * v2 weekly placement credits. This is display/policy logic only until the
 * normalized weekly score writer and immutable Reward Credit ledger are wired.
 */
export function weeklyRewardCredits(entry: PerformanceEntry): number {
  if (entry.scoreCoverage !== "live" || entry.points <= 0) return 0;
  if (entry.rank === 1) return 250;
  if (entry.rank === 2) return 150;
  if (entry.rank === 3) return 100;
  return 50;
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
    title: "Weekly #1 Winner Choice",
    description:
      "Weekly #1 normalized score winner 250 Reward Credit পাবে এবং Owner/coverage approval অনুযায়ী একটি choice reward নিতে পারবে।",
    winnerStaffId: winner?.staffId || null,
    winnerName: winner?.fullName || null,
    rewardCredits: winner ? 250 : 0,
    perks: [
      "Family half-day",
      "Dinner / treat",
      "৳300–500 voucher",
      "Priority weekly off",
      "2-hour early leave",
    ],
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
