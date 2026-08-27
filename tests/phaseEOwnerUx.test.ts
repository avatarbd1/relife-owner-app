import test from "node:test";
import assert from "node:assert/strict";
import {
  parseTenantSelection,
  requireAuthorizedTenantSelection,
  serializeTenantSelection,
} from "../lib/domain/tenancy/tenantSelection.ts";

const clinicA = { organizationId: "org-a", clinicId: "shared-clinic", clinicName: "A" };
const clinicB = { organizationId: "org-b", clinicId: "shared-clinic", clinicName: "B" };
const clinicC = { organizationId: "org-a", clinicId: "clinic-c", clinicName: "C" };

test("active tenant preference round-trips the complete canonical scope", () => {
  const encoded = serializeTenantSelection(clinicA);
  assert.deepEqual(parseTenantSelection(encoded), { organizationId: "org-a", clinicId: "shared-clinic" });
});

test("missing and malformed tenant preferences fail closed", () => {
  assert.equal(parseTenantSelection(undefined), null);
  assert.equal(parseTenantSelection("org-a"), null);
  assert.equal(parseTenantSelection("org-a:"), null);
});

test("partial tenant selection rejects", () => {
  assert.throws(() => requireAuthorizedTenantSelection([clinicA], { organizationId: "org-a" }), /TENANT_SCOPE_REQUIRED/);
});

test("same clinic id in another organization cannot cross-match", () => {
  assert.equal(requireAuthorizedTenantSelection([clinicA, clinicB], clinicB).clinicName, "B");
  assert.throws(() => requireAuthorizedTenantSelection([clinicA], clinicB), /TENANT_SELECTION_NOT_AUTHORIZED/);
});

test("a clinic outside the authenticated membership list rejects", () => {
  assert.throws(() => requireAuthorizedTenantSelection([clinicA, clinicB], clinicC), /TENANT_SELECTION_NOT_AUTHORIZED/);
});
