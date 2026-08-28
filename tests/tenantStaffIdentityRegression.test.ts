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

test("passkey registration does not re-impose the global legacy Sheet staff directory", () => {
  const webauthn = source("lib/webauthn.ts");
  const registrationStart = webauthn.slice(
    webauthn.indexOf("export async function beginPasskeyRegistration"),
    webauthn.indexOf("export async function finishPasskeyRegistration"),
  );
  const registrationFinish = webauthn.slice(
    webauthn.indexOf("export async function finishPasskeyRegistration"),
    webauthn.indexOf("export async function beginPasskeyAuthentication"),
  );

  assert.doesNotMatch(webauthn, /getActiveWebStaffById/);
  assert.doesNotMatch(registrationStart, /STAFF_NOT_FOUND/);
  assert.doesNotMatch(registrationFinish, /STAFF_NOT_FOUND/);
});

test("passkey authentication requires Platform Owner authority or an exact tenant identity", () => {
  const webauthn = source("lib/webauthn.ts");
  const authentication = webauthn.slice(
    webauthn.indexOf("export async function finishPasskeyAuthentication"),
  );

  assert.match(authentication, /isPlatformOwnerStaffId\(passkey\.staffId/);
  assert.match(authentication, /resolveStaffTenantContext\(passkey\.staffId\)/);
  assert.match(authentication, /getTenantScopedWebStaffIdentity\(passkey\.staffId, tenant\)/);
  assert.match(authentication, /if \(!tenantIdentity\) throw new Error\("STAFF_NOT_FOUND"\)/);
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
