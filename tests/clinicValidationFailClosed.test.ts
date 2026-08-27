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

test("Phase F readiness engine integrates trusted evidence collectors", () => {
  assert.match(route, /evaluateClinicReadiness/);
  assert.match(route, /collectSchemaEvidence/);
  assert.match(route, /collectCrossTenantEvidence/);
  assert.match(route, /provisioningRollbackEvidencePresent/);
});

test("Phase F readiness keeps runtime fallback evidence fail-closed", () => {
  assert.match(route, /PHASE_F_TENANT_RUNTIME_ATTESTATION/);
  assert.match(route, /readinessUnverified/);
  assert.match(route, /overallStatus === "READY_FOR_ACTIVATION"/);
});
