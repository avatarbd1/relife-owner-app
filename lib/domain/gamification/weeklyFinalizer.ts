export type WeeklyFinalizerRole = "Therapist" | "Receptionist";

export interface WeeklyRoleScorePolicy {
  role: WeeklyFinalizerRole;
  enabled: boolean;
  weights: Record<string, number>;
  targets: Record<string, number>;
}

export interface WeeklyVerifiedCounts {
  completedSessions: number;
  onTimeAttendances: number;
  totalAttendances: number;
  documentedSessions: number;
  registrations: number;
  paymentsProcessed: number;
  bookingsCreated: number;
  cashReconciliationsExact: number;
  cashReconciliationsTotal: number;
}

export interface WeeklyMetricComponent {
  score: number | null;
  numerator: number | null;
  denominator: number | null;
  source: string;
  verified: boolean;
}

export interface WeeklyNormalizedScoreResult {
  officialScore: number | null;
  provisionalScore: number | null;
  coveredWeight: number;
  missingMetrics: string[];
  complete: boolean;
}

export interface WeeklyRoleScoreResult extends WeeklyNormalizedScoreResult {
  role: WeeklyFinalizerRole;
  components: Record<string, WeeklyMetricComponent>;
}

export interface WeeklyEarningTier {
  minScore: number;
  rewardCredits: number;
}

export interface WeeklyEarningPolicy {
  enabled: boolean;
  roles: Partial<Record<WeeklyFinalizerRole, WeeklyEarningTier[]>>;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function percentOfTarget(actual: number, denominator: number | null): number | null {
  if (!Number.isFinite(actual) || actual < 0) return null;
  if (denominator === null || !Number.isFinite(denominator) || denominator <= 0) return null;
  return round2(Math.min(100, (actual / denominator) * 100));
}

function ratioPercent(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || numerator < 0) return null;
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return round2(Math.min(100, (numerator / denominator) * 100));
}

function target(policy: WeeklyRoleScorePolicy, key: string): number | null {
  const value = policy.targets[key];
  return Number.isFinite(value) && value > 0 ? value : null;
}

function metric(
  score: number | null,
  numerator: number | null,
  denominator: number | null,
  source: string
): WeeklyMetricComponent {
  return {
    score,
    numerator,
    denominator,
    source,
    verified: score !== null,
  };
}

function calculateNormalizedScore(
  policy: WeeklyRoleScorePolicy,
  components: Record<string, number | null | undefined>
): WeeklyNormalizedScoreResult {
  const entries = Object.entries(policy.weights);
  if (!policy.enabled || entries.length === 0) {
    return {
      officialScore: null,
      provisionalScore: null,
      coveredWeight: 0,
      missingMetrics: entries.map(([key]) => key),
      complete: false,
    };
  }

  const totalWeight = entries.reduce((sum, [, weight]) => {
    if (!Number.isFinite(weight) || weight <= 0 || weight > 1) {
      throw new Error("INVALID_SCORE_WEIGHT");
    }
    return sum + weight;
  }, 0);
  if (Math.abs(totalWeight - 1) > 0.0001) {
    throw new Error("SCORE_WEIGHTS_MUST_SUM_TO_ONE");
  }

  let weightedTotal = 0;
  let coveredWeight = 0;
  const missingMetrics: string[] = [];
  for (const [key, weight] of entries) {
    const value = components[key];
    if (value === null || value === undefined) {
      missingMetrics.push(key);
      continue;
    }
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`INVALID_SCORE_COMPONENT:${key}`);
    }
    weightedTotal += value * weight;
    coveredWeight += weight;
  }

  const provisionalScore = coveredWeight > 0
    ? round2(weightedTotal / coveredWeight)
    : null;
  const complete = missingMetrics.length === 0;
  return {
    officialScore: complete ? round2(weightedTotal) : null,
    provisionalScore,
    coveredWeight: round2(coveredWeight),
    missingMetrics,
    complete,
  };
}

export function weeklyScoreForVerifiedCounts(
  role: WeeklyFinalizerRole,
  policy: WeeklyRoleScorePolicy,
  counts: WeeklyVerifiedCounts
): WeeklyRoleScoreResult {
  if (policy.role !== role) throw new Error("WEEKLY_ROLE_POLICY_MISMATCH");

  let components: Record<string, WeeklyMetricComponent>;
  if (role === "Therapist") {
    const sessionsTarget = target(policy, "sessions_per_week");
    const productivity = percentOfTarget(counts.completedSessions, sessionsTarget);
    const attendance = ratioPercent(
      counts.onTimeAttendances,
      counts.totalAttendances
    );
    const documentation = ratioPercent(
      Math.min(counts.documentedSessions, counts.completedSessions),
      counts.completedSessions
    );

    components = {
      productivity: metric(
        productivity,
        counts.completedSessions,
        sessionsTarget,
        "performance_events:session_completed"
      ),
      attendance: metric(
        attendance,
        counts.onTimeAttendances,
        counts.totalAttendances,
        "performance_events:attendance_on_time|attendance_check_in"
      ),
      documentation: metric(
        documentation,
        Math.min(counts.documentedSessions, counts.completedSessions),
        counts.completedSessions,
        "performance_events:treatment_documented"
      ),
      quality: metric(null, null, null, "verified_source_missing"),
      reliability: metric(null, null, null, "verified_source_missing"),
    };
  } else {
    const workflowTarget = target(policy, "workflow_transactions_per_week");
    const workflowTotal =
      counts.registrations + counts.paymentsProcessed + counts.bookingsCreated;
    const workflow = percentOfTarget(workflowTotal, workflowTarget);
    const attendance = ratioPercent(
      counts.onTimeAttendances,
      counts.totalAttendances
    );
    const cashAccuracy = ratioPercent(
      counts.cashReconciliationsExact,
      counts.cashReconciliationsTotal
    );

    components = {
      workflow: metric(
        workflow,
        workflowTotal,
        workflowTarget,
        "performance_events:patient_registered|payment_processed|appointment_booked"
      ),
      cash_accuracy: metric(
        cashAccuracy,
        counts.cashReconciliationsExact,
        counts.cashReconciliationsTotal,
        "performance_events:cash_reconciliation_exact|cash_reconciliation_mismatch"
      ),
      appointment_accuracy: metric(null, null, null, "verified_source_missing"),
      attendance: metric(
        attendance,
        counts.onTimeAttendances,
        counts.totalAttendances,
        "performance_events:attendance_on_time|attendance_check_in"
      ),
      error_control: metric(null, null, null, "verified_source_missing"),
    };
  }

  const scores = Object.fromEntries(
    Object.entries(components).map(([key, value]) => [key, value.score])
  );
  const score = calculateNormalizedScore(policy, scores);
  return { role, ...score, components };
}

export function weeklyRewardCreditsForScore(
  role: WeeklyFinalizerRole,
  officialScore: number | null,
  policy: WeeklyEarningPolicy
): { rewardCredits: number; matchedMinScore: number | null; eligible: boolean } {
  if (!policy.enabled || officialScore === null) {
    return { rewardCredits: 0, matchedMinScore: null, eligible: false };
  }
  const tiers = [...(policy.roles[role] || [])]
    .filter(
      (tier) =>
        Number.isFinite(tier.minScore) &&
        tier.minScore >= 0 &&
        tier.minScore <= 100 &&
        Number.isFinite(tier.rewardCredits) &&
        tier.rewardCredits >= 0
    )
    .sort((a, b) => b.minScore - a.minScore);
  const matched = tiers.find((tier) => officialScore >= tier.minScore) || null;
  return matched
    ? {
        rewardCredits: matched.rewardCredits,
        matchedMinScore: matched.minScore,
        eligible: matched.rewardCredits > 0,
      }
    : { rewardCredits: 0, matchedMinScore: null, eligible: false };
}
