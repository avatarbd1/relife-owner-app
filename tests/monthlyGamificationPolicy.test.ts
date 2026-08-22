import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  allocateMonthlyRewardCredits,
  GAMIFICATION_ELIGIBLE_STAFF_IDS,
  isGamificationEligibleStaffId,
  MONTHLY_RC_POLICY,
} from "../lib/domain/gamification/monthlyPolicy.ts";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("gamification cohort is exact and ID-scoped", () => {
  assert.deepEqual([...GAMIFICATION_ELIGIBLE_STAFF_IDS], [
    "ST002", "ST003", "ST004", "ST005", "ST008", "ST010", "ST011",
  ]);
  for (const staffId of ["ST001", "ST006", "ST007", "ST009", "Avro", "Jahid"]) {
    assert.equal(isGamificationEligibleStaffId(staffId), false);
  }
});

test("seven top scores fit the ৳1600 policy with 6 RC protected reserve", () => {
  const result = allocateMonthlyRewardCredits(
    GAMIFICATION_ELIGIBLE_STAFF_IDS.map((staffId) => ({
      staffId,
      officialScore: 100,
      publishedScheduledMinutes: 1,
      completeVerifiedMetrics: true,
    }))
  );
  assert.equal(result.awardedCredits, 154);
  assert.equal(result.reserveCredits, 6);
  assert.equal(MONTHLY_RC_POLICY.totalCredits * MONTHLY_RC_POLICY.bdtPerCredit, 1600);
  assert.ok(result.allocations.every((item) => item.rewardCredits === 22));
});

test("tiers are 90/80/70/60 and missing roster or metrics fail closed", () => {
  const result = allocateMonthlyRewardCredits([
    { staffId: "ST002", officialScore: 90, publishedScheduledMinutes: 1, completeVerifiedMetrics: true },
    { staffId: "ST003", officialScore: 80, publishedScheduledMinutes: 1, completeVerifiedMetrics: true },
    { staffId: "ST004", officialScore: 70, publishedScheduledMinutes: 1, completeVerifiedMetrics: true },
    { staffId: "ST005", officialScore: 60, publishedScheduledMinutes: 1, completeVerifiedMetrics: true },
    { staffId: "ST008", officialScore: 99, publishedScheduledMinutes: 0, completeVerifiedMetrics: true },
    { staffId: "ST010", officialScore: null, publishedScheduledMinutes: 1, completeVerifiedMetrics: false },
    { staffId: "ST007", officialScore: 100, publishedScheduledMinutes: 1, completeVerifiedMetrics: true },
  ]);
  assert.deepEqual(result.allocations.map((item) => item.rewardCredits), [22, 18, 14, 8, 0, 0, 0]);
  assert.equal(result.allocations[4].reason, "published_roster_missing");
  assert.equal(result.allocations[5].reason, "verified_score_incomplete");
  assert.equal(result.allocations[6].reason, "staff_id_excluded");
});

test("monthly RC finalizer bridges Published Sheets opportunity into the append-only Supabase ledger", () => {
  const route = source("app/api/v1/gamification/monthly/finalize/route.ts");
  const edge = source("supabase/functions/relife-weekly-gamification-finalizer/index.ts");
  const migration = source("supabase/migrations/20260822090000_monthly_gamification_roster_policy.sql");
  assert.match(route, /shift\.status === "Published"/);
  assert.match(route, /publishedScheduledMinutes/);
  assert.match(route, /MONTHLY_ROSTER_NOT_PUBLISHED/);
  assert.match(edge, /monthly:\$\{tenant\.clinicId\}:\$\{month\}:v1/);
  assert.match(edge, /MONTHLY_SCORE_INCOMPLETE/);
  assert.match(edge, /reward\.monthly_score_tiers/);
  assert.match(edge, /'monthly_score_tier'/);
  assert.match(edge, /monthly-score-tier:\$\{tenant\.clinicId\}:\$\{month\}:\$\{candidate\.staffId\}:v1/);
  assert.match(edge, /on conflict \(clinic_id, idempotency_key\) do nothing/);
  assert.match(migration, /create table if not exists relife\.monthly_gamification_finalizations/);
  assert.match(migration, /'cash_budget_bdt', 1600/);
  assert.match(migration, /'reserve_credits', 6/);
  assert.match(migration, /'individual_cap', 22/);
});

test("event ingestion, weekly scoring and leaderboard all enforce the same staff-ID cohort", () => {
  const api = source("supabase/functions/relife-gamification-api/index.ts");
  const weekly = source("supabase/functions/relife-weekly-gamification-finalizer/index.ts");
  const performance = source("lib/webos/performance.ts");
  const migration = source("supabase/migrations/20260822090000_monthly_gamification_roster_policy.sql");
  assert.match(api, /STAFF_NOT_GAMIFICATION_ELIGIBLE/);
  assert.match(weekly, /staff_id in \('ST002','ST003','ST004','ST005','ST008','ST010','ST011'\)/);
  assert.match(performance, /isGamificationEligibleStaffId\(identity\.staffId\)/);
  assert.match(weekly, /SUPPORTED_ROLES = new Set\(\["Therapist", "Receptionist", "Dentist"\]\)/);
  assert.match(migration, /score\.role\.dentist/);
});
