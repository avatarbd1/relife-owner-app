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

test("Tenant activation remains explicit and separate from ledger identity", () => {
  const contract = source("TENANCY.md");
  assert.match(contract, /multi-clinic access is intentionally \*\*not activated\*\*/);
  assert.match(contract, /RELIFE-PHYSIO/);
  assert.match(contract, /not Supabase tenant primary keys/);
  assert.match(contract, /Pass `organization_id` and `clinic_id` explicitly/);
  assert.match(contract, /cross-tenant isolation tests/);
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
