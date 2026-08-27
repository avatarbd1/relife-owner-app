import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Phase D staff mutations retain the Sheets writer and synchronize tenant provisioning", () => {
  const staff = source("lib/webos/staffManagement.ts");
  assert.match(staff, /batchUpdateSpreadsheet\("physio", requests\)/);
  assert.match(staff, /replaceStoredStaffProvisioning\(\{ organizationId, clinicId \}/);
  assert.match(staff, /deactivateStoredStaffProvisioning\(\{ organizationId, clinicId \}, staffId\)/);
  assert.match(staff, /provisionedIds\.has\(item\.staffId\)/);
});

test("Phase D staff provisioning queries and writes exact organization plus clinic scope", () => {
  const store = source("lib/data/staffProvisioning.ts");
  assert.match(store, /\.eq\("organization_id", tenant\.organizationId\)[\s\S]*?\.eq\("clinic_id", tenant\.clinicId\)/);
  assert.match(store, /organization_id: tenant\.organizationId[\s\S]*?clinic_id: tenant\.clinicId/);
  assert.match(store, /onConflict: "staff_id,organization_id,clinic_id"/);
  assert.match(store, /await deactivate\(\)/);
});

test("staff routes require core staff independently from membership and permission", () => {
  for (const path of ["app/api/staff/route.ts", "app/api/staff/[staffId]/route.ts", "app/api/staff/[staffId]/deactivate/route.ts"]) {
    assert.match(source(path), /requireTenantFeature\(tenantContext\.tenant, "core\.staff"\)/);
  }
});

test("finance mutation routes enforce the configured module server-side", () => {
  for (const path of ["app/api/finance/payment/route.ts", "app/api/finance/expense/request/route.ts", "app/api/finance/expense/pay/route.ts"]) {
    assert.match(source(path), /requireTenantFeature\(tenant, "core\.finance_basic"\)/);
  }
  assert.match(source("app/api/finance/salary/route.ts"), /requireTenantFeature\(tenant, "optional\.salary"\)/);
  for (const path of ["app/api/finance/cash/request/route.ts", "app/api/finance/cash/accept/route.ts"]) {
    assert.match(source(path), /requireTenantFeature\(tenant, "optional\.finance_advanced"\)/);
  }
});

test("feature denial maps to 403 and never reaches a finance writer", () => {
  for (const path of ["app/api/finance/payment/route.ts", "app/api/finance/expense/request/route.ts", "app/api/finance/expense/pay/route.ts", "app/api/finance/salary/route.ts", "app/api/finance/cash/request/route.ts", "app/api/finance/cash/accept/route.ts"]) {
    const route = source(path);
    assert.match(route, /FEATURE_ACCESS_DENIED:/);
    assert.ok(route.indexOf("requireTenantFeature") < route.indexOf("const body = await request.json"));
  }
});

test("direct finance pages also fail closed on disabled modules", () => {
  for (const path of ["app/(dashboard)/payments/page.tsx", "app/(dashboard)/finance/page.tsx", "app/(dashboard)/finance/operations/page.tsx"]) {
    assert.match(source(path), /requireTenantFeature\(tenantContext\.tenant, "core\.finance_basic"\)/);
  }
  assert.match(source("app/(dashboard)/salary/page.tsx"), /requireTenantFeature\(tenantContext\.tenant, "optional\.salary"\)/);
});
