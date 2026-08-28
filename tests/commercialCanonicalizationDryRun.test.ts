import test from "node:test";
import assert from "node:assert/strict";
import { buildCommercialCanonicalizationDryRun } from "../lib/domain/tenancy/commercialCanonicalizationDryRun.ts";

const scope = { organizationId: "org-relife", clinicId: "clinic-amtali" };
const locked = [
  "optional.live_chamber",
  "optional.room_bed_runtime",
  "optional.machines",
  "optional.gamification",
  "optional.rewards",
  "optional.finance_advanced",
  "optional.salary",
  "optional.live_chat",
];

test("I-1 basic pilot explicitly locks optional modules without deleting data or grants", () => {
  const result = buildCommercialCanonicalizationDryRun({
    scope,
    activeCatalogKeys: locked,
    targets: locked.map((featureKey) => ({ featureKey, enabled: false, evidenceSources: ["owner-approved-basic-pilot"] })),
    current: {
      flags: [],
      entitlements: [{ ...scope, featureKey: locked[0], status: "active" }],
    },
  });

  assert.equal(result.verdict, "ready");
  assert.equal(result.dryRun, true);
  assert.equal(result.writesPerformed, false);
  assert.equal(result.deletesPlanned, false);
  assert.equal(result.operations.length, locked.length);
  assert.ok(result.operations.every((row) => row.table === "clinic_feature_flags"));
  assert.ok(result.operations.every((row) => row.action === "upsert"));
  assert.ok(result.operations.every((row) => row.values.enabled === false));
});

test("I-1 enabling a module plans a grant but still performs no mutation", () => {
  const result = buildCommercialCanonicalizationDryRun({
    scope,
    activeCatalogKeys: [locked[0]],
    targets: [{ featureKey: locked[0], enabled: true, evidenceSources: ["approved-module-smoke"] }],
    current: { flags: [], entitlements: [] },
  });

  assert.equal(result.verdict, "ready");
  assert.deepEqual(result.operations.map((row) => row.table), ["clinic_feature_flags", "clinic_entitlements"]);
  assert.equal(result.operations[1].action, "insert");
  assert.equal(result.writesPerformed, false);
});

test("I-1 canonicalization blocks missing evidence and unknown catalog keys", () => {
  const result = buildCommercialCanonicalizationDryRun({
    scope,
    activeCatalogKeys: [locked[0]],
    targets: [
      { featureKey: locked[0], enabled: false, evidenceSources: [] },
      { featureKey: locked[1], enabled: false, evidenceSources: ["owner-approved-basic-pilot"] },
    ],
    current: { flags: [], entitlements: [] },
  });

  assert.equal(result.verdict, "blocked");
  assert.ok(result.blockers.includes(`FEATURE_EVIDENCE_REQUIRED:${locked[0]}`));
  assert.ok(result.blockers.includes(`FEATURE_NOT_ACTIVE:${locked[1]}`));
  assert.equal(result.operations.length, 0);
});

test("I-1 canonicalization fails closed on mixed tenant state", () => {
  const result = buildCommercialCanonicalizationDryRun({
    scope,
    activeCatalogKeys: [locked[0]],
    targets: [{ featureKey: locked[0], enabled: false, evidenceSources: ["owner-approved-basic-pilot"] }],
    current: {
      flags: [{ organizationId: "other-org", clinicId: scope.clinicId, featureKey: locked[0], enabled: true }],
      entitlements: [],
    },
  });

  assert.equal(result.verdict, "blocked");
  assert.ok(result.blockers.includes("CROSS_TENANT_COMMERCIAL_STATE"));
});
