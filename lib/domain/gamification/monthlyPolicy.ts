export const GAMIFICATION_ELIGIBLE_STAFF_IDS = [
  "ST002",
  "ST003",
  "ST004",
  "ST005",
  "ST008",
  "ST010",
  "ST011",
] as const;

export const MONTHLY_RC_POLICY = {
  cashBudgetBdt: 1600,
  bdtPerCredit: 10,
  totalCredits: 160,
  reserveCredits: 6,
  awardableCredits: 154,
  individualCap: 22,
  tiers: [
    { minScore: 90, credits: 22 },
    { minScore: 80, credits: 18 },
    { minScore: 70, credits: 14 },
    { minScore: 60, credits: 8 },
  ],
} as const;

const ELIGIBLE_IDS = new Set<string>(GAMIFICATION_ELIGIBLE_STAFF_IDS);

export function isGamificationEligibleStaffId(staffId: unknown): boolean {
  return ELIGIBLE_IDS.has(String(staffId ?? "").trim());
}

export interface MonthlyRcCandidate {
  staffId: string;
  officialScore: number | null;
  publishedScheduledMinutes: number;
  completeVerifiedMetrics: boolean;
}

export interface MonthlyRcAllocation {
  staffId: string;
  officialScore: number | null;
  rewardCredits: number;
  eligible: boolean;
  reason: string;
}

/**
 * Role-normalized official scores make app-heavy and physical work comparable.
 * Published scheduled minutes are an opportunity gate, not an output target, so
 * longer shifts cannot buy a higher score. Seven individual caps (7×22) equal
 * the awardable pool (154), leaving the fixed 6 RC reserve without rank rationing.
 */
export function allocateMonthlyRewardCredits(
  candidates: MonthlyRcCandidate[]
): { allocations: MonthlyRcAllocation[]; awardedCredits: number; reserveCredits: number } {
  const seen = new Set<string>();
  const allocations = candidates.map((candidate): MonthlyRcAllocation => {
    const staffId = String(candidate.staffId ?? "").trim();
    if (seen.has(staffId)) throw new Error("MONTHLY_RC_DUPLICATE_STAFF");
    seen.add(staffId);
    if (!isGamificationEligibleStaffId(staffId)) {
      return { staffId, officialScore: candidate.officialScore, rewardCredits: 0, eligible: false, reason: "staff_id_excluded" };
    }
    if (!Number.isFinite(candidate.publishedScheduledMinutes) || candidate.publishedScheduledMinutes <= 0) {
      return { staffId, officialScore: candidate.officialScore, rewardCredits: 0, eligible: false, reason: "published_roster_missing" };
    }
    if (!candidate.completeVerifiedMetrics || candidate.officialScore === null) {
      return { staffId, officialScore: candidate.officialScore, rewardCredits: 0, eligible: false, reason: "verified_score_incomplete" };
    }
    if (!Number.isFinite(candidate.officialScore) || candidate.officialScore < 0 || candidate.officialScore > 100) {
      throw new Error("MONTHLY_RC_SCORE_INVALID");
    }
    const tier = MONTHLY_RC_POLICY.tiers.find((item) => (candidate.officialScore as number) >= item.minScore);
    const rewardCredits = Math.min(tier?.credits ?? 0, MONTHLY_RC_POLICY.individualCap);
    return {
      staffId,
      officialScore: candidate.officialScore,
      rewardCredits,
      eligible: rewardCredits > 0,
      reason: rewardCredits > 0 ? "eligible" : "below_minimum_score",
    };
  });
  const awardedCredits = allocations.reduce((sum, item) => sum + item.rewardCredits, 0);
  if (awardedCredits > MONTHLY_RC_POLICY.awardableCredits) {
    throw new Error("MONTHLY_RC_BUDGET_EXCEEDED");
  }
  return {
    allocations,
    awardedCredits,
    reserveCredits: MONTHLY_RC_POLICY.totalCredits - awardedCredits,
  };
}
