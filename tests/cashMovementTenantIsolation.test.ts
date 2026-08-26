import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("parseCashMovements has fail-closed implementation for missing tenant columns", () => {
  const dataModule = source("lib/data/index.ts");
  // Verify the function returns [] if Organization_ID or Clinic_ID columns are missing
  assert.match(dataModule, /if \(orgIdIdx < 0 \|\| clinicIdIdx < 0\) return \[\];/);
});

test("parseCashMovements has fail-closed implementation for blank tenant values", () => {
  const dataModule = source("lib/data/index.ts");
  // Verify rows with blank tenant values are excluded
  assert.match(dataModule, /if \(!recordOrgId \|\| !recordClinicId\) return \[\];/);
});

test("parseCashMovements enforces exact org+clinic matching", () => {
  const dataModule = source("lib/data/index.ts");
  // Verify mismatch is rejected
  assert.match(dataModule, /recordOrgId !== organizationId \|\| recordClinicId !== clinicId/);
});

test("getCashMovements requires explicit organizationId and clinicId parameters", () => {
  const dataModule = source("lib/data/index.ts");
  // Verify the function signature has required (non-optional) org+clinic params
  assert.match(dataModule, /getCashMovements\(organizationId: string, clinicId: string\)/);
  // Extract just the getCashMovements function body
  const getCashMovementsMatch = dataModule.match(/export async function getCashMovements[\s\S]*?^}/m);
  assert.ok(getCashMovementsMatch, "getCashMovements function exists");
  const getCashMovementsBody = getCashMovementsMatch[0];
  // Verify it doesn't have default assignments
  assert.doesNotMatch(getCashMovementsBody, /organizationId \|\|/);
  assert.doesNotMatch(getCashMovementsBody, /clinicId \|\|/);
});

test("getCashMovementsForAdminView provides legacy compatibility with defaults", () => {
  const dataModule = source("lib/data/index.ts");
  // Verify the compatibility helper exists
  assert.match(dataModule, /export async function getCashMovementsForAdminView/);
  // Verify it calls the strict version with explicit org+clinic
  assert.match(dataModule, /return getCashMovements\("RELIFE", "RELIFE-PHYSIO"\)/);
});

test("getScopedCashPosition requires explicit organizationId and clinicId parameters", () => {
  const scopedCash = source("lib/scopedCash.ts");
  // Verify the function signature has required (non-optional) org+clinic params
  assert.match(scopedCash, /organizationId: string,\s+clinicId: string/);
  // Verify there's no default assignment
  assert.doesNotMatch(scopedCash, /const org = organizationId \|\|/);
  assert.doesNotMatch(scopedCash, /const clinic = clinicId \|\|/);
});

test("getScopedCashPositionForAdminView provides legacy compatibility", () => {
  const scopedCash = source("lib/scopedCash.ts");
  // Verify the compatibility helper exists
  assert.match(scopedCash, /export async function getScopedCashPositionForAdminView/);
  // Verify it calls the strict version with explicit org+clinic
  assert.match(scopedCash, /return getScopedCashPosition\(scope, now, "RELIFE"/);
});

test("tenant-aware finance routes (accept/request) pass explicit org+clinic", () => {
  const acceptRoute = source("app/api/finance/cash/accept/route.ts");
  const requestRoute = source("app/api/finance/cash/request/route.ts");

  // Verify accept route passes explicit org+clinic
  assert.match(acceptRoute, /getScopedCashPosition\(scope, new Date\(\), tenant\.organizationId, tenant\.clinicId\)/);

  // Verify request route passes explicit org+clinic
  assert.match(requestRoute, /getScopedCashPosition\(/);
  assert.match(requestRoute, /tenant\.organizationId,\s+tenant\.clinicId/);
});

test("dashboard pages use admin-level compatibility helpers, not strict versions", () => {
  const homePage = source("app/(dashboard)/home/page.tsx");
  const financePage = source("app/(dashboard)/finance/page.tsx");

  // Home page should use the admin compatibility helper
  assert.match(homePage, /getScopedCashPositionForAdminView\("combined", now\)/);

  // Finance page should use the admin compatibility helper
  assert.match(financePage, /getScopedCashPositionForAdminView\(scope, now\)/);
});

test("admin utilities use compatibility helpers for legacy access patterns", () => {
  const calculations = source("lib/calculations.ts");
  const ledgers = source("lib/webos/financeLedgers.ts");
  const history = source("lib/webos/financeHistory.ts");

  // Calculations should use the admin compatibility helpers
  assert.match(calculations, /getScopedCashPositionForAdminView\("combined", now\)/);
  assert.match(calculations, /getCashMovementsForAdminView\(\)/);

  // Ledgers should use the admin compatibility helper
  assert.match(ledgers, /getCashMovementsForAdminView\(\)/);

  // History should use the admin compatibility helper
  assert.match(history, /getCashMovementsForAdminView\(\)/);
});
