import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(
  new URL("../app/api/setup/clinic-validation/route.ts", import.meta.url),
  "utf8"
);

test("G2 clinic validation binds membership lookup to organization, clinic, and staff", () => {
  assert.match(
    route,
    /\.from\("clinic_memberships"\)[\s\S]*?\.eq\("organization_id", organizationId\)[\s\S]*?\.eq\("clinic_id", clinicId\)[\s\S]*?\.eq\("user_id", staffId\)[\s\S]*?\.eq\("status", "active"\)/
  );
});

test("G2 privileged validation cannot inspect a different authenticated tenant", () => {
  assert.match(
    route,
    /organizationId !== tenant\.organizationId[\s\S]*?clinicId !== tenant\.clinicId[\s\S]*?TENANT_SCOPE_MISMATCH[\s\S]*?status: 403/
  );
});

test("G2 does not manufacture readiness evidence", () => {
  assert.match(route, /departmentDataScopedToClinic: false/);
  assert.match(route, /tenantFiltersPresentInReaders: false/);
  assert.match(route, /explicitTenantParametersInWriters: false/);
  assert.match(route, /crossTenantIsolationVerified: false/);
  assert.doesNotMatch(route, /function validateWriterPatterns/);
  assert.doesNotMatch(route, /RELIFE_TENANT_CUTOVER_ENFORCED feature flag not set/);
});

test("G2 readiness fails closed unless every advertised check passes", () => {
  assert.match(
    route,
    /const readinessChecksPass =[\s\S]*?tenantContextResolvable[\s\S]*?departmentDataScopedToClinic[\s\S]*?tenantFiltersPresentInReaders[\s\S]*?explicitTenantParametersInWriters[\s\S]*?crossTenantIsolationVerified/
  );

  assert.match(
    route,
    /result\.isReady = allChecksPass && readinessChecksPass && result\.errors\.length === 0/
  );
});
