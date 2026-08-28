import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const tenantDirectory = source("lib/webos/tenantStaffDirectory.ts");
const staffDirectory = source("lib/webos/staffDirectory.ts");

test("tenant staff identity resolves from canonical membership, not a fixed sheet", () => {
  assert.match(tenantDirectory, /from\("staff_tenant_bindings"\)/);
  assert.match(tenantDirectory, /staff_tenant_roles\(role_code\)/);
  assert.match(tenantDirectory, /staff_tenant_departments\(department_id\)/);
  assert.match(tenantDirectory, /\.eq\("status", "active"\)/);
  assert.match(tenantDirectory, /\.eq\("is_default", true\)/);
  // No fixed clinic identity may leak into the tenant-backed identity source.
  assert.doesNotMatch(tenantDirectory, /RELIFE-PHYSIO|RELIFE-DENTAL|amtali-main|"RELIFE"/);
});

test("tenant-backed identities inherit no Relife-specific policy exception", () => {
  assert.match(tenantDirectory, /clinicalWriteScope: ""/);
  assert.match(tenantDirectory, /financialAccess: ""/);
});

test("an identity without a role or department is rejected, not widened", () => {
  assert.match(tenantDirectory, /if \(roles\.length === 0 \|\| !primaryDepartment\) return null;/);
  // "All" is an explicit grant and must not be silently narrowed.
  assert.match(tenantDirectory, /departments\.includes\("All"\)\) return "All"/);
});

test("Sheets stays authoritative and the tenant fallback fails soft to not-found", () => {
  assert.match(staffDirectory, /if \(fromSheets\) return fromSheets;/);
  assert.match(staffDirectory, /getTenantStaffIdentity/);
  assert.match(
    staffDirectory,
    /catch \(error\) \{[\s\S]*Tenant staff identity lookup failed[\s\S]*return null;/
  );
});
