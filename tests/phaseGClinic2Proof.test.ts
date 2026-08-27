import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const provisioning = readFileSync(
  new URL("../supabase/migrations/20260828012000_phase_g_canonical_clinic_provisioning.sql", import.meta.url),
  "utf8",
);
const financeTenantFk = readFileSync(
  new URL("../supabase/migrations/20260828013000_phase_g_finance_composite_tenant_fk.sql", import.meta.url),
  "utf8",
);
const reception = readFileSync(
  new URL("../lib/webos/reception.ts", import.meta.url),
  "utf8",
);

test("Phase G provisioning is setup-first and activation requires verified readiness evidence", () => {
  assert.match(provisioning, /values\(v_org_id,v_clinic_slug,v_clinic_name,v_timezone,'setup'\)/);
  assert.match(provisioning, /required_keys text\[\]:=array\['tenantIsolation','schemaReady','ownerMembership','configurationReady','bookingReady','financeReady','noRelifeFallback','rollbackReady','coreOperationalSmoke'\]/);
  assert.match(provisioning, /clinic_provisioning_evidence[\s\S]*status='verified'/);
  assert.match(provisioning, /CLINIC_ACTIVATION_BLOCKED/);
});

test("Phase G provisioning and activation are service-role-only authorities", () => {
  for (const signature of [
    "relife.provision_clinic_v1(jsonb)",
    "relife.record_clinic_readiness_v1(uuid,uuid,text,jsonb,text)",
    "relife.activate_clinic_v1(uuid,uuid,text)",
  ]) {
    assert.match(provisioning, new RegExp(`revoke all on function ${signature.replace(/[()]/g, "\\$&")} from public,anon,authenticated`));
    assert.match(provisioning, new RegExp(`grant execute on function ${signature.replace(/[()]/g, "\\$&")} to service_role`));
  }
});

test("finance operations enforce the same composite organization + clinic tenant boundary", () => {
  assert.match(financeTenantFk, /foreign key \(organization_id, clinic_id\)/i);
  assert.match(financeTenantFk, /references relife\.clinics \(organization_id, id\)/i);
  assert.match(financeTenantFk, /validate constraint finance_operations_tenant_fk/i);
});

test("legacy Relife compatibility is explicitly bounded; other tenants are exact-match only", () => {
  assert.match(reception, /patient\.organizationId === tenant\.organizationId[\s\S]*patient\.clinicId === tenant\.clinicId/);
  assert.match(reception, /every other tenant remains[\s\S]*exact-match only/i);
  assert.match(reception, /tenant\.organizationSlug\?\.toLowerCase\(\) !== "relife"/);
  assert.match(reception, /tenant\.clinicSlug\?\.toLowerCase\(\) !== "amtali-main"/);
});
