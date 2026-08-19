export type GamificationRole =
  | "Therapist"
  | "Receptionist"
  | "Manager"
  | "Dentist"
  | "Owner";

export interface NormalizedScorePolicy {
  role: GamificationRole;
  enabled: boolean;
  weights: Record<string, number>;
}

export interface NormalizedScoreResult {
  officialScore: number | null;
  provisionalScore: number | null;
  coveredWeight: number;
  missingMetrics: string[];
  complete: boolean;
}

export interface RankedNormalizedScore {
  staffId: string;
  normalizedScore: number | null;
  rank: number | null;
}

export type RewardCreditEntryType =
  | "earned"
  | "reserved"
  | "released"
  | "redeemed"
  | "refunded"
  | "expired"
  | "adjustment_credit"
  | "adjustment_debit";

export interface RewardCreditEntry {
  entryType: RewardCreditEntryType;
  creditAmount: number;
  redemptionId?: string | null;
}

export interface RewardCreditBalance {
  ledgerBalance: number;
  reservedBalance: number;
  availableBalance: number;
  valid: boolean;
  violations: string[];
}

export interface PerformanceBonusTier {
  key: string;
  min: number;
  max: number;
  bonus: number;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function assertPercent(value: number, key: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`INVALID_SCORE_COMPONENT:${key}`);
  }
}

function assertWeights(weights: Record<string, number>): void {
  const entries = Object.entries(weights);
  if (entries.length === 0) throw new Error("EMPTY_SCORE_POLICY");
  let total = 0;
  for (const [key, weight] of entries) {
    if (!Number.isFinite(weight) || weight <= 0 || weight > 1) {
      throw new Error(`INVALID_SCORE_WEIGHT:${key}`);
    }
    total += weight;
  }
  if (Math.abs(total - 1) > 0.0001) {
    throw new Error("SCORE_WEIGHTS_MUST_SUM_TO_ONE");
  }
}

/**
 * Calculates a role-internal normalized score on a 0-100 scale.
 *
 * Missing required metrics never become zero. The engine can return a
 * provisional score from available components, but officialScore remains null
 * until every configured component is backed by a verified metric source.
 */
export function calculateNormalizedScore(
  policy: NormalizedScorePolicy,
  components: Record<string, number | null | undefined>
): NormalizedScoreResult {
  if (!policy.enabled) {
    return {
      officialScore: null,
      provisionalScore: null,
      coveredWeight: 0,
      missingMetrics: Object.keys(policy.weights),
      complete: false,
    };
  }

  assertWeights(policy.weights);

  let weightedTotal = 0;
  let coveredWeight = 0;
  const missingMetrics: string[] = [];

  for (const [key, weight] of Object.entries(policy.weights)) {
    const value = components[key];
    if (value === null || value === undefined) {
      missingMetrics.push(key);
      continue;
    }
    assertPercent(value, key);
    weightedTotal += value * weight;
    coveredWeight += weight;
  }

  const provisionalScore =
    coveredWeight > 0 ? round2(weightedTotal / coveredWeight) : null;
  const complete = missingMetrics.length === 0;

  return {
    officialScore: complete ? round2(weightedTotal) : null,
    provisionalScore,
    coveredWeight: round2(coveredWeight),
    missingMetrics,
    complete,
  };
}

/**
 * Produces a fair leaderboard from official normalized scores only.
 * Incomplete/disabled roles receive no rank. Equal scores share a rank.
 */
export function rankNormalizedScores(
  entries: Array<{ staffId: string; normalizedScore: number | null }>
): RankedNormalizedScore[] {
  const ranked = entries
    .filter((entry) => entry.normalizedScore !== null)
    .map((entry) => {
      assertPercent(entry.normalizedScore as number, entry.staffId);
      return entry as { staffId: string; normalizedScore: number };
    })
    .sort((a, b) => {
      if (b.normalizedScore !== a.normalizedScore) {
        return b.normalizedScore - a.normalizedScore;
      }
      return a.staffId.localeCompare(b.staffId);
    });

  const rankByStaff = new Map<string, number>();
  let previousScore: number | null = null;
  let previousRank = 0;
  ranked.forEach((entry, index) => {
    const rank = previousScore === entry.normalizedScore ? previousRank : index + 1;
    rankByStaff.set(entry.staffId, rank);
    previousScore = entry.normalizedScore;
    previousRank = rank;
  });

  return entries.map((entry) => ({
    staffId: entry.staffId,
    normalizedScore: entry.normalizedScore,
    rank: entry.normalizedScore === null ? null : rankByStaff.get(entry.staffId) ?? null,
  }));
}

/** Converts a raw target achievement into a capped 0-100 component. */
export function percentOfTarget(actual: number, target: number): number {
  if (!Number.isFinite(actual) || actual < 0) throw new Error("INVALID_ACTUAL_VALUE");
  if (!Number.isFinite(target) || target <= 0) throw new Error("INVALID_TARGET_VALUE");
  return round2(Math.min(100, (actual / target) * 100));
}

/** Converts a 0-5 rating into a 0-100 score. */
export function ratingToPercent(rating: number): number {
  if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
    throw new Error("INVALID_RATING");
  }
  return round2((rating / 5) * 100);
}

/** Converts a 0-1 error/cancellation rate into a reliability percentage. */
export function inverseRateToPercent(rate: number): number {
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error("INVALID_RATE");
  }
  return round2((1 - rate) * 100);
}

/**
 * Reduces the immutable Reward Credit event stream into three separate values:
 * ledger balance, currently reserved balance, and spendable available balance.
 */
export function calculateRewardCreditBalance(
  entries: RewardCreditEntry[]
): RewardCreditBalance {
  let ledgerBalance = 0;
  const reservations = new Map<string, number>();
  const violations: string[] = [];

  for (const entry of entries) {
    const amount = entry.creditAmount;
    if (!Number.isFinite(amount) || amount <= 0) {
      violations.push("INVALID_CREDIT_AMOUNT");
      continue;
    }

    if (
      entry.entryType === "earned" ||
      entry.entryType === "refunded" ||
      entry.entryType === "adjustment_credit"
    ) {
      ledgerBalance += amount;
      continue;
    }

    if (entry.entryType === "expired" || entry.entryType === "adjustment_debit") {
      ledgerBalance -= amount;
      continue;
    }

    const redemptionId = String(entry.redemptionId || "").trim();
    if (!redemptionId) {
      violations.push(`MISSING_REDEMPTION_ID:${entry.entryType}`);
      continue;
    }

    const reserved = reservations.get(redemptionId) || 0;
    if (entry.entryType === "reserved") {
      reservations.set(redemptionId, reserved + amount);
      continue;
    }

    if (entry.entryType === "released") {
      if (amount > reserved) violations.push(`OVER_RELEASE:${redemptionId}`);
      reservations.set(redemptionId, Math.max(0, reserved - amount));
      continue;
    }

    if (entry.entryType === "redeemed") {
      if (amount > reserved) violations.push(`REDEEM_WITHOUT_RESERVE:${redemptionId}`);
      reservations.set(redemptionId, Math.max(0, reserved - amount));
      ledgerBalance -= amount;
    }
  }

  const reservedBalance = [...reservations.values()].reduce(
    (sum, value) => sum + value,
    0
  );
  const availableBalance = ledgerBalance - reservedBalance;
  if (ledgerBalance < 0) violations.push("NEGATIVE_LEDGER_BALANCE");
  if (availableBalance < 0) violations.push("NEGATIVE_AVAILABLE_BALANCE");

  return {
    ledgerBalance: round2(ledgerBalance),
    reservedBalance: round2(reservedBalance),
    availableBalance: round2(availableBalance),
    valid: violations.length === 0,
    violations,
  };
}

export function performanceBonusTierForScore(
  averageScore: number,
  tiers: PerformanceBonusTier[]
): PerformanceBonusTier | null {
  assertPercent(averageScore, "monthly_average");
  const matches = tiers.filter(
    (tier) => averageScore >= tier.min && averageScore <= tier.max
  );
  if (matches.length > 1) throw new Error("OVERLAPPING_BONUS_TIERS");
  return matches[0] || null;
}

export function calculatePerformanceBonus(
  baseBonus: number,
  multipliers: number[],
  ownerAdjustment = 0
): number {
  if (!Number.isFinite(baseBonus) || baseBonus < 0) {
    throw new Error("INVALID_BASE_BONUS");
  }
  if (!Number.isFinite(ownerAdjustment)) {
    throw new Error("INVALID_OWNER_ADJUSTMENT");
  }

  let total = baseBonus;
  for (const multiplier of multipliers) {
    if (!Number.isFinite(multiplier) || multiplier < 0) {
      throw new Error("INVALID_BONUS_MULTIPLIER");
    }
    total *= 1 + multiplier;
  }
  return Math.max(0, round2(total + ownerAdjustment));
}
