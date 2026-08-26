import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Supabase tenant foundation carries organization and clinic scope", () => {
  const migration = source(
    "supabase/migrations/20260816155917_tenant_ready_foundation.sql"
  );

  assert.match(migration, /create table if not exists relife\.organizations/);
  assert.match(migration, /create table if not exists relife\.clinics/);
  assert.match(migration, /create table if not exists relife\.clinic_memberships/);
  assert.match(migration, /add column if not exists organization_id uuid/);
  assert.match(migration, /add column if not exists clinic_id uuid/);
  assert.match(migration, /foreign key \(organization_id, clinic_id\)/);
  assert.match(migration, /enable row level security/);
  assert.doesNotMatch(migration, /grant .*authenticated/i);
});

test("Tenant activation follows the first-20 contract and stays separate from legacy ledger identity", () => {
  const contract = source("TENANCY.md");
  assert.match(contract, /one shared multi-tenant codebase prepared for the first 20 production Physio clinics/i);
  assert.match(contract, /RELIFE-PHYSIO/);
  assert.match(contract, /legacy Sheets ledger\/department identities/i);
  assert.match(contract, /not universal Supabase tenant primary keys/i);
  assert.match(contract, /Every tenant-owned runtime read\/write must use explicit `organization_id` and `clinic_id`/i);
  assert.match(contract, /Required before Clinic #2 is activated/i);
  assert.match(contract, /cross-tenant tests/i);
  assert.match(contract, /T4 -> onboarding\/readiness hardening -> T5 -> generic provisioning -> Clinic #2 real isolation/i);
});

test("Supabase advisor security remediation is tracked", () => {
  const security = source(
    "supabase/migrations/20260816160001_secure_rls_auto_enable_function.sql"
  );
  const indexes = source(
    "supabase/migrations/20260816160024_index_tenant_foreign_keys.sql"
  );

  assert.match(security, /revoke all on function public\.rls_auto_enable\(\)/);
  assert.match(indexes, /\(organization_id, clinic_id\)/);
});
