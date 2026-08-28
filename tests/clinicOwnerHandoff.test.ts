import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DiagnosticCategory,
  ModuleKind,
  ScriptTarget,
  transpileModule,
} from "typescript";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const canonicalIdentity = source("lib/webos/canonicalStaffIdentity.ts");
const enrollmentIdentity = source("lib/webos/enrollmentIdentity.ts");
const enrollStart = source("app/api/auth/enroll/start/route.ts");
const currentUser = source("lib/webos/currentUser.ts");
const loginVerify = source("app/api/auth/webauthn/authenticate/verify/route.ts");
const platformRoute = source("app/api/platform/clinics/route.ts");
const handoffPanel = source("components/platform/ClinicOwnerAccessPanel.tsx");
const platformPage = source("app/platform/page.tsx");
const staffSetup = source("app/staff-setup/page.tsx");
const webauthn = source("lib/webauthn.ts");
const registerStart = source("app/api/auth/webauthn/register/start/route.ts");
const registerVerify = source("app/api/auth/webauthn/register/verify/route.ts");

test("owner handoff sources remain valid TypeScript syntax", () => {
  for (const code of [canonicalIdentity, enrollmentIdentity, enrollStart, currentUser, loginVerify, platformRoute, handoffPanel, platformPage, staffSetup]) {
    const result = transpileModule(code, {
      compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext, jsx: 4 },
      reportDiagnostics: true,
    });
    const errors = (result.diagnostics || []).filter(
      (diagnostic) => diagnostic.category === DiagnosticCategory.Error,
    );
    assert.deepEqual(errors, []);
  }
});

test("canonical enrollment permits setup owners but operational login remains active-only", () => {
  assert.match(canonicalIdentity, /\["setup", "active"\]\.includes\(clinic\.status\)/);
  assert.match(canonicalIdentity, /resolveStaffTenantContext\(normalizedStaffId, requestedScope\)/);
  assert.match(loginVerify, /STAFF_ACCESS_INACTIVE_OR_CLINIC_NOT_ACTIVE/);
  assert.match(loginVerify, /getCanonicalActiveWebStaffById\(staffId\)/);
});

test("first-device enrollment no longer requires the legacy Google Sheet staff directory", () => {
  assert.match(enrollmentIdentity, /getCanonicalEnrollmentWebStaffById\(claims\.staffId\)/);
  assert.ok(
    enrollmentIdentity.indexOf("getCanonicalEnrollmentWebStaffById(claims.staffId)") <
      enrollmentIdentity.indexOf("getLegacyEnrollmentIdentity(claims.staffId)"),
  );
  assert.match(enrollStart, /getEnrollmentIdentity\(token\)/);
  assert.doesNotMatch(enrollStart, /getActiveWebStaffById|toAccessContext/);
  assert.match(webauthn, /authorizedIdentity\?\.staffId === staffId/);
  assert.match(registerStart, /identity\.fullName,\s*identity,/);
  assert.match(registerVerify, /body\.displayName : undefined,\s*identity,/);
});

test("signed staff sessions prefer canonical tenant identity and keep legacy as fallback", () => {
  assert.match(currentUser, /getCanonicalActiveWebStaffById\(staffId, requestedScope\)/);
  assert.match(currentUser, /getLegacyStaffIdentity\(staffId\)/);
  assert.ok(
    currentUser.indexOf("getCanonicalActiveWebStaffById(staffId, requestedScope)") <
      currentUser.indexOf("getLegacyStaffIdentity(staffId)"),
  );
  assert.match(currentUser, /resolveStaffTenantContext\(identity\.staffId, requestedScope\)/);
});

test("platform owner can issue a short-lived setup link without exposing platform credentials", () => {
  assert.match(platformRoute, /"owner_setup_link"/);
  assert.match(platformRoute, /createStaffEnrollmentToken\(ownerStaffId, passkeys\.length\)/);
  assert.match(platformRoute, /STAFF_ENROLL_MAX_AGE/);
  assert.match(platformRoute, /clinic\.ownerStaffIds\.length !== 1/);
  assert.match(platformRoute, /clinic\.clinicStatus === "suspended"/);
  assert.match(handoffPanel, /Generate setup link/);
  assert.match(handoffPanel, /Never send the Platform Owner PIN, Supabase credentials, GitHub access, or Render access/);
  assert.match(platformPage, /<ClinicOwnerAccessPanel initialSnapshot=\{snapshot\} \/>/);
});

test("setup-clinic device enrollment does not drop the owner into operational home", () => {
  assert.match(staffSetup, /router\.replace\("\/login"\)/);
  assert.doesNotMatch(staffSetup, /router\.replace\("\/home"\)/);
  assert.match(staffSetup, /operational workspace Platform activation/);
});
