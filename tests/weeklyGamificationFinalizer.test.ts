import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

type ScoreResult = {
  officialScore: number | null;
  provisionalScore: number | null;
  coveredWeight: number;
  missingMetrics: string[];
  complete: boolean;
  components: Record<string, {
    score: number | null;
    numerator: number | null;
    denominator: number | null;
  }>;
};

type EarningResult = {
  rewardCredits: number;
  matchedMinScore: number | null;
  eligible: boolean;
};

async function engine() {
  const href = new URL(
    "../lib/domain/gamification/weeklyFinalizer.ts",
    import.meta.url
  ).href;
  return import(href) as Promise<{
    weeklyScoreForVerifiedCounts: (
      role: string,
      policy: object,
      counts: object
    ) => ScoreResult;
    weeklyRewardCreditsForScore: (
      role: string,
      officialScore: number | null,
      policy: object
    ) => EarningResult;
  }>;
}

const migration = source("supabase/migrations/20260819093000_weekly_gamification_finalizer.sql");
const edge = source("supabase/functions/relife-weekly-gamification-finalizer/index.ts");
const events = source("lib/domain/gamification/events.ts");
const clinical = source("lib/webos/clinical.ts");
const chamber = source("lib/webos/chamberClinicalNote.ts");
const cash = source("lib/webos/cashAcceptance.ts");
const access = source("lib/webos/access.ts");
const route = source("app/api/v1/gamification/weekly/finalize/route.ts");
const client = source("app/(dashboard)/performance/weekly/WeeklyFinalizationClient.tsx");

const therapistPolicy = {
  role: "Therapist",
  enabled: true,
  weights: {
    productivity: 0.4,
    attendance: 0.2,
    documentation: 0.15,
    quality: 0.15,
    reliability: 0.1,
  },
  targets: { sessions_per_week: 8 },
};

const receptionistPolicy = {
  role: "Receptionist",
  enabled: true,
  weights: {
    workflow: 0.4,
    cash_accuracy: 0.25,
    appointment_accuracy: 0.15,
    attendance: 0.1,
    error_control: 0.1,
  },
  targets: { workflow_transactions_per_week: 125 },
};

const emptyCounts = {
  completedSessions: 0,
  onTimeAttendances: 0,
  totalAttendances: 0,
  documentedSessions: 0,
  registrations: 0,
  paymentsProcessed: 0,
  bookingsCreated: 0,
  cashReconciliationsExact: 0,
  cashReconciliationsTotal: 0,
};

test("Therapist adapter uses verified session, attendance and documentation facts while missing quality/reliability stay incomplete", async () => {
  const { weeklyScoreForVerifiedCounts } = await engine();
  const result = weeklyScoreForVerifiedCounts("Therapist", therapistPolicy, {
    ...emptyCounts,
    completedSessions: 8,
    onTimeAttendances: 4,
    totalAttendances: 5,
    documentedSessions: 8,
  });

  assert.equal(result.officialScore, null);
  assert.equal(result.provisionalScore, 94.67);
  assert.equal(result.coveredWeight, 0.75);
  assert.deepEqual(result.missingMetrics, ["quality", "reliability"]);
  assert.equal(result.components.productivity.numerator, 8);
  assert.equal(result.components.productivity.denominator, 8);
  assert.equal(result.components.attendance.score, 80);
  assert.equal(result.components.documentation.score, 100);
});

test("Receptionist adapter uses workflow, accepted cash reconciliation and attendance while unsupported accuracy metrics stay incomplete", async () => {
  const { weeklyScoreForVerifiedCounts } = await engine();
  const result = weeklyScoreForVerifiedCounts("Receptionist", receptionistPolicy, {
    ...emptyCounts,
    registrations: 50,
    paymentsProcessed: 40,
    bookingsCreated: 35,
    cashReconciliationsExact: 9,
    cashReconciliationsTotal: 10,
    onTimeAttendances: 4,
    totalAttendances: 5,
  });

  assert.equal(result.officialScore, null);
  assert.equal(result.provisionalScore, 94);
  assert.equal(result.coveredWeight, 0.75);
  assert.deepEqual(result.missingMetrics, ["appointment_accuracy", "error_control"]);
  assert.equal(result.components.workflow.score, 100);
  assert.equal(result.components.cash_accuracy.score, 90);
  assert.equal(result.components.attendance.score, 80);
});

test("complete verified fixture produces official score and config-tier RC without production hardcoding", async () => {
  const { weeklyScoreForVerifiedCounts, weeklyRewardCreditsForScore } = await engine();
  const score = weeklyScoreForVerifiedCounts("Therapist", therapistPolicy, {
    ...emptyCounts,
    completedSessions: 8,
    onTimeAttendances: 4,
    totalAttendances: 5,
    documentedSessions: 8,
    qualityPercent: 90,
    reliabilityPercent: 95,
  });
  assert.equal(score.complete, true);
  assert.equal(score.officialScore, 94);
  assert.deepEqual(score.missingMetrics, []);

  const earning = weeklyRewardCreditsForScore("Therapist", score.officialScore, {
    enabled: true,
    roles: {
      Therapist: [
        { minScore: 90, rewardCredits: 120 },
        { minScore: 80, rewardCredits: 100 },
      ],
    },
  });
  assert.deepEqual(earning, {
    rewardCredits: 120,
    matchedMinScore: 90,
    eligible: true,
  });
});

test("incomplete score can never earn RC even when a test tier policy is enabled", async () => {
  const { weeklyScoreForVerifiedCounts, weeklyRewardCreditsForScore } = await engine();
  const score = weeklyScoreForVerifiedCounts("Therapist", therapistPolicy, {
    ...emptyCounts,
    completedSessions: 8,
    onTimeAttendances: 5,
    totalAttendances: 5,
    documentedSessions: 8,
  });
  const earning = weeklyRewardCreditsForScore("Therapist", score.officialScore, {
    enabled: true,
    roles: { Therapist: [{ minScore: 0, rewardCredits: 999 }] },
  });
  assert.equal(score.officialScore, null);
  assert.equal(earning.rewardCredits, 0);
  assert.equal(earning.eligible, false);
});

test("weekly schema snapshots cutoff config and links finalization, performance and immutable RC ledger", () => {
  assert.match(migration, /create table if not exists relife\.weekly_gamification_finalizations/);
  assert.match(migration, /finalization_key text not null/);
  assert.match(migration, /config_snapshot jsonb/);
  assert.match(migration, /source_cutoff_at timestamptz/);
  assert.match(migration, /add column if not exists finalization_id uuid/);
  assert.match(migration, /add column if not exists score_config_version integer/);
  assert.match(migration, /add column if not exists earning_config_version integer/);
  assert.match(migration, /add column if not exists weekly_performance_id uuid/);
  assert.match(migration, /score_snapshot jsonb/);
  assert.match(migration, /unique \(clinic_id, finalization_key\)/);
  assert.match(migration, /unique \(clinic_id, week_start\)/);
});

test("production earning config is fail-closed and contains no invented tier amounts", () => {
  assert.match(migration, /'reward\.weekly_score_tiers'/);
  assert.match(migration, /'enabled', false/);
  assert.match(migration, /'Therapist', '\[\]'::jsonb/);
  assert.match(migration, /'Receptionist', '\[\]'::jsonb/);
  assert.doesNotMatch(migration, /min_score/);
  assert.doesNotMatch(migration, /reward_credits[^\n]*[1-9][0-9]/);
});

test("cron is Monday 00:15 Dhaka and reads endpoint/key from Vault instead of plaintext", () => {
  assert.match(migration, /'weekly-gamification-finalizer'/);
  assert.match(migration, /'15 18 \* \* 0'/);
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /weekly_gamification_finalizer_url/);
  assert.match(migration, /weekly_gamification_finalizer_key/);
  assert.doesNotMatch(migration, /x-relife-server-key',\s*'[^']+'/);
});

test("finalizer resolves configuration at week cutoff and retries by deterministic finalization key", () => {
  assert.match(edge, /effective_from <= \$\{cutoff\}::timestamptz/);
  assert.match(edge, /effective_until is null or effective_until > \$\{cutoff\}::timestamptz/);
  assert.match(edge, /weekly:\$\{tenant\.clinicId\}:\$\{weekStart\}:v2/);
  assert.match(edge, /pg_advisory_xact_lock/);
  assert.match(edge, /gamification\.weekly\.already_finalized/);
  assert.match(edge, /configResolvedAtWeekCutoff: true/);
});

test("finalizer excludes incomplete scores from ranking and RC earning", () => {
  assert.match(edge, /not_eligible_incomplete_score/);
  assert.match(edge, /rewardForScore\(role, officialScore, earning\)/);
  assert.match(edge, /normalized_score is not null/);
  assert.match(edge, /dense_rank\(\) over \(order by normalized_score desc\)/);
  assert.match(edge, /weekly-score-tier:\$\{weeklyPerformanceId\}:v1/);
  assert.match(edge, /entry_type[\s\S]*?'earned'/);
  assert.match(edge, /on conflict \(clinic_id, idempotency_key\) do nothing/);
});

test("canonical clinical and Chamber writes project verified documentation only after treatment save", () => {
  assert.match(events, /eventType: "treatment_documented"/);
  assert.match(events, /canonical_human_verified_treatment_note/);
  assert.match(clinical, /appendEntityWithCellUpdatesAndAudit[\s\S]*recordTreatmentDocumentationGamification/);
  assert.match(clinical, /documentedAt: now\.provenance/);
  assert.match(chamber, /appendEntityWithCellUpdatesAndAudit[\s\S]*recordTreatmentDocumentationGamification/);
  assert.match(chamber, /documentedAt: now\.iso/);
});

test("accepted cash handover projects exact/mismatch fact to originating Receptionist without monetary payload", () => {
  assert.match(events, /cash_reconciliation_exact/);
  assert.match(events, /cash_reconciliation_mismatch/);
  assert.match(events, /differenceWasZero: exact/);
  assert.doesNotMatch(events, /payload:\s*\{[\s\S]*?difference:\s*input\.difference/);
  assert.match(cash, /const movedBy = at\(row, movedByIdx\)/);
  assert.match(cash, /decision === "Accepted" && movedBy/);
  assert.match(cash, /staffReference: movedBy/);
  assert.match(cash, /reconciledAt: now\.provenance/);
});

test("manual finalization is explicit Owner-only RBAC and server-derived actor identity", () => {
  assert.match(access, /"performance\.weekly\.finalize"/);
  const ownerSection = access.slice(access.indexOf("Owner: new Set"), access.indexOf("Manager: new Set"));
  assert.match(ownerSection, /"performance\.weekly\.finalize"/);
  const nonOwner = access.slice(access.indexOf("Manager: new Set"));
  assert.doesNotMatch(nonOwner, /"performance\.weekly\.finalize"/);
  assert.match(route, /requireCurrentAccessContext/);
  assert.match(route, /assertCanPerform\(context, "performance\.weekly\.finalize", "All"\)/);
  assert.match(route, /actorId: context\.staffId/);
  assert.match(route, /actorRoles: context\.roles/);
  assert.match(route, /isAllowedRequestOrigin/);
});

test("Owner UI never renders raw NULL score and separates official from provisional", () => {
  assert.match(client, /Official leaderboard eligible/);
  assert.match(client, /Provisional · awaiting verified sources/);
  assert.match(client, /Incomplete — verified sources missing/);
  assert.match(client, /score === null \? "—" : score\.toFixed\(1\)/);
  assert.match(client, /normalizedScore !== null/);
  assert.match(client, /normalizedScore === null/);
  assert.match(client, /No RC · incomplete official score/);
});
