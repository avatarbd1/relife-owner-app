import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const AUTH_PATH = new URL("../lib/domain/tenancy/staffAuthorization.ts", import.meta.url);
const MIGRATION_PATH = new URL(
  "../supabase/migrations/20260824_staff_tenant_membership_v1.sql",
  import.meta.url,
);
const VALIDATORS_PATH = new URL("../lib/domain/tenancy/validators.ts", import.meta.url);

test("T2-01 authorization is scoped to the relife schema and exact tenant binding", async () => {
  const source = await readFile(AUTH_PATH, "utf8");
  assert.match(source, /client\.schema\("relife"\)/);
  assert.match(source, /\.eq\("organization_id", scope\.organizationId\)/);
  assert.match(source, /\.eq\("clinic_id", scope\.clinicId\)/);
  assert.match(source, /\.eq\("staff_id", normalizedStaffId\)/);
  assert.match(source, /\.eq\("status", "active"\)/);
  assert.match(source, /\.eq\("binding_id", binding\.id\)/);
});

test("T2-01 authorization fails closed instead of granting on missing/error state", async () => {
  const source = await readFile(AUTH_PATH, "utf8");
  assert.match(source, /if \(bindingError \|\| !binding\) return null/);
  assert.match(source, /if \(rolesError \|\| departmentsError \|\| !roles \|\| !departments\) return null/);
  assert.match(source, /catch \{[\s\S]*?return null;[\s\S]*?\}/);
  assert.match(source, /membership\?\.roleCodes\.includes\(roleCode\) \?\? false/);
  assert.match(source, /membership\?\.departmentIds\.includes\(departmentId\) \?\? false/);
});

test("T2-01 schema binds roles and departments through one staff binding", async () => {
  const sql = await readFile(MIGRATION_PATH, "utf8");
  assert.match(sql, /create table if not exists relife\.staff_tenant_bindings/i);
  assert.match(sql, /create table if not exists relife\.staff_tenant_roles/i);
  assert.match(sql, /create table if not exists relife\.staff_tenant_departments/i);
  assert.match(sql, /binding_id uuid not null references relife\.staff_tenant_bindings\(id\) on delete cascade/gi);
  assert.match(sql, /unique \(staff_id, organization_id, clinic_id\)/i);
});

test("T2-01 migration enforces clinic/organization consistency without unsafe CHECK subqueries", async () => {
  const sql = await readFile(MIGRATION_PATH, "utf8");
  assert.match(sql, /enforce_staff_binding_clinic_organization/i);
  assert.match(sql, /STAFF_BINDING_CLINIC_ORGANIZATION_MISMATCH/);
  assert.doesNotMatch(sql, /check\s*\([^)]*select\b/i);
});

test("T2-01 browser access is deny-all and service-role access is explicit", async () => {
  const sql = await readFile(MIGRATION_PATH, "utf8");
  for (const table of ["staff_tenant_bindings", "staff_tenant_roles", "staff_tenant_departments"]) {
    assert.match(sql, new RegExp(`alter table relife\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`grant select, insert, update, delete on relife\\.${table} to service_role`, "i"));
  }
  assert.match(sql, /for all to authenticated using \(false\) with check \(false\)/i);
  assert.match(sql, /for all to anon using \(false\) with check \(false\)/i);
});

test("cross-department access is fail-closed for empty scopes", async () => {
  const source = await readFile(AUTH_PATH, "utf8");
  assert.match(
    source,
    /if \(staffDepartments\.length === 0 \|\| patientDepartments\.length === 0\) return false/,
  );
  assert.match(source, /patientDepartments\.some\(\(department\) => staffDepartmentSet\.has\(department\)\)/);
});

test("T2-02 tenant validator has no Owner/non-Owner bypass and requires matching canonical staff scope", async () => {
  const source = await readFile(VALIDATORS_PATH, "utf8");
  const validatorStart = source.indexOf("export function validateTenantScope");
  const validatorEnd = source.indexOf("export function canAccessDepartment");
  assert.notEqual(validatorStart, -1);
  assert.notEqual(validatorEnd, -1);
  assert.ok(validatorEnd > validatorStart);
  const tenantValidator = source.slice(validatorStart, validatorEnd);

  assert.doesNotMatch(tenantValidator, /roles\.includes\("Owner"\)/);
  assert.doesNotMatch(tenantValidator, /staffId\s*!==\s*"ST001"/);
  assert.match(tenantValidator, /accessStaffId !== tenantStaffId/);
  assert.match(tenantValidator, /tenant\.organizationId\?\.trim\(\)/);
  assert.match(tenantValidator, /tenant\.clinicId\?\.trim\(\)/);
  assert.match(tenantValidator, /TENANT_SCOPE_DENIED/);
});
