import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wizard = readFileSync(new URL("../components/OwnerSetupWizard.tsx", import.meta.url), "utf8");
const featureRoute = readFileSync(new URL("../app/api/settings/features/route.ts", import.meta.url), "utf8");
const featureWriter = readFileSync(new URL("../lib/data/clinicFeatureFlags.ts", import.meta.url), "utf8");
const onboarding = readFileSync(new URL("../app/(dashboard)/onboarding/page.tsx", import.meta.url), "utf8");

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
