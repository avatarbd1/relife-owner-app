import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clinicRuntimeDepartments,
  clinicRuntimeScopes,
} from "../lib/domain/tenancy/clinicRuntime.ts";
import type { AccessContext } from "../lib/webos/access.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const owner: AccessContext = {
  staffId: "HPP-PT-001",
  roles: ["Owner"],
  primaryDepartment: "All",
  departmentAccess: ["All"],
};

test("physiotherapy clinic type exposes only Physio even when its owner has clinic-wide All access", () => {
  const departments = clinicRuntimeDepartments("physiotherapy");
  assert.deepEqual(departments, ["Physio"]);
  assert.deepEqual(clinicRuntimeScopes(owner, departments), ["physio"]);
});

test("non-Relife finance never calls unscoped legacy aggregate readers", () => {
  const finance = source("app/(dashboard)/finance/page.tsx");
  assert.match(finance, /legacyRelife \? getMonthBusinessPosition/);
  assert.match(finance, /getTodaysCollection\(now, tenantContext\.tenant\.organizationId, tenantContext\.tenant\.clinicId\)/);
  assert.match(finance, /legacyRelife \? getOwnerControlSnapshot\(\) : Promise\.resolve\(emptyControls\)/);
});

test("Physio-only patient and staff UIs receive clinic-configured departments", () => {
  assert.match(source("app/(dashboard)/patients/page.tsx"), /availableDepartments=\{clinicDepartments\}/);
  assert.match(source("app/(dashboard)/security/staff-access/page.tsx"), /availableDepartments=\{clinicDepartments\}/);
  assert.match(source("components/StaffManagementClient.tsx"), /!availableDepartments\.includes\("Dental"\)/);
});

test("staff mutation API enforces the configured clinic type server-side", () => {
  const management = source("lib/webos/staffManagement.ts");
  assert.match(management, /enforceClinicStaffDepartment\(tenant, normalizedInput\)/);
  assert.match(management, /STAFF_DEPARTMENT_OUTSIDE_CLINIC_TYPE/);
  assert.match(management, /STAFF_ROLE_OUTSIDE_CLINIC_TYPE/);
  assert.match(source("app\/api\/staff\/route.ts"), /tenantContext\.tenant,\s*body as StaffMutationInput/);
});

test("tenant staff access is canonically resolved and clamped to clinic type before permission checks", () => {
  const currentUser = source("lib/webos/currentUser.ts");
  const tenantDirectory = source("lib/webos/tenantStaffDirectory.ts");
  assert.match(tenantDirectory, /clinicRuntimeDepartments/);
  assert.match(tenantDirectory, /clampIdentityToClinic/);
  assert.match(tenantDirectory, /departmentAccess: \[department\]/);
  assert.doesNotMatch(tenantDirectory, /isRelifeLegacyTenant/);
  assert.doesNotMatch(currentUser, /isRelifeLegacyTenant/);
  assert.doesNotMatch(currentUser, /scopeIdentityToClinic/);
});

test("tenant staff authorization never falls back to legacy Relife Sheets identity", () => {
  const tenantDirectory = source("lib/webos/tenantStaffDirectory.ts");
  assert.doesNotMatch(tenantDirectory, /getActiveWebStaffById|legacyIdentity|return legacy/);
  assert.match(tenantDirectory, /if \(!hasTenantRoles \|\| !hasTenantDepartments\) return null/);
  assert.match(tenantDirectory, /fullName: staffId/);
});

test("non-Relife dashboards cannot consume unscoped Relife report or staff data", () => {
  const reports = source("app/(dashboard)/reports/page.tsx");
  assert.match(reports, /getVisiblePatients\(context, scope, tenantContext\.tenant\.organizationId, tenantContext\.tenant\.clinicId\)/);
  assert.match(reports, /getPayments\(tenantContext\.tenant\.organizationId, tenantContext\.tenant\.clinicId\)/);
  assert.match(reports, /legacyRelife \? getMonthBusinessPosition/);
  assert.match(reports, /legacyRelife \? getSalaryStatus/);
  assert.match(reports, /canReadFinancial && legacyRelife && <RangeReports/);

  for (const path of [
    "app/(dashboard)/security/page.tsx",
    "app/(dashboard)/workforce/page.tsx",
    "app/(dashboard)/patients/[patientId]/page.tsx",
    "app/(dashboard)/performance/claims/page.tsx",
    "app/(dashboard)/chamber/page.tsx",
  ]) {
    const page = source(path);
    assert.doesNotMatch(page, /getWebStaffDirectory\(/, path);
    assert.match(page, /listTenantScopedWebStaffDirectory\(/, path);
  }
});

test("legacy-only reports, approvals, salary, daily and exports fail closed outside Relife", () => {
  assert.match(source("app/(dashboard)/reports/rangeReportsActions.ts"), /LEGACY_REPORTS_NOT_AVAILABLE/);
  assert.match(source("app/(dashboard)/finance/approvals/page.tsx"), /isRelifeLegacyTenant\(tenantContext\.tenant\)/);
  assert.match(source("app/(dashboard)/salary/page.tsx"), /legacyRelife[\s\S]*\? await Promise\.all\(\[getStaff\(\), getSalaryPayments\(\)\]\)[\s\S]*: \[\[\], \[\]\]/);
  assert.match(source("app/(dashboard)/daily/page.tsx"), /legacyRelife \? getDailyClinicalActivity/);
  assert.match(source("app/api/export/csv/route.ts"), /const rows = legacyRelife/);
  assert.match(source("app/(dashboard)/tools/layout.tsx"), /!isRelifeLegacyTenant\(tenantContext\.tenant\)\) redirect\("\/more"\)/);
  assert.match(source("app/(dashboard)/more/page.tsx"), /const canTools = legacyRelife/);
  assert.match(source("lib/webos/reports.ts"), /String\(row\.Organization_ID \|\| ""\)\.trim\(\) === organizationId/);
});
