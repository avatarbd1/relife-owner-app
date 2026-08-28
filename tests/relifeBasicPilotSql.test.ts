import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dryRun = readFileSync(new URL("../scripts/sql/relife-basic-pilot-dry-run.sql", import.meta.url), "utf8");
const apply = readFileSync(new URL("../scripts/sql/relife-basic-pilot-apply.template.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../scripts/sql/relife-basic-pilot-rollback.template.sql", import.meta.url), "utf8");
const eightKeys = [
  "optional.live_chamber", "optional.room_bed_runtime", "optional.machines",
  "optional.gamification", "optional.rewards", "optional.finance_advanced",
  "optional.salary", "optional.live_chat",
];
const protectedTables = [
  "patients", "appointments", "treatments", "payments", "expenses", "salary",
  "cash_movement", "chamber_sessions", "performance_events", "xp_ledger",
];

test("I-1 dry-run is transaction read-only and proposes exactly the locked keys", () => {
  assert.match(dryRun, /begin transaction read only/i);
  assert.match(dryRun, /rollback;/i);
  assert.doesNotMatch(dryRun, /\b(insert|update|delete|merge|truncate)\b\s+(into\s+|from\s+)?relife\./i);
  for (const key of eightKeys) assert.match(dryRun, new RegExp(key.replace(".", "\\.")));
});

test("I-1 apply is approval-gated, inserts disabled flags only, and never mutates operational data", () => {
  assert.match(apply, /owner_approved_change_id/);
  assert.match(apply, /REPLACE_WITH_OWNER_APPROVED_CHANGE_ID/);
  assert.match(apply, /I1_BASIC_PILOT_OWNER_APPROVAL_REQUIRED/);
  assert.match(apply, /insert into relife\.clinic_feature_flags/i);
  assert.doesNotMatch(apply, /insert into relife\.clinic_entitlements/i);
  assert.doesNotMatch(apply, /\b(update|delete|truncate)\b\s+(from\s+)?relife\./i);
  for (const table of protectedTables) {
    assert.doesNotMatch(apply, new RegExp(`(?:insert\\s+into|update|delete\\s+from|truncate)\\s+relife\\.${table}`, "i"));
  }
});

test("I-1 rollback is approval-gated and can delete only marker-owned feature flags", () => {
  assert.match(rollback, /I1_BASIC_PILOT_ROLLBACK_APPROVAL_REQUIRED/);
  assert.match(rollback, /REPLACE_WITH_OWNER_APPROVED_CHANGE_ID/);
  assert.match(rollback, /delete from relife\.clinic_feature_flags/i);
  assert.match(rollback, /enabled_by = 'controlled_canonicalization'/i);
  assert.match(rollback, /notes = 'i1-basic-pilot:2026-08-28'/i);
  assert.doesNotMatch(rollback, /delete from relife\.clinic_entitlements/i);
  for (const table of protectedTables) {
    assert.doesNotMatch(rollback, new RegExp(`delete\\s+from\\s+relife\\.${table}`, "i"));
  }
});
