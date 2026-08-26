import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const tenantFoundation = source(
  "supabase/migrations/20260816155917_tenant_ready_foundation.sql"
);
const financeLedger = source(
  "supabase/migrations/20260816183900_finance_transaction_ledger.sql"
);
const gamification = source(
  "supabase/migrations/20260819043408_gamification_v2_foundation.sql"
);
const kernel = source(
  "supabase/migrations/20260824030000_multitenant_kernel_v1.sql"
);
const staffMembership = source(
  "supabase/migrations/20260824_staff_tenant_membership_v1.sql"
);

const foundationalOperationalTables = [
  "appointments",
  "booking_conflicts",
  "chamber_resources",
  "chamber_sessions",
  "chat_messages",
  "equipment_requests",
  "machine_reservations",
  "patient_cache",
  "treatment_plan_cache",
  "treatment_timeline",
] as const;

const gamificationTables = [
  "performance_events",
  "xp_ledger",
  "weekly_performance",
  "reward_redemptions",
  "reward_credit_ledger",
  "monthly_performance_bonuses",
  "team_targets",
  "gamification_config",
] as const;

const privateKernelTables = [
  "patient_consents",
  "data_provenance",
  "retention_policies",
  "data_access_events",
  "analytics_subject_links",
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertRlsEnabled(sql: string, table: string): void {
  assert.match(
    sql,
    new RegExp(`alter table relife\\.${escapeRegExp(table)} enable row level security`, "i"),
    `${table} must keep RLS enabled`
  );
}

test("T4 baseline keeps foundational operational tables tenant-keyed and RLS-enabled", () => {
  for (const table of foundationalOperationalTables) {
    assert.match(
      tenantFoundation,
      new RegExp(`alter table relife\\.%I add column if not exists organization_id uuid`, "i")
    );
    assert.match(
      tenantFoundation,
      new RegExp(`alter table relife\\.%I add column if not exists clinic_id uuid`, "i")
    );
    assert.match(
      tenantFoundation,
      new RegExp(`alter table relife\\.%I enable row level security`, "i")
    );
    assert.match(tenantFoundation, new RegExp(`'${escapeRegExp(table)}'`));
  }

  assert.match(
    tenantFoundation,
    /foreign key \(organization_id, clinic_id\) references relife\.clinics \(organization_id, id\)/i
  );
});

test("T4 baseline keeps finance and gamification operational tables client-private", () => {
  assertRlsEnabled(financeLedger, "finance_operations");
  assert.match(
    financeLedger,
    /revoke all on table relife\.finance_operations from anon, authenticated/i
  );

  for (const table of gamificationTables) {
    assertRlsEnabled(gamification, table);
    assert.match(
      gamification,
      new RegExp(`revoke all on table relife\\.${escapeRegExp(table)} from anon, authenticated`, "i"),
      `${table} must remain unavailable to browser roles until an explicit domain cutover`
    );
  }
});

test("T4 baseline preserves the kernel decision that operational data is not broadly exposed", () => {
  assert.match(
    kernel,
    /Existing operational tenant tables stay client-private[\s\S]*direct client grants\/policies must be domain-specific/i
  );

  assert.doesNotMatch(
    kernel,
    /grant\s+(?:select|insert|update|delete|all)[^;]*on\s+(?:table\s+)?relife\.(?:appointments|finance_operations|patient_cache|treatment_timeline)[^;]*to\s+authenticated/i
  );
});

test("T4 baseline keeps governance and analytics data private by default", () => {
  for (const table of privateKernelTables) {
    assertRlsEnabled(kernel, table);
    assert.match(
      kernel,
      new RegExp(`revoke all on table relife\\.${escapeRegExp(table)} from anon, authenticated`, "i"),
      `${table} must stay private`
    );
  }

  assert.match(kernel, /alter table relife_analytics\.outcome_facts enable row level security/i);
  assert.match(
    kernel,
    /revoke all on table relife_analytics\.outcome_facts from anon, authenticated/i
  );
  assert.match(
    kernel,
    /revoke all on schema relife_analytics from public, anon, authenticated/i
  );
});

test("T4 baseline metadata reads remain membership-scoped and writes remain closed", () => {
  assert.match(kernel, /create policy tenant_member_read_organization/i);
  assert.match(kernel, /create policy tenant_member_read_clinic/i);
  assert.match(kernel, /create policy tenant_member_read_department/i);
  assert.match(kernel, /relife\.user_is_active_member\(organization_id, id\)/i);
  assert.match(kernel, /relife\.user_is_active_member\(organization_id, clinic_id\)/i);
  assert.match(
    kernel,
    /No INSERT\/UPDATE\/DELETE\s*\n-- grant is given to authenticated/i
  );
});

test("T4 baseline staff tenant tables are explicit deny-all for browser roles", () => {
  for (const table of [
    "staff_tenant_bindings",
    "staff_tenant_roles",
    "staff_tenant_departments",
  ]) {
    assertRlsEnabled(staffMembership, table);
    assert.match(
      staffMembership,
      new RegExp(`${escapeRegExp(table)}_deny_anon[\\s\\S]*for all to anon using \\(false\\) with check \\(false\\)`, "i")
    );
    assert.match(
      staffMembership,
      new RegExp(`${escapeRegExp(table)}_deny_authenticated[\\s\\S]*for all to authenticated using \\(false\\) with check \\(false\\)`, "i")
    );
  }

  assert.match(
    staffMembership,
    /trusted server\/service-role path until a later, explicitly reviewed RLS slice/i
  );
});
