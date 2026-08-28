import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("commercial decisions use the canonical tenant configuration engine", () => {
  const guard = source("lib/domain/tenancy/featureGuard.ts");

  assert.match(guard, /readClinicConfiguration\(scope\)/);
  assert.match(guard, /featureDecision\(/);
  assert.match(guard, /export async function hasTenantFeature/);
  assert.match(guard, /export async function requireTenantFeature/);
});

test("Live Chamber hiding is backed by page and API enforcement", () => {
  const dashboard = source("app/(dashboard)/layout.tsx");
  const chamberLayout = source("app/(dashboard)/chamber/layout.tsx");

  assert.match(dashboard, /hasTenantFeature\(tenant, "optional\.live_chamber"\)/);
  assert.match(chamberLayout, /requireTenantFeature\(tenant, "optional\.live_chamber"\)/);

  for (const path of [
    "app/api/chamber/route.ts",
    "app/api/chamber/comms/route.ts",
    "app/api/chamber/context-chat/route.ts",
    "app/api/chamber/machines/route.ts",
  ]) {
    assert.match(source(path), /requireTenantFeature\(tenant, "optional\.live_chamber"\)/, path);
  }
});

test("Gamification hiding is backed by page, API, and projection enforcement", () => {
  const more = source("app/(dashboard)/more/page.tsx");
  const performanceLayout = source("app/(dashboard)/performance/layout.tsx");
  const projections = source("lib/domain/gamification/events.ts");

  assert.match(more, /enabled\("optional\.gamification"\)/);
  assert.match(performanceLayout, /requireTenantFeature\(tenant, "optional\.gamification"\)/);
  assert.match(projections, /hasTenantFeature\(tenant, "optional\.gamification"\)/);
  assert.ok(
    projections.indexOf("projectionAvailable(input.tenant") <
      projections.indexOf("recordVerifiedGamificationEvent(input.tenant"),
    "the domain projection must deny a disabled feature before calling the writer"
  );

  for (const path of [
    "app/api/v1/gamification/claims/route.ts",
    "app/api/v1/gamification/claims/[claimId]/actions/route.ts",
    "app/api/v1/gamification/weekly/finalize/route.ts",
    "app/api/v1/gamification/monthly/finalize/route.ts",
  ]) {
    assert.match(source(path), /requireTenantFeature\([^,]+, "optional\.gamification"\)/, path);
  }
});

test("Advanced Finance hiding is backed by page and mutation enforcement", () => {
  const finance = source("app/(dashboard)/finance/page.tsx");
  const salaryLayout = source("app/(dashboard)/salary/layout.tsx");

  assert.match(finance, /hasTenantFeature\([\s\S]*?"optional\.finance_advanced"/);
  assert.match(salaryLayout, /requireTenantFeature\(tenant, "optional\.finance_advanced"\)/);
  assert.match(salaryLayout, /requireTenantFeature\(tenant, "optional\.salary"\)/);

  for (const path of [
    "app/api/control/cash-movement/route.ts",
    "app/api/control/expense/route.ts",
    "app/api/finance/cash/accept/route.ts",
    "app/api/finance/cash/request/route.ts",
    "app/api/finance/salary/route.ts",
  ]) {
    assert.match(source(path), /requireTenantFeature\([^,]+, "optional\.finance_advanced"\)/, path);
  }
});

test("commercial adapters require explicit tenant identity and contain no Relife fallback", () => {
  for (const path of [
    "lib/data/supabaseGamification.ts",
    "lib/data/supabaseRewardClaims.ts",
    "lib/data/supabaseWeeklyGamification.ts",
    "lib/webos/cashAcceptance.ts",
  ]) {
    const contents = source(path);
    assert.match(contents, /organizationId/);
    assert.match(contents, /clinicId/);
    assert.doesNotMatch(contents, /RELIFE_SUPABASE_SCOPE\.(organizationSlug|clinicSlug)/, path);
    assert.doesNotMatch(contents, /RELIFE_SYSTEM\.(organizationId|branchId)/, path);
    assert.doesNotMatch(contents, /["']amtali-main["']/, path);
  }
});

test("Performance and clinical projections propagate the selected tenant", () => {
  const performancePage = source("app/(dashboard)/performance/page.tsx");
  const performance = source("lib/webos/performance.ts");

  assert.match(performancePage, /requireCurrentTenantAccessContext\(\)/);
  assert.match(performancePage, /getPerformanceSnapshot\(context, tenant\)/);
  assert.match(performance, /getGamificationConfig\(tenant, department\)/);

  for (const path of ["lib/webos/clinical.ts", "lib/webos/chamberClinicalNote.ts"]) {
    assert.match(
      source(path),
      /recordTreatmentDocumentationGamification\(\{[\s\S]*?tenant: \{ organizationId, clinicId \}/,
      path
    );
  }
});
