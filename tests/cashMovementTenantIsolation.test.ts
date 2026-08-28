import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("parseCashMovements has fail-closed implementation for missing tenant columns", () => {
  const dataModule = source("lib/data/index.ts");
  assert.match(dataModule, /if \(orgIdIdx < 0 \|\| clinicIdIdx < 0\) return \[\];/);
});

test("parseCashMovements has fail-closed implementation for blank tenant values", () => {
  const dataModule = source("lib/data/index.ts");
  assert.match(dataModule, /if \(!recordOrgId \|\| !recordClinicId\) return \[\];/);
});

test("parseCashMovements enforces exact org+clinic matching", () => {
  const dataModule = source("lib/data/index.ts");
  assert.match(dataModule, /recordOrgId !== organizationId \|\| recordClinicId !== clinicId/);
});

test("getCashMovements requires explicit organizationId and clinicId parameters", () => {
  const dataModule = source("lib/data/index.ts");
  assert.match(dataModule, /getCashMovements\(organizationId: string, clinicId: string\)/);
  const getCashMovementsMatch = dataModule.match(/export async function getCashMovements[\s\S]*?^}/m);
  assert.ok(getCashMovementsMatch, "getCashMovements function exists");
  const getCashMovementsBody = getCashMovementsMatch[0];
  assert.doesNotMatch(getCashMovementsBody, /organizationId \|\|/);
  assert.doesNotMatch(getCashMovementsBody, /clinicId \|\|/);
});

test("getCashMovementsForAdminView provides legacy compatibility with defaults", () => {
  const dataModule = source("lib/data/index.ts");
  assert.match(dataModule, /export async function getCashMovementsForAdminView/);
  assert.match(dataModule, /return getCashMovements\("RELIFE", "RELIFE-PHYSIO"\)/);
});

test("getScopedCashPosition requires explicit organizationId and clinicId parameters", () => {
  const scopedCash = source("lib/scopedCash.ts");
  assert.match(scopedCash, /organizationId: string,\s+clinicId: string/);
  assert.doesNotMatch(scopedCash, /const org = organizationId \|\|/);
  assert.doesNotMatch(scopedCash, /const clinic = clinicId \|\|/);
});

test("dashboard cash compatibility resolves authenticated canonical tenant before legacy ledger mapping", () => {
  const scopedCash = source("lib/scopedCash.ts");
  const adminMatch = scopedCash.match(/export async function getScopedCashPositionForAdminView[\s\S]*?^}/m);
  assert.ok(adminMatch, "authenticated dashboard cash helper exists");
  assert.match(adminMatch[0], /await requireCurrentTenantContext\(\)/);
  assert.match(adminMatch[0], /tenant\.organizationId/);
  assert.match(adminMatch[0], /tenant\.clinicId/);
  assert.doesNotMatch(adminMatch[0], /"RELIFE"|"RELIFE-PHYSIO"|"RELIFE-DENTAL"/);
});

test("Tenant #1 cash bridge is explicit and combined scope aggregates both legacy department ledgers", () => {
  const scopedCash = source("lib/scopedCash.ts");
  assert.match(scopedCash, /RELIFE_CANONICAL_ORGANIZATION = "relife"/);
  assert.match(scopedCash, /RELIFE_CANONICAL_CLINIC = "amtali-main"/);
  assert.match(scopedCash, /getScopedCashPosition\("physio", now, "RELIFE", "RELIFE-PHYSIO"\)/);
  assert.match(scopedCash, /getScopedCashPosition\("dental", now, "RELIFE", "RELIFE-DENTAL"\)/);
  assert.match(scopedCash, /return addPositions\(physio, dental\)/);
});

test("tenant-aware finance routes (accept/request) pass explicit org+clinic", () => {
  const acceptRoute = source("app/api/finance/cash/accept/route.ts");
  const requestRoute = source("app/api/finance/cash/request/route.ts");
  assert.match(acceptRoute, /getScopedCashPosition\(scope, new Date\(\), tenant\.organizationId, tenant\.clinicId\)/);
  assert.match(requestRoute, /getScopedCashPosition\(/);
  assert.match(requestRoute, /tenant\.organizationId,\s+tenant\.clinicId/);
});

test("dashboard pages use the authenticated dashboard cash boundary", () => {
  const homePage = source("app/(dashboard)/home/page.tsx");
  const financePage = source("app/(dashboard)/finance/page.tsx");
  assert.match(homePage, /getScopedCashPositionForAdminView\(runtimeScope, now\)/);
  assert.match(financePage, /getScopedCashPositionForAdminView\(scope, now\)/);
});

test("finance history resolves the active tenant and never falls back to Relife legacy rows for another clinic", () => {
  const ledgers = source("lib/webos/financeLedgers.ts");
  const ledgerPage = source("components/FinanceLedgerPage.tsx");
  const recordsPage = source("app/(dashboard)/finance/records/page.tsx");

  assert.match(ledgers, /isRelifeLegacyTenant\(tenant\)/);
  assert.match(ledgers, /getPayments\(tenant\.organizationId, tenant\.clinicId\)/);
  assert.match(ledgers, /getExpenses\(tenant\.organizationId, tenant\.clinicId\)/);
  assert.match(ledgers, /getCashMovements\(tenant\.organizationId, tenant\.clinicId\)/);
  assert.match(ledgers, /getSalaryPayments\(tenant\.organizationId, tenant\.clinicId\)/);

  for (const page of [ledgerPage, recordsPage]) {
    assert.match(page, /requireCurrentTenantAccessContext\(\)/);
    assert.match(page, /getFinanceLedgerSnapshot\(context, scope, tenantContext\.tenant\)/);
    assert.doesNotMatch(page, /requireCurrentAccessContext\(\)/);
  }
});

test("admin utilities use compatibility helpers for legacy access patterns", () => {
  const calculations = source("lib/calculations.ts");
  const ledgers = source("lib/webos/financeLedgers.ts");
  const history = source("lib/webos/financeHistory.ts");
  assert.match(calculations, /getScopedCashPositionForAdminView\("combined", now\)/);
  assert.match(calculations, /getCashMovementsForAdminView\(\)/);
  assert.match(ledgers, /getCashMovementsForAdminView\(\)/);
  assert.match(history, /getCashMovementsForAdminView\(\)/);
});
