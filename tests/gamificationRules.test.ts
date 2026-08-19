import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateNormalizedScore,
  calculatePerformanceBonus,
  calculateRewardCreditBalance,
  performanceBonusTierForScore,
  percentOfTarget,
  rankNormalizedScores,
} from "../lib/domain/gamification/rules.ts";

test("normalized score is official only when every configured metric is verified", () => {
  const policy = {
    role: "Therapist" as const,
    enabled: true,
    weights: {
      productivity: 0.4,
      attendance: 0.2,
      documentation: 0.15,
      quality: 0.15,
      reliability: 0.1,
    },
  };

  const partial = calculateNormalizedScore(policy, {
    productivity: 87.5,
    attendance: 100,
    documentation: null,
    quality: null,
    reliability: null,
  });

  assert.equal(partial.officialScore, null);
  assert.equal(partial.provisionalScore, 91.67);
  assert.equal(partial.coveredWeight, 0.6);
  assert.deepEqual(partial.missingMetrics, ["documentation", "quality", "reliability"]);

  const complete = calculateNormalizedScore(policy, {
    productivity: 87.5,
    attendance: 100,
    documentation: 100,
    quality: 96,
    reliability: 100,
  });

  assert.equal(complete.officialScore, 94.4);
  assert.equal(complete.provisionalScore, 94.4);
  assert.equal(complete.complete, true);
});

test("leaderboard ranks only official normalized scores and shares ties", () => {
  const ranked = rankNormalizedScores([
    { staffId: "ST1", normalizedScore: 88 },
    { staffId: "ST2", normalizedScore: null },
    { staffId: "ST3", normalizedScore: 94 },
    { staffId: "ST4", normalizedScore: 88 },
  ]);

  assert.deepEqual(ranked, [
    { staffId: "ST1", normalizedScore: 88, rank: 2 },
    { staffId: "ST2", normalizedScore: null, rank: null },
    { staffId: "ST3", normalizedScore: 94, rank: 1 },
    { staffId: "ST4", normalizedScore: 88, rank: 2 },
  ]);
});

test("target achievement is capped at 100", () => {
  assert.equal(percentOfTarget(7, 8), 87.5);
  assert.equal(percentOfTarget(12, 8), 100);
});

test("pending Reward Credit request reserves balance without spending it", () => {
  const pending = calculateRewardCreditBalance([
    { entryType: "earned", creditAmount: 250 },
    { entryType: "reserved", creditAmount: 70, redemptionId: "REQ-1" },
  ]);
  assert.deepEqual(pending, {
    ledgerBalance: 250,
    reservedBalance: 70,
    availableBalance: 180,
    valid: true,
    violations: [],
  });

  const claimed = calculateRewardCreditBalance([
    { entryType: "earned", creditAmount: 250 },
    { entryType: "reserved", creditAmount: 70, redemptionId: "REQ-1" },
    { entryType: "redeemed", creditAmount: 70, redemptionId: "REQ-1" },
  ]);
  assert.equal(claimed.ledgerBalance, 180);
  assert.equal(claimed.reservedBalance, 0);
  assert.equal(claimed.availableBalance, 180);
  assert.equal(claimed.valid, true);

  const rejected = calculateRewardCreditBalance([
    { entryType: "earned", creditAmount: 250 },
    { entryType: "reserved", creditAmount: 70, redemptionId: "REQ-1" },
    { entryType: "released", creditAmount: 70, redemptionId: "REQ-1" },
  ]);
  assert.equal(rejected.ledgerBalance, 250);
  assert.equal(rejected.reservedBalance, 0);
  assert.equal(rejected.availableBalance, 250);
});

test("monthly tier uses configured 0-100 thresholds", () => {
  const tiers = [
    { key: "Bronze", min: 0, max: 59.99, bonus: 0 },
    { key: "Silver", min: 60, max: 74.99, bonus: 500 },
    { key: "Gold", min: 75, max: 89.99, bonus: 1000 },
    { key: "Platinum", min: 90, max: 100, bonus: 1500 },
  ];

  assert.equal(performanceBonusTierForScore(59.99, tiers)?.key, "Bronze");
  assert.equal(performanceBonusTierForScore(60, tiers)?.key, "Silver");
  assert.equal(performanceBonusTierForScore(88, tiers)?.key, "Gold");
  assert.equal(performanceBonusTierForScore(94.4, tiers)?.key, "Platinum");
});

test("performance bonus applies configured multipliers without changing base salary", () => {
  assert.equal(calculatePerformanceBonus(1000, [0.1, 0.2]), 1320);
  assert.equal(calculatePerformanceBonus(1000, [0.1, 0.2], -120), 1200);
});
