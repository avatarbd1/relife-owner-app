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

test("passkey enrollment and login never use the global legacy staff directory as tenant authority", () => {
  const webauthn = source("lib/webauthn.ts");
  const registerStart = source("app/api/auth/webauthn/register/start/route.ts");
  const registerVerify = source("app/api/auth/webauthn/register/verify/route.ts");
  const authenticateVerify = source("app/api/auth/webauthn/authenticate/verify/route.ts");
  const loginAuthority = source("lib/webos/passkeyLoginAuthority.ts");

  assert.doesNotMatch(webauthn, /getActiveWebStaffById/);
  assert.match(registerStart, /getEnrollmentIdentity/);
  assert.match(registerStart, /getCurrentStaffIdentity/);
  assert.match(registerVerify, /getEnrollmentIdentity/);
  assert.match(registerVerify, /getCurrentStaffIdentity/);
  assert.match(authenticateVerify, /finishPasskeyAuthentication[\s\S]*requirePasskeyLoginAuthority\(staffId\)[\s\S]*createSessionToken\(staffId\)/);
  assert.match(loginAuthority, /isPlatformOwnerStaffId/);
  assert.match(loginAuthority, /resolveStaffTenantContext\(staffId\)/);
  assert.match(loginAuthority, /getTenantScopedWebStaffIdentity\(staffId, tenant\)/);
  assert.match(loginAuthority, /if \(!identity \|\| !toAccessContext\(identity\)\)/);
  assert.doesNotMatch(loginAuthority, /getActiveWebStaffById/);
});

test("platform provisioning returns a tenant-scoped owner setup link", () => {
  const route = source("app/api/platform/clinics/route.ts");
  assert.match(route, /ownerSetupUrl/);
  assert.match(route, /provisionedOwnerStaffId/);
  assert.match(route, /createOwnerSetupUrl\(provisionedOwnerStaffId, scope\)/);
  assert.match(route, /new URL\("\/staff-setup"/);
});

test("existing clinic setup links resolve one owner from the exact tenant snapshot without mutation", () => {
  const route = source("app/api/platform/clinics/route.ts");
  const consoleSource = source("components/platform/PlatformOwnerConsole.tsx");
  assert.match(route, /"owner_setup_link"/);
  assert.match(route, /action: "snapshot"/);
  assert.match(route, /row\.organizationId === scope\.organizationId && row\.clinicId === scope\.clinicId/);
  assert.match(route, /clinic\.ownerStaffIds\.length === 0/);
  assert.match(route, /clinic\.ownerStaffIds\.length !== 1/);
  assert.match(route, /createOwnerSetupUrl\(ownerStaffId, scope\)/);
  assert.match(consoleSource, /Generate owner setup link/);
  assert.match(consoleSource, /Read-only handoff/);
  assert.match(consoleSource, /expires in 10 minutes/);
});
