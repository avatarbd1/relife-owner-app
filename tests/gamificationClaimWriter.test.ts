import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = source("supabase/migrations/20260819081000_gamification_claim_writer_v1.sql");
const edge = source("supabase/functions/relife-reward-claims-api/index.ts");
const listRoute = source("app/api/v1/gamification/claims/route.ts");
const actionRoute = source("app/api/v1/gamification/claims/[claimId]/actions/route.ts");
const client = source("app/(dashboard)/performance/claims/RewardClaimsClient.tsx");

test("claim schema separates mutable projection, immutable lifecycle and immutable RC ledger", () => {
  assert.match(migration, /alter table relife\.reward_redemptions/);
  assert.match(migration, /state_version integer/);
  assert.match(migration, /config_version integer/);
  assert.match(migration, /policy_snapshot jsonb/);
  assert.match(migration, /conflict_key text/);
  assert.match(migration, /idempotency_key text/);
  assert.match(migration, /create table if not exists relife\.reward_redemption_events/);
  assert.match(migration, /reward_redemption_events_append_only/);
  assert.match(migration, /reject_gamification_append_only_mutation/);
  assert.match(migration, /reward_redemptions_active_conflict_uidx/);
  assert.match(migration, /status in \('pending','approved','claimed'\)/);
});

test("claim requests fail hard before reservation when RC or policy eligibility is invalid", () => {
  assert.match(edge, /creditBalance\(tx, tenant, staffId\)/);
  assert.match(edge, /INSUFFICIENT_REWARD_CREDIT/);
  assert.match(edge, /REWARD_COOLDOWN/);
  assert.match(edge, /REWARD_MONTH_LIMIT/);
  assert.match(edge, /REWARD_QUARTER_LIMIT/);
  assert.match(edge, /INVALID_REQUESTED_DATE/);
  assert.match(edge, /REWARD_CREDIT_LEDGER_INVALID/);
  assert.match(edge, /pg_advisory_xact_lock\(hashtext\(\$\{`reward-claim:/);
});

test("request atomically creates pending claim, RC reservation, lifecycle event and audit", () => {
  assert.match(edge, /insert into relife\.reward_redemptions/);
  assert.match(edge, /'pending'/);
  assert.match(edge, /insert into relife\.reward_credit_ledger/);
  assert.match(edge, /'reserved'/);
  assert.match(edge, /insert into relife\.reward_redemption_events/);
  assert.match(edge, /'requested'/);
  assert.match(edge, /gamification\.reward_claim\.request/);
  assert.match(edge, /availableCreditsAfterReserve/);
});

test("cooldown and costs are read from active reward catalog and snapshotted", () => {
  assert.match(edge, /config_key = 'reward\.catalog'/);
  assert.match(edge, /credit_cost/);
  assert.match(edge, /cooldown_days/);
  assert.match(edge, /max_per_month/);
  assert.match(edge, /max_per_quarter/);
  assert.match(edge, /coverage_required/);
  assert.match(edge, /configVersion/);
  assert.match(edge, /policySnapshot\(policy\)/);
  assert.doesNotMatch(edge, /creditCost:\s*(40|70|100|150)/);
});

test("family-time same-week conflict has business logic plus DB race guard", () => {
  assert.match(edge, /policy\.type === "family_time"/);
  assert.match(edge, /family_time:\$\{isoWeekKey\(requestedFor\)\}/);
  assert.match(migration, /reward_redemptions_active_conflict_uidx/);
});

test("Owner is required for approve deny and claim while staff can cancel own open claim", () => {
  assert.match(edge, /\["approve", "deny", "claim"\]\.includes\(transition\) && !owner/);
  assert.match(edge, /OWNER_REQUIRED/);
  assert.match(edge, /transition === "cancel" && actorId !== staffId && !owner/);
  assert.match(edge, /OPEN_STATUSES\.has\(status\)/);
});

test("approve holds reservation, deny or cancel releases, claim redeems", () => {
  const approveSection = edge.slice(edge.indexOf('if (transition === "approve")'), edge.indexOf('} else if (transition === "deny"'));
  assert.doesNotMatch(approveSection, /insert into relife\.reward_credit_ledger/);
  assert.match(edge, /entry_type,\n\s*credit_amount[\s\S]*?'released'/);
  assert.match(edge, /'redeemed'/);
  assert.match(edge, /related_entry_id/);
  assert.match(edge, /CLAIM_RESERVATION_INVALID/);
});

test("claim transitions are optimistic-concurrency and idempotency protected", () => {
  assert.match(edge, /expectedVersion/);
  assert.match(edge, /STALE_CLAIM_VERSION/);
  assert.match(edge, /eventKey = `claim:\$\{claimId\}:\$\{transition\}:\$\{idempotencyKey\}`/);
  assert.match(edge, /duplicate: true/);
  assert.match(edge, /state_version = \$\{nextVersion\}/);
});

test("Next endpoints preserve server-derived actor identity and bounded command API", () => {
  assert.match(listRoute, /requireCurrentAccessContext/);
  assert.match(listRoute, /staffId: context\.staffId/);
  assert.match(listRoute, /actorRoles: context\.roles/);
  assert.match(listRoute, /isAllowedRequestOrigin/);
  assert.match(actionRoute, /requireCurrentAccessContext/);
  assert.match(actionRoute, /transition/);
  assert.match(actionRoute, /expectedVersion/);
  assert.match(actionRoute, /idempotencyKey/);
  assert.doesNotMatch(listRoute, /staffId: body\.staffId/);
});

test("Reward Claims UI exposes single-item review and coverage confirmation, not bulk approval", () => {
  assert.match(client, /Reserve \$\{selectedReward\.creditCost\} RC & Request/);
  assert.match(client, /Coverage confirmed available/);
  assert.match(client, />Approve</);
  assert.match(client, /Deny & Release/);
  assert.match(client, /Confirm Claim & Redeem/);
  assert.match(client, /Cancel & Release/);
  assert.doesNotMatch(client, /Bulk Approve/);
});
