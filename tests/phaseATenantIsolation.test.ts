import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assertTenantOwned,
  bookableCapacity,
  clinicMayServe,
  isTenantOwned,
  resolveFeature,
  scopeToTenant,
  tenantKey,
  validateBookingConfig,
  type ClinicBookingConfig,
  type ClinicEntitlement,
  type ClinicFeatureFlag,
  type ClinicResource,
  type FeatureCatalogEntry,
} from "../lib/domain/tenancy/clinicConfiguration.ts";

/**
 * Phase A tenant isolation proof.
 *
 * These execute the real resolution logic rather than matching source text, so
 * a regression breaks the assertion instead of silently passing on a substring.
 * The migration-shape checks at the end are contract assertions on SQL that
 * cannot be executed here; they are labelled as such and are not counted as
 * behavioural evidence.
 */

const CLINIC_A = { organizationId: "org-a", clinicId: "clinic-a" };
const CLINIC_B = { organizationId: "org-b", clinicId: "clinic-b" };
/** Same clinic id as A, different organization: the cross-tenant trap. */
const CLINIC_A_OTHER_ORG = { organizationId: "org-b", clinicId: "clinic-a" };

function flag(
  scope: { organizationId: string; clinicId: string },
  featureKey: string,
  enabled = true
): ClinicFeatureFlag {
  return { ...scope, featureKey, enabled };
}

function grant(
  scope: { organizationId: string; clinicId: string },
  featureKey: string,
  overrides: Partial<ClinicEntitlement> = {}
): ClinicEntitlement {
  return {
    ...scope,
    featureKey,
    status: "active",
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveUntil: null,
    ...overrides,
  };
}

function catalog(
  ...entries: Array<string | FeatureCatalogEntry>
): FeatureCatalogEntry[] {
  return entries.map((entry) =>
    typeof entry === "string" ? { featureKey: entry, status: "active" } : entry
  );
}

const NOW = new Date("2026-06-01T00:00:00Z");

// ---------------------------------------------------------------------------
// 1. Clinic A cannot read Clinic B data
// ---------------------------------------------------------------------------

test("clinic A cannot read clinic B rows", () => {
  const rows = [
    { ...CLINIC_A, patientId: "PT0001" },
    { ...CLINIC_B, patientId: "PT0002" },
  ];

  const visible = scopeToTenant(CLINIC_A, rows);
  assert.deepEqual(visible.map((r) => r.patientId), ["PT0001"]);

  assert.equal(isTenantOwned(CLINIC_A, rows[1]), false);
});

test("a matching clinic id under another organization is not readable", () => {
  const foreignRow = { ...CLINIC_A_OTHER_ORG, patientId: "PT0001" };

  assert.equal(isTenantOwned(CLINIC_A, foreignRow), false);
  assert.deepEqual(scopeToTenant(CLINIC_A, [foreignRow]), []);
});

// ---------------------------------------------------------------------------
// 2. Clinic A cannot mutate Clinic B data
// ---------------------------------------------------------------------------

test("clinic A cannot mutate a clinic B row", () => {
  assert.throws(
    () => assertTenantOwned(CLINIC_A, { ...CLINIC_B }, "patient.update"),
    /TENANT_SCOPE_DENIED:patient\.update/
  );
});

test("mutation guard rejects a half-matching tenant key", () => {
  assert.throws(
    () => assertTenantOwned(CLINIC_A, { ...CLINIC_A_OTHER_ORG }, "patient.update"),
    /TENANT_SCOPE_DENIED/
  );
  assert.throws(
    () =>
      assertTenantOwned(
        CLINIC_A,
        { organizationId: CLINIC_A.organizationId, clinicId: CLINIC_B.clinicId },
        "patient.update"
      ),
    /TENANT_SCOPE_DENIED/
  );
});

test("mutation guard allows the owning tenant", () => {
  assert.doesNotThrow(() =>
    assertTenantOwned(CLINIC_A, { ...CLINIC_A }, "patient.update")
  );
});

// ---------------------------------------------------------------------------
// 3. Clinic-local IDs may safely overlap when tenant identity differs
// ---------------------------------------------------------------------------

test("the same clinic-local id in two clinics produces distinct keys", () => {
  for (const localId of ["BED-1", "ROOM-1", "PT0109", "RP0193"]) {
    assert.notEqual(tenantKey(CLINIC_A, localId), tenantKey(CLINIC_B, localId));
  }
});

test("the same local id under a different organization is a different key", () => {
  assert.notEqual(tenantKey(CLINIC_A, "BED-1"), tenantKey(CLINIC_A_OTHER_ORG, "BED-1"));
});

test("overlapping local ids do not leak between clinics when scoped", () => {
  const beds = [
    { ...CLINIC_A, resourceCode: "BED-1" },
    { ...CLINIC_B, resourceCode: "BED-1" },
  ];

  assert.deepEqual(
    scopeToTenant(CLINIC_A, beds).map((b) => b.resourceCode),
    ["BED-1"]
  );
  assert.equal(scopeToTenant(CLINIC_A, beds).length, 1);
});

// ---------------------------------------------------------------------------
// 4. Missing / ambiguous tenant context fails closed
// ---------------------------------------------------------------------------

test("blank or missing tenant identity is never owned", () => {
  const cases: Array<Partial<typeof CLINIC_A>> = [
    {},
    { organizationId: "org-a" },
    { clinicId: "clinic-a" },
    { organizationId: "", clinicId: "clinic-a" },
    { organizationId: "org-a", clinicId: "   " },
  ];

  for (const scope of cases) {
    assert.equal(
      isTenantOwned(scope as typeof CLINIC_A, { ...CLINIC_A }),
      false,
      `scope ${JSON.stringify(scope)} must fail closed`
    );
  }
});

test("a row with missing tenant columns is never owned", () => {
  assert.equal(isTenantOwned(CLINIC_A, {}), false);
  assert.equal(isTenantOwned(CLINIC_A, { organizationId: "org-a" }), false);
  assert.equal(isTenantOwned(CLINIC_A, { clinicId: "clinic-a" }), false);
});

test("a blank clinic-local id is refused rather than keyed", () => {
  assert.throws(() => tenantKey(CLINIC_A, "  "), /TENANT_LOCAL_ID_REQUIRED/);
});

test("feature resolution fails closed on an unusable scope", () => {
  const config = {
    catalog: catalog("optional.live_chamber"),
    flags: [flag(CLINIC_A, "optional.live_chamber")],
    entitlements: [grant(CLINIC_A, "optional.live_chamber")],
  };

  assert.equal(
    resolveFeature({ organizationId: "", clinicId: "" }, "optional.live_chamber", config, NOW),
    false
  );
  assert.equal(resolveFeature(CLINIC_A, "   ", config, NOW), false);
});

test("only an active clinic may serve traffic", () => {
  assert.equal(clinicMayServe("active"), true);
  for (const state of ["draft", "setup", "ready", "suspended", "archived", "", null, undefined]) {
    assert.equal(clinicMayServe(state as string), false, `${state} must not serve`);
  }
});

// ---------------------------------------------------------------------------
// 5. Relife-specific defaults cannot silently become new-clinic defaults
// ---------------------------------------------------------------------------

test("an unconfigured clinic gets no features", () => {
  const empty = { catalog: catalog("core.patients"), flags: [], entitlements: [] };
  for (const key of ["core.patients", "optional.live_chamber", "optional.gamification"]) {
    assert.equal(resolveFeature(CLINIC_B, key, empty, NOW), false, `${key} must be off`);
  }
});

test("one clinic's feature configuration never grants another clinic", () => {
  const config = {
    catalog: catalog("optional.gamification"),
    flags: [flag(CLINIC_A, "optional.gamification")],
    entitlements: [grant(CLINIC_A, "optional.gamification")],
  };

  assert.equal(resolveFeature(CLINIC_A, "optional.gamification", config, NOW), true);
  assert.equal(resolveFeature(CLINIC_B, "optional.gamification", config, NOW), false);
  assert.equal(
    resolveFeature(CLINIC_A_OTHER_ORG, "optional.gamification", config, NOW),
    false
  );
});

test("capability without a commercial grant does not open a feature", () => {
  assert.equal(
    resolveFeature(
      CLINIC_A,
      "optional.live_chamber",
      {
        catalog: catalog("optional.live_chamber"),
        flags: [flag(CLINIC_A, "optional.live_chamber")],
        entitlements: [],
      },
      NOW
    ),
    false
  );
});

test("a grant without capability does not open a feature", () => {
  assert.equal(
    resolveFeature(
      CLINIC_A,
      "optional.live_chamber",
      {
        catalog: catalog("optional.live_chamber"),
        flags: [],
        entitlements: [grant(CLINIC_A, "optional.live_chamber")],
      },
      NOW
    ),
    false
  );
});

test("a retired catalog feature stays closed despite flag and grant", () => {
  assert.equal(
    resolveFeature(
      CLINIC_A,
      "optional.live_chamber",
      {
        catalog: catalog({ featureKey: "optional.live_chamber", status: "retired" }),
        flags: [flag(CLINIC_A, "optional.live_chamber")],
        entitlements: [grant(CLINIC_A, "optional.live_chamber")],
      },
      NOW
    ),
    false
  );
});

test("a feature missing from the catalog stays closed despite flag and grant", () => {
  assert.equal(
    resolveFeature(
      CLINIC_A,
      "optional.unknown_capability",
      {
        catalog: catalog("optional.live_chamber"),
        flags: [flag(CLINIC_A, "optional.unknown_capability")],
        entitlements: [grant(CLINIC_A, "optional.unknown_capability")],
      },
      NOW
    ),
    false
  );
});

test("suspended, revoked, future and expired grants all fail closed", () => {
  const flags = [flag(CLINIC_A, "optional.salary")];
  const cases: Array<[string, Partial<ClinicEntitlement>]> = [
    ["suspended", { status: "suspended" }],
    ["revoked", { status: "revoked" }],
    ["not yet effective", { effectiveFrom: new Date("2026-12-01T00:00:00Z") }],
    ["expired", { effectiveUntil: new Date("2026-02-01T00:00:00Z") }],
  ];

  for (const [label, overrides] of cases) {
    assert.equal(
      resolveFeature(
        CLINIC_A,
        "optional.salary",
        {
          catalog: catalog("optional.salary"),
          flags,
          entitlements: [grant(CLINIC_A, "optional.salary", overrides)],
        },
        NOW
      ),
      false,
      `${label} grant must not open the feature`
    );
  }
});

test("a disabled flag closes a feature even with a valid grant", () => {
  assert.equal(
    resolveFeature(
      CLINIC_A,
      "optional.salary",
      {
        catalog: catalog("optional.salary"),
        flags: [flag(CLINIC_A, "optional.salary", false)],
        entitlements: [grant(CLINIC_A, "optional.salary")],
      },
      NOW
    ),
    false
  );
});

// ---------------------------------------------------------------------------
// Facility and booking configuration are clinic data, not product constants
// ---------------------------------------------------------------------------

function resource(
  scope: { organizationId: string; clinicId: string },
  overrides: Partial<ClinicResource> = {}
): ClinicResource {
  return {
    ...scope,
    resourceCode: "BED-1",
    displayName: "Bed 1",
    resourceType: "BED",
    roomCode: null,
    capacity: 1,
    genderRestriction: null,
    isBookable: true,
    isRuntimeOnly: false,
    isActive: true,
    ...overrides,
  };
}

function booking(
  scope: { organizationId: string; clinicId: string },
  overrides: Partial<ClinicBookingConfig> = {}
): ClinicBookingConfig {
  return {
    ...scope,
    bookingMode: "simple",
    defaultDurationMin: 30,
    slotIntervalMin: 30,
    maxSimultaneous: null,
    providerRequired: true,
    resourceRequired: false,
    ...overrides,
  };
}

test("a clinic with no resources books in simple mode without a resource ceiling", () => {
  assert.equal(bookableCapacity(CLINIC_B, booking(CLINIC_B), []), null);
});

test("capacity is derived from the clinic's own resources, never a constant", () => {
  const config = booking(CLINIC_A, { bookingMode: "specific_resource", resourceRequired: true });

  assert.equal(
    bookableCapacity(CLINIC_A, config, [
      resource(CLINIC_A, { resourceCode: "BED-1" }),
      resource(CLINIC_A, { resourceCode: "BED-2" }),
      resource(CLINIC_A, { resourceCode: "BED-3", isActive: false }),
      resource(CLINIC_A, { resourceCode: "BED-4", isRuntimeOnly: true }),
    ]),
    2
  );

  // Another clinic's resources never contribute.
  assert.equal(
    bookableCapacity(CLINIC_A, config, [resource(CLINIC_B, { resourceCode: "BED-1" })]),
    0
  );
});

test("every configured resource type is accepted", () => {
  const config = booking(CLINIC_A, { bookingMode: "specific_resource", resourceRequired: true });
  const types: ClinicResource["resourceType"][] = [
    "BED",
    "DENTAL_CHAIR",
    "TREATMENT_TABLE",
    "CABIN",
    "ROOM",
    "MACHINE",
    "OTHER",
  ];

  const resources = types.map((resourceType, index) =>
    resource(CLINIC_A, { resourceCode: `RES-${index}`, resourceType })
  );

  assert.equal(bookableCapacity(CLINIC_A, config, resources), types.length);
});

test("another clinic's booking config is refused in every mode", () => {
  const foreignConfigs: Array<[string, ClinicBookingConfig]> = [
    ["simple", booking(CLINIC_B)],
    ["capacity", booking(CLINIC_B, { bookingMode: "capacity", maxSimultaneous: 99 })],
    [
      "specific_resource",
      booking(CLINIC_B, { bookingMode: "specific_resource", resourceRequired: true }),
    ],
  ];

  for (const [mode, config] of foreignConfigs) {
    assert.throws(
      () => bookableCapacity(CLINIC_A, config, [resource(CLINIC_A)]),
      /TENANT_SCOPE_DENIED:booking\.capacity/,
      `${mode} mode must refuse a foreign booking config`
    );
  }
});

test("a booking config from a matching clinic under another organization is refused", () => {
  assert.throws(
    () =>
      bookableCapacity(
        CLINIC_A,
        booking(CLINIC_A_OTHER_ORG, { bookingMode: "capacity", maxSimultaneous: 99 }),
        []
      ),
    /TENANT_SCOPE_DENIED/
  );
});

test("a booking config with missing tenant identity is refused", () => {
  const orphan = {
    ...booking(CLINIC_A),
    organizationId: "",
    clinicId: "",
  } as ClinicBookingConfig;

  assert.throws(() => bookableCapacity(CLINIC_A, orphan, []), /TENANT_SCOPE_DENIED/);
});

test("booking configuration validates its own mode requirements", () => {
  assert.equal(validateBookingConfig(booking(CLINIC_A)).valid, true);

  assert.deepEqual(
    validateBookingConfig(booking(CLINIC_A, { bookingMode: "capacity" })).problems,
    ["capacity mode requires maxSimultaneous"]
  );

  assert.deepEqual(
    validateBookingConfig(booking(CLINIC_A, { bookingMode: "specific_resource" })).problems,
    ["specific_resource mode requires resourceRequired"]
  );
});

// ---------------------------------------------------------------------------
// Migration shape. Contract assertions on SQL, not behavioural evidence:
// these prove the migration says what it must, not that a database matches it.
// ---------------------------------------------------------------------------

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260827130000_phase_a_clinic_configuration_foundation.sql",
    import.meta.url
  ),
  "utf8"
);

test("[sql contract] configuration tables are tenant scoped to relife.clinics", () => {
  for (const table of [
    "clinic_settings",
    "clinic_operating_hours",
    "clinic_feature_flags",
    "clinic_entitlements",
    "clinic_rooms",
    "clinic_resources",
    "clinic_services",
    "clinic_booking_config",
    "clinic_data_sources",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `${table}_tenant_fk foreign key \\(organization_id, clinic_id\\)\\s*references relife\\.clinics \\(organization_id, id\\)`
      ),
      `${table} must bind both tenant keys to the canonical clinic`
    );
  }
});

test("[sql contract] clinic-local codes are tenant scoped, allowing reuse", () => {
  assert.match(migration, /primary key \(organization_id, clinic_id, room_code\)/);
  assert.match(migration, /primary key \(organization_id, clinic_id, resource_code\)/);
  assert.match(migration, /primary key \(organization_id, clinic_id, service_code\)/);
});

test("[sql contract] migration seeds no clinic and no grant", () => {
  assert.doesNotMatch(migration, /insert into relife\.clinics/i);
  assert.doesNotMatch(migration, /insert into relife\.clinic_feature_flags/i);
  assert.doesNotMatch(migration, /insert into relife\.clinic_entitlements/i);
  assert.doesNotMatch(migration, /RELIFE-PHYSIO|RELIFE-DENTAL|amtali-main/);
});

test("[sql contract] configuration tables stay client-private", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table relife\.%I from anon, authenticated/);
  assert.match(migration, /_deny_anon/);
  assert.match(migration, /_deny_authenticated/);
});

test("[sql contract] the canonical clinic lifecycle is the full six states", () => {
  assert.match(
    migration,
    /check \(status in \('draft','setup','ready','active','suspended','archived'\)\)/
  );
});

test("[sql contract] widening the lifecycle never promotes a legacy clinic to active", () => {
  // The previous check allowed 'inactive'. Backfilling those rows to 'active'
  // would put a deliberately switched-off clinic back into service.
  assert.match(
    migration,
    /update relife\.clinics\s*set status = 'archived'\s*where status not in \('draft','setup','ready','active','suspended','archived'\)/
  );
  assert.doesNotMatch(migration, /set status = 'active'/);
});

test("[sql contract] the trusted server path is granted, browser roles are not", () => {
  assert.match(migration, /grant usage on schema relife to service_role/);
  assert.match(
    migration,
    /grant select, insert, update, delete on table relife\.%I to service_role/
  );
  assert.match(
    migration,
    /grant execute on function relife\.clinic_feature_enabled\(uuid, uuid, text, timestamptz\)\s*to service_role/
  );
  assert.doesNotMatch(migration, /grant [^;]*to (anon|authenticated)/i);
});
