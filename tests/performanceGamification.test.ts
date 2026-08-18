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

test("reward policy supports leave, family time, weekly winner perks and controlled salary review", () => {
  const rewards = source("lib/webos/performanceRewards.ts");

  assert.match(rewards, /title: "Half-day"/);
  assert.match(rewards, /title: "Family time"/);
  assert.match(rewards, /title: "Day off"/);
  assert.match(rewards, /title: "Salary review"/);
  assert.match(rewards, /Clinic treat \/ outing/);
  assert.match(rewards, /"Family time", "Half-day"/);
  assert.match(rewards, /automaticSalaryChange: false/);
  assert.match(rewards, /enabledForClaim: false/);
  assert.match(rewards, /pointCost: null/);
});

test("performance screen exposes score, leaderboard, reward wallet direction and milestones", () => {
  const page = source("app/(dashboard)/performance/page.tsx");
  const more = source("app/(dashboard)/more/page.tsx");

  assert.match(page, /getPerformanceSnapshot/);
  assert.match(page, /Your weekly score/);
  assert.match(page, /Weekly leaderboard/);
  assert.match(page, /Use points for time off/);
  assert.match(page, /Point rate pending Owner approval/);
  assert.match(page, /Milestones/);
  assert.match(more, /href="\/performance"/);
  assert.match(more, /Performance & rewards/);
});
