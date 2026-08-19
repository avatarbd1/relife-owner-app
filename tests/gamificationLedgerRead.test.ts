import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const edge = source("supabase/functions/relife-gamification-api/index.ts");
const adapter = source("lib/data/supabaseGamification.ts");
const page = source("app/(dashboard)/performance/page.tsx");

test("staff summary reads XP by event time in Dhaka instead of ledger write time", () => {
  assert.match(edge, /action === "staff_summary"/);
  assert.match(edge, /from relife\.xp_ledger x/);
  assert.match(edge, /join relife\.performance_events e/);
  assert.match(edge, /e\.event_at at time zone 'Asia\/Dhaka'/);
  assert.match(edge, /between \$\{weekStart\}::date and \$\{weekEnd\}::date/);
  assert.match(edge, /= \$\{today\}::date/);
  assert.doesNotMatch(edge, /x\.created_at at time zone 'Asia\/Dhaka'/);
});

test("Reward Credit summary keeps ledger, reserved and available balances separate", () => {
  assert.match(edge, /entry_type in \('earned','refunded','adjustment_credit'\)/);
  assert.match(edge, /entry_type in \('redeemed','expired','adjustment_debit'\)/);
  assert.match(edge, /when entry_type = 'reserved' then credit_amount/);
  assert.match(edge, /when entry_type in \('released','redeemed'\) then -credit_amount/);
  assert.match(edge, /const availableBalance = ledgerBalance - reservedBalance/);
  assert.match(edge, /ledgerBalance >= 0/);
  assert.match(edge, /reservedBalance >= 0/);
  assert.match(edge, /availableBalance >= 0/);
});

test("staff summary exposes event progress and materialized weekly score when present", () => {
  assert.match(edge, /from relife\.performance_events/);
  assert.match(edge, /group by event_type, role_context/);
  assert.match(edge, /from relife\.weekly_performance/);
  assert.match(edge, /week_start = \$\{weekStart\}::date/);
  assert.match(edge, /weeklyPerformance: weekly/);
});

test("server adapter exposes a typed Gamification staff ledger summary", () => {
  assert.match(adapter, /export interface GamificationStaffSummary/);
  assert.match(adapter, /lifetimeXp: number/);
  assert.match(adapter, /weekXp: number/);
  assert.match(adapter, /todayXp: number/);
  assert.match(adapter, /ledgerBalance: number/);
  assert.match(adapter, /reservedBalance: number/);
  assert.match(adapter, /availableBalance: number/);
  assert.match(adapter, /getGamificationStaffSummary/);
  assert.match(adapter, /"staff_summary"/);
  assert.match(adapter, /3_000/);
});

test("Performance page shows immutable ledger truth and never treats missing ledger as zero", () => {
  assert.match(page, /getGamificationStaffSummary/);
  assert.match(page, /ledger \? ledger\.lifetimeXp : "—"/);
  assert.match(page, /ledger \? ledger\.weekXp : "—"/);
  assert.match(page, /Available RC/);
  assert.match(page, /Ledger unavailable — XP\/RC-কে 0 ধরে দেখানো হচ্ছে না/);
  assert.match(page, /rewardBalanceValid/);
  assert.doesNotMatch(page, /current\.xpEarnedThisWeek/);
  assert.doesNotMatch(page, /current\.xpEarnedToday/);
  assert.doesNotMatch(page, /entry\.xpEarnedThisWeek/);
});

test("weekly rank Reward Credit remains a preview and is not mislabeled as spendable balance", () => {
  assert.match(page, /const rankRewardPreview = weeklyRewardCredits/);
  assert.match(page, /weekly award preview/);
  assert.match(page, /এটা available balance নয়/);
  assert.match(page, /ledger\.rewardCredits\.availableBalance/);
  assert.doesNotMatch(page, /RC rank preview/);
});
