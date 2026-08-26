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

test("G2 readiness checks start false and are never initialized to a literal true", () => {
  const initializer = route.match(/checks: \{[\s\S]*?\},/)?.[0] || "";

  assert.notEqual(initializer, "", "readiness check initializer must be present");
  assert.doesNotMatch(
    initializer,
    /:\s*true/,
    "no readiness check may be seeded true; readiness evidence must be evaluated, not manufactured"
  );
});

test("G2 cross-tenant isolation is assigned from a probe, not a constant", () => {
  assert.match(
    route,
    /const isolationChecks = await checkCrossTenantIsolation\(organizationId, clinicId\)/
  );
  assert.match(
    route,
    /result\.checks\.crossTenantIsolationVerified = isolationChecks\.verified/
  );
});

test("G2 isolation probe detects dual-key contamination and fails closed", () => {
  // A row carrying this clinic under a different organization means
  // (organization_id, clinic_id) filtering is not an isolation boundary.
  assert.match(
    route,
    /\.eq\(probe\.column, clinicId\)[\s\S]*?\.neq\("organization_id", organizationId\)/
  );

  // Probe must cover the canonical mapping and the membership table.
  assert.match(route, /table: "clinics", column: "id"/);
  assert.match(route, /table: "clinic_memberships", column: "clinic_id"/);

  // Missing credentials or a failed probe must not read as verified.
  assert.match(
    route,
    /return \{ verified: false, gaps: \["Supabase service credentials unavailable"\] \}/
  );
  assert.match(route, /return \{ verified: gaps\.length === 0, gaps \}/);
});

test("G2 flag-backed checks are reported as unverified evidence", () => {
  assert.match(
    route,
    /result\.unverified\.push\(\s*"tenantFiltersPresentInReaders",\s*"explicitTenantParametersInWriters"\s*\)/
  );
});

test("G2 reader and writer coverage resolve from one shared flag, not lookalike helpers", () => {
  // Both rest on the same deployment assertion. Two separate helpers reading
  // the same env var would imply two independent proofs that do not exist.
  const helpers = route.match(/function validate\w+\(/g) || [];
  assert.deepEqual(helpers, ["function validateTenantEnforcementFlag("]);

  assert.match(
    route,
    /result\.checks\.tenantFiltersPresentInReaders = enforcementFlag\.valid;\s*result\.checks\.explicitTenantParametersInWriters = enforcementFlag\.valid;/
  );
});

test("G2 readiness fails closed unless writer and cross-tenant checks pass", () => {
  assert.match(
    route,
    /const readinessChecksPass =[\s\S]*?tenantContextResolvable[\s\S]*?departmentDataScopedToClinic[\s\S]*?tenantFiltersPresentInReaders[\s\S]*?explicitTenantParametersInWriters[\s\S]*?crossTenantIsolationVerified/
  );

  assert.match(
    route,
    /result\.isReady = allChecksPass && readinessChecksPass && result\.errors\.length === 0/
  );
});
