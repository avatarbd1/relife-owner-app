import assert from "node:assert/strict";
import test from "node:test";
import {
  isPlatformOwnerStaffId,
  parsePlatformOwnerStaffIds,
  postLoginPathForStaffId,
} from "../lib/domain/platform/authority.ts";
import {
  buildProvisioningPayload,
  CORE_FEATURE_KEYS,
  normalizePlatformClinicProvisioningInput,
  PLATFORM_PLANS,
  requireReleaseSha,
  trialEndsAt,
} from "../lib/domain/platform/platformOwnerMvp.ts";

function baseInput() {
  return {
    organizationName: "Example Health",
    organizationSlug: "example-health",
    clinicName: "Example Clinic",
    clinicSlug: "main-clinic",
    clinicType: "physiotherapy" as const,
    timezone: "Asia/Dhaka",
    ownerStaffId: "OWN001",
    planCode: "starter" as const,
    trialDays: 30,
  };
}

test("platform authority is an explicit allowlist, not a tenant Owner role", () => {
  assert.deepEqual(parsePlatformOwnerStaffIds(" ST001,OPS02,ST001 "), ["ST001", "OPS02"]);
  assert.equal(isPlatformOwnerStaffId("ST001", "ST001,OPS02"), true);
  assert.equal(isPlatformOwnerStaffId("ST001", ""), false);
  assert.equal(isPlatformOwnerStaffId("OWN001", "ST001,OPS02"), false);
  assert.equal(postLoginPathForStaffId("ST001", "ST001,OPS02"), "/platform");
  assert.equal(postLoginPathForStaffId("OWN001", "ST001,OPS02"), "/home");
  assert.equal(postLoginPathForStaffId("ST001", ""), "/home");
});

test("commercial plan prices and only approved premium minimums are defaulted", () => {
  assert.equal(PLATFORM_PLANS.starter.priceBdt, 499);
  assert.equal(PLATFORM_PLANS.standard.priceBdt, 999);
  assert.equal(PLATFORM_PLANS.premium.priceBdt, 1499);
  assert.deepEqual([...PLATFORM_PLANS.starter.defaultFeatureKeys], [...CORE_FEATURE_KEYS]);
  assert.deepEqual([...PLATFORM_PLANS.standard.defaultFeatureKeys], [...CORE_FEATURE_KEYS]);
  const premiumOptional = PLATFORM_PLANS.premium.defaultFeatureKeys.filter((key) => !CORE_FEATURE_KEYS.includes(key as (typeof CORE_FEATURE_KEYS)[number]));
  assert.deepEqual(premiumOptional, ["optional.live_chamber", "optional.gamification", "optional.finance_advanced"]);
});

test("provisioning always preserves canonical core features and seven-day hours", () => {
  const input = normalizePlatformClinicProvisioningInput({ ...baseInput(), featureKeys: ["optional.files"], openDays: [1, 3, 5], opensAt: "10:00", closesAt: "17:00" });
  for (const key of CORE_FEATURE_KEYS) assert.equal(input.featureKeys.includes(key), true, key);
  assert.equal(input.featureKeys.includes("optional.files"), true);
  const payload = buildProvisioningPayload(input);
  assert.equal(payload.operatingHours.length, 7);
  assert.deepEqual(payload.operatingHours.filter((row) => row.isOpen).map((row) => row.dayOfWeek), [1, 3, 5]);
  assert.equal(payload.owner.staffId, "OWN001");
  assert.equal(payload.booking.mode, "simple");
  assert.equal(payload.services.length, 1);
});

test("trial end is bounded without deleting or transforming business data", () => {
  const start = new Date("2026-08-28T00:00:00.000Z");
  assert.equal(trialEndsAt(start, 30).toISOString(), "2026-09-27T00:00:00.000Z");
});

test("platform provisioning rejects unsafe identity and commercial inputs", () => {
  assert.throws(() => normalizePlatformClinicProvisioningInput({ ...baseInput(), organizationSlug: "Bad Slug" }), /SLUG_INVALID/);
  assert.throws(() => normalizePlatformClinicProvisioningInput({ ...baseInput(), ownerStaffId: "x" }), /STAFF_ID_INVALID/);
  assert.throws(() => normalizePlatformClinicProvisioningInput({ ...baseInput(), trialDays: 0 }), /TRIAL_DAYS_INVALID/);
});

test("activation requires an exact 40-character release SHA", () => {
  const sha = "a".repeat(40);
  assert.equal(requireReleaseSha(sha), sha);
  assert.throws(() => requireReleaseSha("main"), /RELEASE_SHA_INVALID/);
});
