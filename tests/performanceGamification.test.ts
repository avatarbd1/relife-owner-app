import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("performance RBAC is explicit and staff roles do not inherit team authority", () => {
  const access = source("lib/webos/access.ts");

  for (const action of [
    "performance.read_self",
    "performance.read_leaderboard",
    "performance.read_team",
  ]) {
    assert.equal(access.includes(action), true, `${action} should be defined`);
  }

  assert.match(access, /Manager:[\s\S]*?"performance\.read_team"/);
  assert.match(access, /Owner:[\s\S]*?"performance\.read_team"/);
  assert.doesNotMatch(
    access,
    /Receptionist:[\s\S]*?"performance\.read_team"[\s\S]*?\]\),/
  );
});

test("verified performance activity comes only from canonical clinic events", () => {
  const performance = source("lib/webos/performance.ts");

  assert.match(performance, /getAppointmentsForContext/);
  assert.match(performance, /getPayments/);
  assert.match(performance, /03_Attendance/);
  assert.match(performance, /02_Patients/);
  assert.match(performance, /completedSessions/);
  assert.match(performance, /onTimeDays/);
  assert.match(performance, /paymentsProcessed/);
  assert.match(performance, /bookingsCreated/);
  assert.match(performance, /Math\.floor\(metrics\.registrations \/ 5\)/);
  assert.match(performance, /Math\.floor\(metrics\.paymentsProcessed \/ 10\)/);
  assert.match(performance, /Math\.floor\(metrics\.bookingsCreated \/ 5\)/);
});

test("official leaderboard uses complete normalized score, never raw XP counts", () => {
  const performance = source("lib/webos/performance.ts");

  assert.match(performance, /calculateNormalizedScore/);
  assert.match(performance, /rankNormalizedScores/);
  assert.match(performance, /normalizedScore/);
  assert.match(performance, /provisionalScore/);
  assert.match(performance, /missingScoreMetrics/);
  assert.match(performance, /scoreCoverage: PerformanceScoreCoverage/);
  assert.match(performance, /entry\.normalizedScore !== null && entry\.rank !== null/);
  assert.doesNotMatch(performance, /sort\(\(a, b\) => \{\s*if \(b\.points !== a\.points\)/);
});

test("missing role metrics fail closed instead of being treated as zero", () => {
  const performance = source("lib/webos/performance.ts");

  assert.match(performance, /documentation: null/);
  assert.match(performance, /quality: null/);
  assert.match(performance, /reliability: null/);
  assert.match(performance, /cash_accuracy: null/);
  assert.match(performance, /appointment_accuracy: null/);
  assert.match(performance, /error_control: null/);
  assert.match(performance, /coordination: null/);
  assert.match(performance, /staff_satisfaction: null/);
});

test("Gamification v2 keeps XP, Reward Credit and Performance Bonus separate", () => {
  const rewards = source("lib/webos/performanceRewards.ts");

  assert.match(rewards, /title: "2-hour Early Leave"/);
  assert.match(rewards, /creditCost: 40/);
  assert.match(rewards, /title: "Half-day Family Time"/);
  assert.match(rewards, /creditCost: 70/);
  assert.match(rewards, /title: "Paid Half-day"/);
  assert.match(rewards, /creditCost: 100/);
  assert.match(rewards, /title: "Priority Weekly Off"/);
  assert.match(rewards, /title: "Family Treat \/ Outing"/);
  assert.match(rewards, /creditCost: 150/);
  assert.doesNotMatch(rewards, /title: "Salary Bonus Review"/);
  assert.match(rewards, /rewardCreditsCanBuySalaryBonus: false/);
  assert.match(rewards, /automaticSalaryChange: false/);
  assert.match(rewards, /monthlyBonusOwnerApprovalRequired: true/);
  assert.match(rewards, /entry\.scoreCoverage !== "complete"/);
  assert.match(rewards, /entry\.normalizedScore === null/);
  assert.match(rewards, /entry\.rank === 1\) return 250/);
  assert.match(rewards, /entry\.rank === 2\) return 150/);
  assert.match(rewards, /entry\.rank === 3\) return 100/);
  assert.match(rewards, /return 50/);
  assert.match(rewards, /enabledForClaim: false/);
});

test("performance screen separates normalized score, XP and Reward Credit", () => {
  const page = source("app/(dashboard)/performance/page.tsx");
  const more = source("app/(dashboard)/more/page.tsx");

  assert.match(page, /Weekly normalized score/);
  assert.match(page, /Provisional/);
  assert.match(page, /Official Rank এখনো locked/);
  assert.match(page, /কী করলে XP বাড়বে/);
  assert.match(page, /XP, Score আর Reward Credit আলাদা/);
  assert.match(page, /Weekly Leaderboard/);
  assert.match(page, /Raw session\/payment count নয়/);
  assert.match(page, /Reward Credits/);
  assert.match(page, /reward\.creditCost/);
  assert.doesNotMatch(page, /Salary Bonus Review বা Family Treat/);
  assert.match(page, /Performance Bonus/);
  assert.match(page, /Verified activity milestones/);
  assert.match(more, /href="\/performance"/);
  assert.match(more, /Performance & rewards/);
});

test("gamification edge API uses server auth, idempotency and atomic XP audit writes", () => {
  const edge = source("supabase/functions/relife-gamification-api/index.ts");

  assert.match(edge, /x-relife-server-key/);
  assert.match(edge, /action === "config"/);
  assert.match(edge, /record_verified_event/);
  assert.match(edge, /pg_advisory_xact_lock/);
  assert.match(edge, /from relife\.performance_events/);
  assert.match(edge, /insert into relife\.performance_events/);
  assert.match(edge, /insert into relife\.xp_ledger/);
  assert.match(edge, /insert into relife\.audit_events/);
  assert.match(edge, /gamification\.performance_event\.record/);
});
