import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = source(
  "supabase/migrations/20260824043000_relife_tenant1_staff_bridge.sql"
);
const edge = source("supabase/functions/relife-tenant-context/index.ts");
const adapter = source("lib/domain/tenancy/staffTenantContext.ts");
const currentUser = source("lib/webos/currentUser.ts");
const tenantStaffDirectory = source("lib/webos/tenantStaffDirectory.ts");
const auth = source("lib/auth.ts");

test("Relife Tenant #1 bridge preserves the existing ST001 staff identity", () => {
  assert.match(migration, /create table if not exists relife\.staff_tenant_bindings/);
  assert.match(migration, /staff_id text not null/);
  assert.match(migration, /auth_user_id uuid null references auth\.users/);
  assert.match(migration, /'ST001'/);
  assert.match(migration, /o\.slug = 'relife'/);
  assert.match(migration, /c\.slug = 'amtali-main'/);
  assert.match(migration, /RELIFE_TENANT1_OWNER_BINDING_FAILED/);

  assert.doesNotMatch(migration, /insert\s+into\s+auth\.users/i);
  assert.doesNotMatch(
    migration,
    /3222b282-bc98-4721-9db1-196cd6d94647|bc77ffb9-3379-40cc-a1eb-89b0e988fe94/i
  );
});

test("staff session has exactly one active default tenant before implicit resolution", () => {
  assert.match(migration, /staff_tenant_bindings_one_active_default_idx/);
  assert.match(migration, /status = 'active' and is_default = true/);
  assert.match(migration, /enable row level security/);
  assert.match(
    migration,
    /revoke all on table relife\.staff_tenant_bindings from public, anon, authenticated/
  );
});

test("tenant context Edge resolver is server-authenticated and fails closed", () => {
  assert.match(edge, /x-relife-lock-key/);
  assert.match(edge, /SERVER_KEY_HASHES/);
  assert.match(edge, /from relife\.staff_tenant_bindings/);
  assert.match(edge, /b\.status = 'active'/);
  assert.match(edge, /o\.status = 'active'/);
  assert.match(edge, /c\.status = 'active'/);
  assert.match(edge, /defaults\.length !== 1/);
  assert.match(edge, /TENANT_BINDING_NOT_FOUND/);
  assert.match(edge, /TENANT_BINDING_AMBIGUOUS/);
  assert.doesNotMatch(edge, /where\s+o\.slug\s*=\s*'relife'/i);
});

test("server adapter never silently falls back to Relife tenant IDs", () => {
  assert.match(adapter, /requireTenantScope/);
  assert.match(adapter, /TENANT_CONTEXT_STAFF_MISMATCH/);
  assert.match(adapter, /TENANT_CONTEXT_INCOMPLETE/);
  assert.match(adapter, /RELIFE_TENANT_CONTEXT_SECRET/);
  assert.match(adapter, /RELIFE_MUTATION_LOCK_SECRET/);
  assert.doesNotMatch(adapter, /3222b282-bc98-4721-9db1-196cd6d94647/i);
  assert.doesNotMatch(adapter, /bc77ffb9-3379-40cc-a1eb-89b0e988fe94/i);
});

test("Relife staff authorization is canonical-only and fails closed without Supabase role/department children", () => {
  assert.match(currentUser, /isPlatformOwner\(staffId\)[\s\S]*?return null/);
  assert.match(currentUser, /resolveStaffTenantContext\(staffId, await currentTenantSelection\(\)\)/);
  assert.match(currentUser, /if \(message === "TENANT_BINDING_NOT_FOUND"\) return null/);
  assert.match(currentUser, /getTenantScopedWebStaffIdentity\(staffId, tenant\)/);
  assert.doesNotMatch(currentUser, /identity\.roles\.includes\("Owner"\)/);
  assert.doesNotMatch(currentUser, /isRelifeLegacyTenant|scopeIdentityToClinic/);
  assert.doesNotMatch(currentUser, /organizationSlug\s*:\s*["']relife["']/);
  assert.doesNotMatch(currentUser, /clinicSlug\s*:\s*["']amtali-main["']/);

  assert.match(tenantStaffDirectory, /listStoredStaffProvisioning\(tenant\)/);
  assert.match(tenantStaffDirectory, /row\.staffId === staffId && row\.status === "active"/);
  assert.match(tenantStaffDirectory, /if \(!binding\) return null/);
  assert.match(tenantStaffDirectory, /if \(!hasTenantRoles \|\| !hasTenantDepartments\) return null/);
  assert.match(tenantStaffDirectory, /clinicRuntimeDepartments/);
  assert.match(tenantStaffDirectory, /departmentAccess: \[department\]/);
  assert.doesNotMatch(tenantStaffDirectory, /getActiveWebStaffById|legacyIdentity|return legacy|isRelifeLegacyTenant/);

  assert.match(auth, /export const DEFAULT_OWNER_STAFF_ID = "ST001"/);
  assert.match(auth, /createSessionToken\(staffId: string = DEFAULT_OWNER_STAFF_ID\)/);
  assert.match(auth, /staffId: DEFAULT_OWNER_STAFF_ID/);
  assert.doesNotMatch(auth, /supabase\.auth|signInWithPassword|signInWithOtp/i);
});
