import type { PerformanceEntry } from "@/lib/webos/performance";

export type PerformanceRewardKind =
  | "leave"
  | "family_time"
  | "recognition"
  | "salary_review";

export interface PerformanceRewardOption {
  key: string;
  icon: string;
  title: string;
  description: string;
  kind: PerformanceRewardKind;
  pointCost: number | null;
  ownerApprovalRequired: boolean;
  enabledForClaim: boolean;
}

export interface WeeklyWinnerReward {
  eligible: boolean;
  title: string;
  description: string;
  winnerStaffId: string | null;
  winnerName: string | null;
  perks: string[];
}

/**
 * User-approved direction: points can be exchanged for time-off/family-time.
 * Point costs are deliberately not invented here. A claim writer stays disabled
 * until Owner approves the exact exchange rates and leave-accounting behavior.
 */
export const PERFORMANCE_REWARD_CATALOG: PerformanceRewardOption[] = [
  {
    key: "half_day",
    icon: "🌤️",
    title: "Half-day",
    description: "Use earned points for an Owner-approved half-day off.",
    kind: "leave",
    pointCost: null,
    ownerApprovalRequired: true,
    enabledForClaim: false,
  },
  {
    key: "family_time",
    icon: "👨‍👩‍👧‍👦",
    title: "Family time",
    description: "Convert points into protected family-time leave.",
    kind: "family_time",
    pointCost: null,
    ownerApprovalRequired: true,
    enabledForClaim: false,
  },
  {
    key: "full_day_leave",
    icon: "🏖️",
    title: "Day off",
    description: "Redeem points for a full day off after Owner approval.",
    kind: "leave",
    pointCost: null,
    ownerApprovalRequired: true,
    enabledForClaim: false,
  },
  {
    key: "salary_review",
    icon: "📈",
    title: "Salary review",
    description:
      "Strong sustained points can trigger an Owner salary-review conversation; salary never changes automatically.",
    kind: "salary_review",
    pointCost: null,
    ownerApprovalRequired: true,
    enabledForClaim: false,
  },
];

export function weeklyWinnerReward(
  leaderboard: PerformanceEntry[]
): WeeklyWinnerReward {
  const winner = leaderboard.find((entry) => entry.rank === 1 && entry.points > 0) || null;
  return {
    eligible: Boolean(winner),
    title: "Weekly #1 Winner Pack",
    description:
      "Highest weekly points gets a clinic treat/outing plus protected family time with a half-day perk.",
    winnerStaffId: winner?.staffId || null,
    winnerName: winner?.fullName || null,
    perks: ["Clinic treat / outing", "Family time", "Half-day"],
  };
}

export const PERFORMANCE_SALARY_POLICY = {
  automaticSalaryChange: false,
  label: "Performance can trigger salary review",
  note:
    "Points are evidence for an Owner review. Payroll/salary remains a separate controlled finance decision and is never mutated by leaderboard rank alone.",
} as const;
