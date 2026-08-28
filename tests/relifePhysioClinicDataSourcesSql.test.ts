import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dryRun = readFileSync(
  new URL("../scripts/sql/relife-physio-clinic-data-sources-dry-run.sql", import.meta.url),
  "utf8"
);
const apply = readFileSync(
  new URL("../scripts/sql/relife-physio-clinic-data-sources-apply.template.sql", import.meta.url),
  "utf8"
);
const rollback = readFileSync(
  new URL("../scripts/sql/relife-physio-clinic-data-sources-rollback.template.sql", import.meta.url),
  "utf8"
);
const protectedTables = [
  "patients", "appointments", "treatments", "payments", "expenses", "salary",
  "cash_movement", "chamber_sessions", "performance_events", "xp_ledger",
  "clinic_feature_flags", "clinic_entitlements",
];

test("Physio sources dry-run is transaction read-only and proposes exactly the two rows", () => {
  assert.match(dryRun, /begin transaction read only/i);
  assert.match(dryRun, /rollback;/i);
  assert.doesNotMatch(dryRun, /\b(insert|update|delete|merge|truncate)\b\s+(into\s+|from\s+)?relife\./i);
  assert.match(dryRun, /sheets_workbook/);
  assert.match(dryRun, /storage_prefix/);
  assert.match(dryRun, /"department":"Physio"/);
  // Dental may be named in explanatory comments (scope clarity) but must
  // never appear as a proposed department/source_ref value.
  assert.doesNotMatch(dryRun, /"department":"Dental"/);
  assert.doesNotMatch(dryRun, /RELIFE-DENTAL/);
});

test("Physio sources apply is approval-gated, inserts clinic_data_sources only, and never mutates operational data", () => {
  assert.match(apply, /owner_approved_change_id/);
  assert.match(apply, /REPLACE_WITH_OWNER_APPROVED_CHANGE_ID/);
  assert.match(apply, /RELIFE_PHYSIO_SOURCES_OWNER_APPROVAL_REQUIRED/);
  assert.match(apply, /insert into relife\.clinic_data_sources/i);
  assert.doesNotMatch(apply, /\b(update|delete|truncate)\b\s+(from\s+)?relife\./i);
  // Mentioning activate_clinic_v1/provision_clinic_v1 in an explanatory
  // comment is fine; actually calling either is not.
  assert.doesNotMatch(apply, /select\s+relife\.(activate|provision)_clinic_v1|perform\s+relife\.(activate|provision)_clinic_v1/i);
  assert.doesNotMatch(apply, /"department":"Dental"/);
  assert.doesNotMatch(apply, /RELIFE-DENTAL/);
  for (const table of protectedTables) {
    assert.doesNotMatch(apply, new RegExp(`(?:insert\\s+into|update|delete\\s+from|truncate)\\s+relife\\.${table}`, "i"));
  }
});

test("Physio sources rollback is approval-gated and can delete only marker-owned rows", () => {
  assert.match(rollback, /RELIFE_PHYSIO_SOURCES_ROLLBACK_APPROVAL_REQUIRED/);
  assert.match(rollback, /REPLACE_WITH_OWNER_APPROVED_CHANGE_ID/);
  assert.match(rollback, /delete from relife\.clinic_data_sources/i);
  assert.match(rollback, /notes = 'relife-physio-generic-tenant:2026-08-28'/i);
  for (const table of protectedTables) {
    assert.doesNotMatch(rollback, new RegExp(`delete\\s+from\\s+relife\\.${table}`, "i"));
  }
});
