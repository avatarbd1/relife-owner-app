import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readiness = readFileSync(new URL("../lib/domain/tenancy/readinessEngine.ts", import.meta.url), "utf8");
const validationRoute = readFileSync(new URL("../app/api/setup/clinic-validation/route.ts", import.meta.url), "utf8");
const importRoute = readFileSync(new URL("../app/api/onboarding/import/route.ts", import.meta.url), "utf8");
const exportRoute = readFileSync(new URL("../app/api/onboarding/export-dry-run/route.ts", import.meta.url), "utf8");

const activePhaseF = `${readiness}\n${validationRoute}\n${importRoute}\n${exportRoute}`;

test("Phase F readiness never hard-codes infrastructure or isolation checks to PASS", () => {
  assert.match(readiness, /databaseSchemaReady = evidence\.databaseSchemaReady \?\?/);
  assert.match(readiness, /noRelifeDefaultsInActivePath = evidence\.noRelifeDefaultsInActivePath \?\?/);
  assert.match(readiness, /crossTenantIsolationVerified = evidence\.crossTenantIsolationVerified \?\?/);
  assert.match(readiness, /provisioningRollbackEvidencePresent = evidence\.provisioningRollbackEvidencePresent \?\?/);
  assert.doesNotMatch(readiness, /schema migration baseline verified/);
});

test("Phase F active paths do not import Relife fixed-tenant configuration", () => {
  assert.doesNotMatch(activePhaseF, /RELIFE_SUPABASE_SCOPE|default_clinic_id|default_organization_id/);
  assert.doesNotMatch(activePhaseF, /@\/lib\/config\/relifeSystem/);
});

test("Phase F validation collects database schema and cross-tenant probe evidence", () => {
  assert.match(validationRoute, /collectSchemaEvidence/);
  assert.match(validationRoute, /collectCrossTenantEvidence/);
  assert.match(validationRoute, /\.eq\("clinic_id", clinicId\)[\s\S]*?\.neq\("organization_id", organizationId\)/);
});

test("Phase F import validates the full dataset rather than only preview rows", () => {
  assert.match(importRoute, /analyzeImportRows\(entityType, rows, mappings, 10\)/);
  assert.match(importRoute, /mutationPerformed: false/);
});

test("Phase F export preview does not claim rollback or unsupported surfaces", () => {
  assert.match(exportRoute, /rollback:[\s\S]*?supported: false/);
  assert.match(exportRoute, /staff: \{ supported: false/);
  assert.match(exportRoute, /reports: \{ supported: false/);
});
