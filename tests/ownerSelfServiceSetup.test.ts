import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wizard = readFileSync(new URL("../components/OwnerSetupWizard.tsx", import.meta.url), "utf8");
const featureRoute = readFileSync(new URL("../app/api/settings/features/route.ts", import.meta.url), "utf8");
const featureWriter = readFileSync(new URL("../lib/data/clinicFeatureFlags.ts", import.meta.url), "utf8");
const facilityRoute = readFileSync(new URL("../app/api/settings/facility/route.ts", import.meta.url), "utf8");
const onboarding = readFileSync(new URL("../app/(dashboard)/onboarding/page.tsx", import.meta.url), "utf8");
const setupPage = readFileSync(new URL("../app/(dashboard)/onboarding/setup/page.tsx", import.meta.url), "utf8");
const importRoute = readFileSync(new URL("../app/api/onboarding/import/route.ts", import.meta.url), "utf8");
const validationRoute = readFileSync(new URL("../app/api/setup/clinic-validation/route.ts", import.meta.url), "utf8");
const handoff = readFileSync(new URL("../lib/domain/tenancy/onboardingHandoff.ts", import.meta.url), "utf8");
const phaseGProvisioning = readFileSync(new URL("../supabase/migrations/20260828012000_phase_g_canonical_clinic_provisioning.sql", import.meta.url), "utf8");
const accessPolicy = readFileSync(new URL("../lib/webos/access.ts", import.meta.url), "utf8");

test("owner setup reuses canonical clinic, facility, service and readiness routes", () => {
  for (const path of [
    "/api/settings/clinic",
    "/api/settings/facility",
    "/api/settings/services",
    "/api/setup/clinic-validation",
  ]) assert.ok(wizard.includes(path), `wizard must reuse ${path}`);
});

test("feature selection cannot mutate commercial entitlements", () => {
  assert.ok(featureRoute.includes("writeClinicFeatureFlag"));
  assert.ok(!featureRoute.includes('.from("clinic_entitlements").upsert'));
  assert.ok(!featureWriter.includes('.from("clinic_entitlements").upsert'));
  assert.ok(featureWriter.includes("FEATURE_NOT_ENTITLED"));
  assert.ok(featureWriter.includes("organization_id"));
  assert.ok(featureWriter.includes("clinic_id"));
});

test("facility replacement deactivates omitted rooms and resources", () => {
  assert.ok(facilityRoute.includes("staleRooms"));
  assert.ok(facilityRoute.includes("staleResources"));
  assert.ok(facilityRoute.includes("isActive: false"));
  assert.ok(facilityRoute.includes("isBookable: false"));
  assert.ok(!facilityRoute.includes("delete()"));
});

test("browser setup never exposes service role key or direct activation RPC", () => {
  assert.ok(!wizard.includes("SUPABASE_SERVICE_ROLE_KEY"));
  assert.ok(!wizard.includes("activate_clinic_v1"));
  assert.ok(wizard.includes("privileged activation"));
});

test("onboarding routes normal configuration into one self-service surface", () => {
  assert.ok(onboarding.includes('href="/onboarding/setup"'));
  assert.ok(onboarding.includes("Open self-service setup"));
  assert.ok(onboarding.includes("plan-entitlement authority"));
});

test("Clinic Owner and Platform Operator are explicit separate authorities", () => {
  assert.ok(setupPage.includes("Clinic Owner setup"));
  assert.ok(setupPage.includes("Platform Operator"));
  assert.ok(setupPage.includes('access.roles.includes("Owner")'));
  assert.ok(!setupPage.includes('access.roles.includes("System Admin")'));
  assert.ok(handoff.includes('platformOperatorIsBrowserRole: false'));
  assert.ok(handoff.includes('systemAdminIsPlatformOperator: false'));
  assert.ok(handoff.includes('clinicOwnerAuthority: "TENANT_CONFIGURATION_ONLY"'));
  assert.ok(accessPolicy.includes('"System Admin"'));
});

test("validated existing-data import closes as a non-mutating platform handoff", () => {
  assert.ok(importRoute.includes("buildImportHandoff"));
  assert.ok(importRoute.includes('createHash("sha256")'));
  assert.ok(importRoute.includes("sourceDigestSha256"));
  assert.ok(importRoute.includes("mutationPerformed: false"));
  assert.ok(!importRoute.includes("registerPatient("));
  assert.ok(!importRoute.includes("activate_clinic_v1"));
  assert.ok(handoff.includes('"READY_FOR_PLATFORM_IMPORT_REVIEW"'));
  assert.ok(handoff.includes("clinicOwnerMayExecuteImport: false"));
});

test("owner readiness hands off to exact-release service-role activation instead of claiming activation", () => {
  assert.ok(validationRoute.includes("buildActivationHandoff"));
  assert.ok(validationRoute.includes("mutationPerformed: false"));
  assert.ok(handoff.includes('"READY_FOR_PLATFORM_VERIFICATION"'));
  assert.ok(handoff.includes('platformOperatorAuthority: "OUT_OF_BAND_SERVICE_ROLE"'));
  assert.ok(handoff.includes("requiresExactReleaseShaEvidence: true"));
  assert.ok(handoff.includes('readinessRecordRpc: "relife.record_clinic_readiness_v1"'));
  assert.ok(handoff.includes('activationRpc: "relife.activate_clinic_v1"'));
  assert.match(phaseGProvisioning, /grant execute on function relife\.record_clinic_readiness_v1\(uuid,uuid,text,jsonb,text\) to service_role/);
  assert.match(phaseGProvisioning, /grant execute on function relife\.activate_clinic_v1\(uuid,uuid,text\) to service_role/);
  assert.match(phaseGProvisioning, /CLINIC_ACTIVATION_BLOCKED/);
});
