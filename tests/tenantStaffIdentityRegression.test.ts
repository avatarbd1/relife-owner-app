import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("tenant staff identity requires an exact active binding before any legacy compatibility", () => {
  const resolver = source("lib/webos/tenantStaffDirectory.ts");
  assert.match(resolver, /listStoredStaffProvisioning\(tenant\)/);
  assert.match(resolver, /row\.staffId === staffId && row\.status === "active"/);
  assert.match(resolver, /if \(!binding\) return null;[\s\S]*const legacy = await legacyIdentity\(staffId\);/);
  assert.match(resolver, /if \(!hasTenantRoles && !hasTenantDepartments\)/);
  assert.match(resolver, /if \(hasTenantRoles !== hasTenantDepartments\) return null/);
});

test("platform owner authority cannot fall through into clinic staff access", () => {
  const currentUser = source("lib/webos/currentUser.ts");
  assert.match(currentUser, /if \(!staffId \|\| isPlatformOwner\(staffId\)\) return null/);
  assert.doesNotMatch(currentUser, /getActiveWebStaffById/);
  assert.match(currentUser, /resolveCurrentTenantForStaff/);
  assert.match(currentUser, /if \(isPlatformOwner\(staffId\)\) return null/);
});

test("staff enrollment is always bound to exact organization and clinic", () => {
  const token = source("lib/staffEnrollment.ts");
  const enrollment = source("lib/webos/enrollmentIdentity.ts");
  const ownerRoute = source("app/api/staff/enrollment-link/route.ts");
  assert.match(token, /organizationId: string/);
  assert.match(token, /clinicId: string/);
  assert.match(token, /scope: TenantScope/);
  assert.match(token, /!UUID\.test\(organizationId\)/);
  assert.match(token, /!UUID\.test\(clinicId\)/);
  assert.doesNotMatch(enrollment, /getActiveWebStaffById/);
  assert.match(enrollment, /getTenantScopedWebStaffIdentity\(claims\.staffId/);
  assert.match(ownerRoute, /getCurrentTenantAccessContext/);
  assert.match(ownerRoute, /createStaffEnrollmentToken\(staff\.staffId, passkeys\.length, current\.tenant\)/);
});

test("platform provisioning returns a tenant-scoped owner setup link", () => {
  const route = source("app/api/platform/clinics/route.ts");
  assert.match(route, /ownerSetupUrl/);
  assert.match(route, /provisionedOwnerStaffId/);
  assert.match(route, /createStaffEnrollmentToken[\s\S]*scope/);
  assert.match(route, /new URL\("\/staff-setup"/);
});
