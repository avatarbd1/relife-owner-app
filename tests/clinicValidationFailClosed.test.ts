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

test("Phase C readiness reports real configuration checks and bounded scope", () => {
  for (const check of ["validLifecycle", "clinicProfileConfigured", "operatingHoursConfigured", "featureConfigurationConsistent", "requiredServicesConfigured", "tenantSafeConfigurationLookup"]) assert.match(route, new RegExp(check));
  assert.match(route, /finance, imports, onboarding and full activation remain deferred/);
});

test("Phase B readiness fails closed unless every advertised check passes", () => {
  assert.match(route, /Object\.values\(checks\)\.every\(Boolean\) && errors\.length === 0/);
});
