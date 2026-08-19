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

test("phase 1 performance activity comes only from canonical clinic events", () => {
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
  assert.match(rewards, /entry\.rank === 1\) return 250/);
  assert.match(rewards, /entry\.rank === 2\) return 150/);
  assert.match(rewards, /entry\.rank === 3\) return 100/);
  assert.match(rewards, /return 50/);
  assert.match(rewards, /rewardCredits: winner \? 250 : 0/);
  assert.match(rewards, /enabledForClaim: false/);
});

test("performance screen uses Reward Credit terminology and does not offer salary bonus redemption", () => {
  const page = source("app/(dashboard)/performance/page.tsx");
  const more = source("app/(dashboard)/more/page.tsx");

  assert.match(page, /getPerformanceSnapshot/);
  assert.match(page, /কী করলে Points বাড়বে/);
  assert.match(page, /Weekly Leaderboard/);
  assert.match(page, /Reward Credits/);
  assert.match(page, /XP\/Leaderboard score spend হয় না/);
  assert.match(page, /reward\.creditCost/);
  assert.doesNotMatch(page, /Salary Bonus Review বা Family Treat/);
  assert.match(page, /Performance Bonus/);
  assert.match(page, /Milestones/);
  assert.match(more, /href="\/performance"/);
  assert.match(more, /Performance & rewards/);
});
