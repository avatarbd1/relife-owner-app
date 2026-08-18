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

test("phase 1 performance points come from canonical clinic events", () => {
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

test("Reward Credit stays separate from leaderboard Points and supports approved perks", () => {
  const rewards = source("lib/webos/performanceRewards.ts");

  assert.match(rewards, /title: "2-hour Break"/);
  assert.match(rewards, /pointCost: 40/);
  assert.match(rewards, /title: "Half-day Family Time"/);
  assert.match(rewards, /pointCost: 70/);
  assert.match(rewards, /title: "Paid Half-day"/);
  assert.match(rewards, /pointCost: 100/);
  assert.match(rewards, /title: "Salary Bonus Review"/);
  assert.match(rewards, /pointCost: 120/);
  assert.match(rewards, /title: "Family Treat \/ Outing"/);
  assert.match(rewards, /pointCost: 150/);
  assert.match(rewards, /weeklyRewardCredits/);
  assert.match(rewards, /entry\.rank === 1\) return 50/);
  assert.match(rewards, /automaticSalaryChange: false/);
  assert.match(rewards, /enabledForClaim: false/);
});

test("performance screen gives user directions in Bangla while keeping product terms", () => {
  const page = source("app/(dashboard)/performance/page.tsx");
  const more = source("app/(dashboard)/more/page.tsx");

  assert.match(page, /getPerformanceSnapshot/);
  assert.match(page, /কী করলে Points বাড়বে/);
  assert.match(page, /প্রতিটি Session completed হলে \+1 Point পাবেন/);
  assert.match(page, /Weekly Leaderboard/);
  assert.match(page, /Points থেকে Reward/);
  assert.match(page, /এখন আপনার যা করতে হবে/);
  assert.match(page, /Reward Credit/);
  assert.match(page, /Milestones/);
  assert.match(more, /href="\/performance"/);
  assert.match(more, /Performance & rewards/);
});
