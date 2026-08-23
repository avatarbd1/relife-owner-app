import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeTenantRole,
  requireTenantScope,
} from "../lib/domain/tenancy/policy.ts";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = source(
  "supabase/migrations/20260824030000_multitenant_kernel_v1.sql"
);

test("organizations remain the canonical tenant instead of creating a duplicate tenant table", () => {
  assert.match(migration, /relife\.organizations = Tenant/);
  assert.doesNotMatch(migration, /create table if not exists relife\.tenants\s*\(/i);
  assert.match(migration, /create table if not exists relife\.departments/);
  assert.match(migration, /create table if not exists relife\.membership_roles/);
  assert.match(migration, /create table if not exists relife\.membership_departments/);
});

test("tenant authorization helpers are fail-closed and membership-scoped", () => {
  assert.match(migration, /function relife\.user_is_active_member/);
  assert.match(migration, /auth\.uid\(\) is not null and exists/);
  assert.match(migration, /function relife\.user_has_permission/);
  assert.match(migration, /function relife\.user_has_department/);
  assert.match(migration, /m\.organization_id = target_organization_id/);
  assert.match(migration, /m\.clinic_id = target_clinic_id/);
  assert.match(migration, /m\.status = 'active'/);
});

test("metadata RLS resolves clinic scope from authenticated membership", () => {
  assert.match(migration, /create policy tenant_member_read_organization/);
  assert.match(migration, /create policy tenant_member_read_clinic/);
  assert.match(migration, /create policy tenant_member_read_department/);
  assert.match(
    migration,
    /using \(relife\.user_is_active_member\(organization_id, id\)\)/
  );
  assert.match(
    migration,
    /No INSERT\/UPDATE\/DELETE\s*\n-- grant is given to authenticated/
  );
});

test("system admin does not receive owner, analytics-export, or implicit clinical permission", () => {
  assert.doesNotMatch(migration, /\('system_admin', 'tenant\.manage'\)/);
  assert.doesNotMatch(migration, /\('system_admin', 'analytics\.export'\)/);
  assert.doesNotMatch(migration, /\('system_admin', 'analytics\.aggregate\.read'\)/);
  assert.doesNotMatch(migration, /\('system_admin', 'clinical\./);
});

test("analytics facts contain no direct patient identity fields", () => {
  const start = migration.indexOf(
    "create table if not exists relife_analytics.outcome_facts"
  );
  const end = migration.indexOf(
    "create index if not exists outcome_facts_tenant_condition_idx",
    start
  );
  assert.ok(start >= 0 && end > start, "analytics outcome_facts block must exist");
  const block = migration.slice(start, end).toLowerCase();

  for (const forbidden of [
    "patient_id",
    "patient_name",
    "full_name",
    "phone",
    "mobile",
    "date_of_birth",
    "dob",
    "address",
    "nid",
  ]) {
    assert.equal(
      block.includes(forbidden),
      false,
      `analytics outcome facts must not contain ${forbidden}`
    );
  }

  assert.match(block, /subject_key uuid not null/);
  assert.match(migration, /revoke all on schema relife_analytics from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant .*relife_analytics.*authenticated/is);
});

test("consent, provenance, retention and data-access audit hooks exist", () => {
  assert.match(migration, /create table if not exists relife\.patient_consents/);
  assert.match(migration, /commercial_secondary_use/);
  assert.match(migration, /create table if not exists relife\.data_provenance/);
  assert.match(migration, /ai_generated boolean not null default false/);
  assert.match(migration, /human_verified boolean not null default false/);
  assert.match(migration, /create table if not exists relife\.retention_policies/);
  assert.match(migration, /retention_days integer/);
  assert.match(migration, /create table if not exists relife\.data_access_events/);
});

test("legacy roles normalize deterministically and unknown roles fail closed", () => {
  assert.equal(normalizeTenantRole("Owner"), "owner");
  assert.equal(normalizeTenantRole("Dental_Assistant"), "dental_assistant");
  assert.equal(normalizeTenantRole("Dental-Assistant"), "dental_assistant");
  assert.equal(normalizeTenantRole("System Admin"), "system_admin");
  assert.equal(normalizeTenantRole("Unknown Super Role"), null);
  assert.equal(normalizeTenantRole(""), null);
  assert.equal(normalizeTenantRole(null), null);
});

test("application tenant scope cannot silently fall back to Relife", () => {
  assert.deepEqual(
    requireTenantScope({ organizationId: "org-1", clinicId: "clinic-1" }),
    { organizationId: "org-1", clinicId: "clinic-1" }
  );
  assert.throws(() => requireTenantScope({ organizationId: "org-1" }), {
    message: "TENANT_SCOPE_REQUIRED",
  });
  assert.throws(() => requireTenantScope(null), {
    message: "TENANT_SCOPE_REQUIRED",
  });
});
