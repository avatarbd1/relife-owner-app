import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const bridge = source("supabase/migrations/20260824043000_relife_tenant1_staff_bridge.sql");
const correction = source("supabase/migrations/20260828073000_staff_default_tenant_invariant.sql");
const clinicReadGrant = source("supabase/migrations/20260828082700_canonical_enrollment_clinic_read_grant.sql");
const identityRpc = source("supabase/migrations/20260828085100_canonical_staff_identity_rpc.sql");
const dataApiSchema = source("supabase/migrations/20260828094000_expose_relife_data_api_schema.sql");
const phaseH = source("supabase/migrations/20260828020000_phase_h_repeatable_provisioning.sql");
const platformControl = source("supabase/functions/relife-platform-control/index.ts");
const tenantContext = source("supabase/functions/relife-tenant-context/index.ts");

test("implicit tenant resolution has one explicit default-binding invariant", () => {
  assert.match(bridge, /Exactly one active default tenant binding is required/i);
  assert.match(bridge, /staff_tenant_bindings_one_active_default_idx/);
  assert.match(tenantContext, /const defaults = rows\.filter\(\(row\) => row\.is_default === true\)/);
  assert.match(tenantContext, /defaults\.length !== 1/);
});

test("first or single active binding is promoted at the table boundary", () => {
  assert.match(correction, /create or replace function relife\.enforce_staff_default_tenant_binding\(\)/i);
  assert.match(
    correction,
    /before insert or update of status, is_default, staff_id\s+on relife\.staff_tenant_bindings/i,
  );
  assert.match(correction, /existing\.staff_id = new\.staff_id/);
  assert.match(correction, /existing\.status = 'active'/);
  assert.match(correction, /existing\.is_default = true/);
  assert.match(correction, /new\.is_default := true/);
  assert.match(correction, /revoke all on function relife\.enforce_staff_default_tenant_binding\(\)/i);
});

test("existing repair is bounded to exactly one active binding with no default", () => {
  assert.match(correction, /single_active_without_default/);
  assert.match(correction, /having count\(\*\) = 1/);
  assert.match(correction, /count\(\*\) filter \(where is_default = true\) = 0/);
  assert.match(correction, /STAFF_SINGLE_TENANT_DEFAULT_REPAIR_FAILED/);
  assert.doesNotMatch(correction, /Happy Physiotherapy|HPP-PT-001|541de1ce|bb4202f4/i);
});

test("canonical owner writers remain behind the shared binding invariant", () => {
  assert.match(phaseH, /insert into relife\.staff_tenant_bindings/);
  assert.match(platformControl, /insert into relife\.staff_tenant_bindings/);
  assert.match(platformControl, /action === "owner"/);
  assert.doesNotMatch(correction, /insert\s+into\s+auth\.users/i);
  assert.doesNotMatch(correction, /organizationSlug\s*=\s*'relife'|clinicSlug\s*=\s*'amtali-main'/i);
});

test("canonical enrollment can read clinic status without exposing the catalogue to browser roles", () => {
  assert.match(clinicReadGrant, /grant select on table relife\.clinics to service_role/i);
  assert.match(clinicReadGrant, /revoke all on table relife\.clinics from anon, authenticated/i);
  assert.doesNotMatch(clinicReadGrant, /grant\s+select[^;]+to\s+(anon|authenticated)/i);
});

test("canonical identity RPC is server-only, invoker-secured, and fails closed", () => {
  assert.match(identityRpc, /security invoker/i);
  assert.doesNotMatch(identityRpc, /security definer/i);
  assert.match(identityRpc, /having count\(\*\) = 1/i);
  assert.match(identityRpc, /revoke all on function[\s\S]+?from public, anon, authenticated/i);
  assert.match(identityRpc, /grant execute on function[\s\S]+?to service_role/i);
  assert.doesNotMatch(identityRpc, /grant execute[^;]+to (anon|authenticated)/i);
});

test("canonical relife readers have an explicit PostgREST schema contract", () => {
  assert.match(dataApiSchema, /pgrst\.db_schemas\s*=\s*'public, storage, graphql_public, relife'/i);
  assert.match(dataApiSchema, /notify pgrst, 'reload config'/i);
  assert.match(dataApiSchema, /notify pgrst, 'reload schema'/i);
  assert.doesNotMatch(dataApiSchema, /grant\s+all/i);
});
