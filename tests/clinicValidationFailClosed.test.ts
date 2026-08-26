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
