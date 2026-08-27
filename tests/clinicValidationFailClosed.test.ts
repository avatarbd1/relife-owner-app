import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(
  new URL("../app/api/setup/clinic-validation/route.ts", import.meta.url),
  "utf8"
);

test("Phase B clinic validation uses canonical staff membership and configuration readers", () => {
  assert.match(route, /loadStaffMembership/);
  assert.match(route, /readClinicConfiguration/);
  assert.doesNotMatch(route, /clinic_memberships/);
});

test("G2 privileged validation cannot inspect a different authenticated tenant", () => {
  assert.match(
    route,
    /organizationId !== tenant\.organizationId[\s\S]*?clinicId !== tenant\.clinicId[\s\S]*?TENANT_SCOPE_MISMATCH[\s\S]*?status: 403/
  );
});

test("Phase B readiness reports real configuration checks and bounded scope", () => {
  for (const check of ["validLifecycle", "clinicProfileConfigured", "operatingHoursConfigured", "featureConfigurationConsistent", "requiredServicesConfigured", "tenantSafeConfigurationLookup"]) assert.match(route, new RegExp(check));
  assert.match(route, /facility\/booking runtime, finance, imports and full activation remain deferred/);
});

test("Phase B readiness fails closed unless every advertised check passes", () => {
  assert.match(route, /Object\.values\(checks\)\.every\(Boolean\) && errors\.length === 0/);
});

test("Phase B keeps the unevaluated Phase A readiness markers visible and false", () => {
  // Phase A deliberately reported these as false with warnings so readiness
  // could not become true while nobody had evaluated them. Phase B does not
  // evaluate them either, so removing them from the response would let isReady
  // succeed on evidence that was never gathered.
  for (const marker of [
    "departmentDataScopedToClinic: false",
    "tenantFiltersPresentInReaders: false",
    "explicitTenantParametersInWriters: false",
  ]) {
    assert.ok(route.includes(marker), `${marker} must remain in the readiness response`);
  }

  // isReady is the conjunction over every check, so a false marker blocks it.
  assert.match(route, /isReady: Object\.values\(checks\)\.every\(Boolean\) && errors\.length === 0/);
});

test("Phase B tenant-safe lookup covers every tenant-owned configuration collection", () => {
  assert.match(
    route,
    /tenantSafeConfigurationLookup:[\s\S]*?configuration\.profile[\s\S]*?configuration\.operatingHours[\s\S]*?configuration\.flags[\s\S]*?configuration\.entitlements[\s\S]*?configuration\.services/
  );
});
