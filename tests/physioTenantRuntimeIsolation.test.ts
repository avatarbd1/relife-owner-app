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

test("current session access is clamped to clinic type before any dashboard permission checks", () => {
  const currentUser = source("lib/webos/currentUser.ts");
  assert.match(currentUser, /scopeIdentityToClinic/);
  assert.match(currentUser, /departmentAccess: \[department\]/);
  assert.match(currentUser, /if \(isRelifeLegacyTenant\(tenant\)\) return identity/);
});
