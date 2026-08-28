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
  generateOwnerStaffId,
  normalizePlatformClinicProvisioningInput,
  PLATFORM_PLANS,
  requireReleaseSha,
  slugifyPlatformName,
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

test("owner staff IDs always carry the Physiotherapy staff code", () => {
  assert.equal(generateOwnerStaffId("Relife Amtali", "physiotherapy"), "RLF-PT-001");
  assert.equal(generateOwnerStaffId("Smile Physio", "physiotherapy"), "SML-PT-001");
  assert.equal(generateOwnerStaffId("Care Center", "physiotherapy", 2), "CRA-PT-002");
});

test("platform slugs are generated safely from human clinic names", () => {
  assert.equal(slugifyPlatformName("Relief Physiotherapy"), "relief-physiotherapy");
  assert.equal(slugifyPlatformName("  Relief   Physio !!! "), "relief-physio");
  assert.equal(slugifyPlatformName("R"), "r-clinic");
  assert.equal(slugifyPlatformName("***"), "clinic");
});

test("minimal clinic input expands to a complete starter provisioning input", () => {
  const input = normalizePlatformClinicProvisioningInput({
    clinicName: "Relief Physiotherapy",
    clinicType: "physiotherapy",
  });
  assert.equal(input.organizationName, "Relief Physiotherapy");
  assert.equal(input.organizationSlug, "relief-physiotherapy");
  assert.equal(input.clinicSlug, "relief-physiotherapy");
  assert.equal(input.ownerStaffId, "RLF-PT-001");
  assert.equal(input.planCode, "starter");
  assert.equal(input.trialDays, 30);
  assert.equal(input.firstServiceName, "Physiotherapy Consultation");
  assert.deepEqual(input.openDays, [1, 2, 3, 4, 5, 6]);
});

test("the platform offers exactly one clinic template: Physiotherapy", () => {
  const physio = buildProvisioningPayload(normalizePlatformClinicProvisioningInput({ clinicName: "Physio One", clinicType: "physiotherapy" }));
  assert.equal(physio.services[0].department, "Physio");
  assert.equal(physio.rooms.length, 0);
  assert.equal(physio.resources.length, 0);
  assert.equal(physio.booking.mode, "simple");
  assert.equal(physio.booking.resourceRequired, false);

  for (const rejected of ["dental", "doctor_chamber", "other"]) {
    assert.throws(
      () => normalizePlatformClinicProvisioningInput({ clinicName: "Not Physio", clinicType: rejected as never }),
      /PLATFORM_CLINIC_TYPE_INVALID/,
      rejected,
    );
  }
});

test("provisioning always preserves canonical core features and seven-day hours", () => {
  const input = normalizePlatformClinicProvisioningInput({ ...baseInput(), featureKeys: ["optional.files"], openDays: [1, 3, 5], opensAt: "10:00", closesAt: "17:00" });
  for (const key of CORE_FEATURE_KEYS) assert.equal(input.featureKeys.includes(key), true, key);
  assert.equal(input.featureKeys.includes("optional.files"), true);
  const payload = buildProvisioningPayload(input);
  assert.equal(payload.operatingHours.length, 7);
  assert.deepEqual(payload.operatingHours.filter((row) => row.isOpen).map((row) => row.dayOfWeek), [1, 3, 5]);
  assert.equal(payload.owner.staffId, "OWN001");
  assert.equal(payload.services.length, 1);
});

test("trial end is bounded without deleting or transforming business data", () => {
  const start = new Date("2026-08-28T00:00:00.000Z");
  assert.equal(trialEndsAt(start, 30).toISOString(), "2026-09-27T00:00:00.000Z");
});

test("platform provisioning still rejects unsafe explicit identity and commercial inputs", () => {
  assert.throws(() => normalizePlatformClinicProvisioningInput({ ...baseInput(), ownerStaffId: "x" }), /STAFF_ID_INVALID/);
  assert.throws(() => normalizePlatformClinicProvisioningInput({ ...baseInput(), trialDays: 0 }), /TRIAL_DAYS_INVALID/);
});

test("activation requires an exact 40-character release SHA", () => {
  const sha = "a".repeat(40);
  assert.equal(requireReleaseSha(sha), sha);
  assert.throws(() => requireReleaseSha("main"), /RELEASE_SHA_INVALID/);
});
