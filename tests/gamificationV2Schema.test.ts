import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const foundation = source(
  "supabase/migrations/20260819043408_gamification_v2_foundation.sql"
);
const indexes = source(
  "supabase/migrations/20260819043447_gamification_v2_fk_indexes.sql"
);
const roleTargets = source(
  "supabase/migrations/20260819044032_gamification_v2_role_targets.sql"
);

test("Gamification v2 creates the seven core domains plus versioned Owner config", () => {
  for (const table of [
    "performance_events",
    "xp_ledger",
    "weekly_performance",
    "reward_credit_ledger",
    "reward_redemptions",
    "monthly_performance_bonuses",
    "team_targets",
    "gamification_config",
  ]) {
    assert.match(foundation, new RegExp(`create table if not exists relife\\.${table}`));
    assert.match(foundation, new RegExp(`alter table relife\\.${table} enable row level security`));
    assert.match(foundation, new RegExp(`revoke all on table relife\\.${table} from anon, authenticated`));
  }
});

test("XP, verified work events and Reward Credit ledger are append-only", () => {
  assert.match(foundation, /performance_events_append_only/);
  assert.match(foundation, /xp_ledger_append_only/);
  assert.match(foundation, /reward_credit_ledger_append_only/);
  assert.match(foundation, /before update or delete on relife\.performance_events/);
  assert.match(foundation, /before update or delete on relife\.xp_ledger/);
  assert.match(foundation, /before update or delete on relife\.reward_credit_ledger/);
  assert.match(foundation, /append a correction\/reversal entry instead/);
});

test("weekly score is normalized to 0-100 and monthly bonus uses corrected 0-100 tiers", () => {
  assert.match(
    foundation,
    /normalized_score numeric\(5,2\) not null check \(normalized_score >= 0 and normalized_score <= 100\)/
  );
  assert.match(foundation, /"key":"Bronze","min":0,"max":59\.99,"bonus":0/);
  assert.match(foundation, /"key":"Silver","min":60,"max":74\.99,"bonus":500/);
  assert.match(foundation, /"key":"Gold","min":75,"max":89\.99,"bonus":1000/);
  assert.match(foundation, /"key":"Platinum","min":90,"max":100,"bonus":1500/);
});

test("Reward Credit reserves pending claims instead of spending them immediately", () => {
  assert.match(
    foundation,
    /'earned','reserved','released','redeemed','refunded','expired','adjustment_credit','adjustment_debit'/
  );
  assert.match(foundation, /entry_type in \('reserved','released','redeemed'\) and redemption_id is not null/);
  assert.match(foundation, /Pending claims reserve credits; claimed rewards redeem them/);
  assert.match(foundation, /where status in \('pending','approved'\)/);
});

test("reward and bonus defaults live in configuration, not UI constants", () => {
  assert.match(foundation, /'reward\.weekly_rank'/);
  assert.match(foundation, /"rank_1":250,"rank_2":150,"rank_3":100,"participation":50/);
  assert.match(foundation, /'reward\.catalog'/);
  assert.match(foundation, /"credit_cost":40/);
  assert.match(foundation, /"credit_cost":70/);
  assert.match(foundation, /"credit_cost":100/);
  assert.match(foundation, /"credit_cost":150/);
  assert.match(foundation, /'bonus\.multipliers'/);
  assert.match(foundation, /"base_salary_untouched":true/);
  assert.match(foundation, /"owner_approval_required":true/);
});

test("role scoring weights are versioned and operational targets are explicit config", () => {
  assert.match(foundation, /'score\.role\.therapist'/);
  assert.match(foundation, /"productivity":0\.40/);
  assert.match(foundation, /"attendance":0\.20/);
  assert.match(foundation, /"documentation":0\.15/);
  assert.match(foundation, /"quality":0\.15/);
  assert.match(foundation, /"reliability":0\.10/);
  assert.match(foundation, /'score\.role\.receptionist'/);
  assert.match(foundation, /"registration_phone_required_for_score":false/);
  assert.match(foundation, /'score\.role\.manager'/);
  assert.match(foundation, /'score\.role\.dentist', '\{"enabled":false/);
  assert.match(foundation, /'score\.role\.owner', '\{"enabled":false/);

  assert.match(roleTargets, /version, config_value/);
  assert.match(roleTargets, /'score\.role\.therapist'/);
  assert.match(roleTargets, /"sessions_per_week":8/);
  assert.match(roleTargets, /"attendance_days_per_week":5/);
  assert.match(roleTargets, /'score\.role\.receptionist'/);
  assert.match(roleTargets, /"workflow_transactions_per_week":125/);
  assert.match(roleTargets, /"registration_phone_required_for_score":false/);
  assert.match(roleTargets, /'score\.role\.manager'/);
  assert.match(roleTargets, /"coordination_tasks_per_week":10/);
});

test("tenant foreign keys have explicit covering indexes", () => {
  for (const indexName of [
    "xp_ledger_tenant_idx",
    "xp_ledger_event_tenant_idx",
    "weekly_performance_tenant_idx",
    "reward_credit_ledger_tenant_idx",
    "reward_credit_ledger_redemption_tenant_idx",
    "reward_credit_ledger_related_entry_idx",
    "monthly_performance_bonuses_tenant_idx",
    "team_targets_tenant_idx",
    "gamification_config_tenant_idx",
  ]) {
    assert.match(indexes, new RegExp(`create index if not exists ${indexName}`));
  }
});
