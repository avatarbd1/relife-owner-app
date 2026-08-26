import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
if (!dbUrl) throw new Error("SUPABASE_DB_URL missing");
const sql = postgres(dbUrl, { prepare: false, max: 3, idle_timeout: 20 });

const SERVER_KEY_HASHES = new Set([
  "50840a8a74de86a912cb2a268ff6d24b2a9fc3cf4ab016229e52d3219a3772fe",
  "340a6b07dbfe883d2ecad82971bb4226a32974c00e89138ad71e8279a89e58d2",
]);
const DEFAULT_ORGANIZATION_SLUG = "relife";
const DEFAULT_CLINIC_SLUG = "amtali-main";
const CLAIM_DEPARTMENTS = new Set(["Physio", "Dental"]);
const CLAIMANT_ROLES = new Set(["Manager", "Receptionist", "Therapist", "Dentist"]);
const OWNER_ROLE = "Owner";
const OPEN_STATUSES = new Set(["pending", "approved"]);

type Tenant = { organizationId: string; clinicId: string };
type RewardPolicy = {
  key: string;
  type: "family_time" | "leave" | "voucher" | "treat" | "other";
  creditCost: number;
  cooldownDays: number | null;
  maxPerMonth: number | null;
  maxPerQuarter: number | null;
  coverageRequired: boolean;
  configVersion: number;
};

type CreditBalance = {
  ledgerBalance: number;
  reservedBalance: number;
  availableBalance: number;
  valid: boolean;
};

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function norm(value: unknown): string {
  return String(value ?? "").trim();
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(norm).filter(Boolean) : [];
}

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function optionalNonNegativeInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function validIdempotencyKey(value: string): boolean {
  return /^[A-Za-z0-9._:-]{8,180}$/.test(value);
}

function validRequestId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,160}$/.test(value);
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validDateOrNull(value: unknown): string | null {
  const text = norm(value);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("INVALID_REQUESTED_DATE");
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error("INVALID_REQUESTED_DATE");
  }
  return text;
}

function isoWeekKey(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function hasRole(roles: string[], role: string): boolean {
  return roles.includes(role);
}

function claimantAllowed(roles: string[]): boolean {
  return roles.some((role) => CLAIMANT_ROLES.has(role));
}

function departmentAllowed(access: string[], department: string): boolean {
  return access.includes("All") || access.includes(department);
}

function errorStatus(message: string): number {
  if (message === "ACCESS_DENIED" || message === "OWNER_REQUIRED") return 403;
  if (message === "CLAIM_NOT_FOUND") return 404;
  if (
    message.startsWith("INSUFFICIENT_REWARD_CREDIT") ||
    message.startsWith("REWARD_COOLDOWN") ||
    message.startsWith("REWARD_MONTH_LIMIT") ||
    message.startsWith("REWARD_QUARTER_LIMIT") ||
    message === "CLAIM_CONFLICT" ||
    message === "INVALID_CLAIM_STATE" ||
    message === "STALE_CLAIM_VERSION" ||
    message === "COVERAGE_REQUIRED" ||
    message === "COVERAGE_UNAVAILABLE" ||
    message === "CLAIM_RESERVATION_INVALID"
  ) return 409;
  if (
    message.startsWith("INVALID_") ||
    message === "REWARD_NOT_FOUND" ||
    message === "REWARD_CATALOG_UNAVAILABLE" ||
    message === "REWARD_CREDIT_LEDGER_INVALID"
  ) return 400;
  return 500;
}

async function sha256Hex(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function authorized(req: Request): Promise<boolean> {
  const key = req.headers.get("x-relife-server-key") || "";
  if (!key) return false;
  return SERVER_KEY_HASHES.has(await sha256Hex(key));
}

async function resolveTenant(body: Record<string, unknown>): Promise<Tenant> {
  const organizationSlug = norm(body.organizationSlug || DEFAULT_ORGANIZATION_SLUG);
  const clinicSlug = norm(body.clinicSlug || DEFAULT_CLINIC_SLUG);
  const rows = await sql`
    select o.id::text as organization_id, c.id::text as clinic_id
    from relife.organizations o
    join relife.clinics c on c.organization_id = o.id
    where o.slug = ${organizationSlug}
      and c.slug = ${clinicSlug}
      and lower(o.status) = 'active'
      and lower(c.status) = 'active'
    limit 1
  `;
  if (!rows[0]) throw new Error("TENANT_NOT_FOUND");
  return { organizationId: norm(rows[0].organization_id), clinicId: norm(rows[0].clinic_id) };
}

async function rewardPolicy(
  tenant: Tenant,
  department: string,
  rewardKey: string
): Promise<RewardPolicy> {
  const rows = await sql`
    select version, config_value
    from relife.gamification_config
    where organization_id = ${tenant.organizationId}::uuid
      and clinic_id = ${tenant.clinicId}::uuid
      and config_key = 'reward.catalog'
      and status = 'active'
      and department in ('All', ${department})
      and effective_from <= now()
      and (effective_until is null or effective_until > now())
    order by case when department = ${department} then 0 else 1 end, version desc
    limit 1
  `;
  if (!rows[0]) throw new Error("REWARD_CATALOG_UNAVAILABLE");
  const config = objectValue(rows[0].config_value);
  const items = Array.isArray(config.items) ? config.items : [];
  for (const raw of items) {
    const item = objectValue(raw);
    if (norm(item.key) !== rewardKey) continue;
    const type = norm(item.type);
    const creditCost = positiveNumber(item.credit_cost);
    if (!creditCost || !["family_time", "leave", "voucher", "treat", "other"].includes(type)) {
      throw new Error("REWARD_CATALOG_UNAVAILABLE");
    }
    return {
      key: rewardKey,
      type: type as RewardPolicy["type"],
      creditCost,
      cooldownDays: optionalNonNegativeInteger(item.cooldown_days),
      maxPerMonth: optionalNonNegativeInteger(item.max_per_month),
      maxPerQuarter: optionalNonNegativeInteger(item.max_per_quarter),
      coverageRequired: item.coverage_required === true,
      configVersion: Number(rows[0].version || 0),
    };
  }
  throw new Error("REWARD_NOT_FOUND");
}

async function creditBalance(tx: any, tenant: Tenant, staffId: string): Promise<CreditBalance> {
  const rows = await tx`
    select
      coalesce(sum(case
        when entry_type in ('earned','refunded','adjustment_credit') then credit_amount
        when entry_type in ('redeemed','expired','adjustment_debit') then -credit_amount
        else 0 end), 0)::numeric as ledger_balance,
      coalesce(sum(case
        when entry_type = 'reserved' then credit_amount
        when entry_type in ('released','redeemed') then -credit_amount
        else 0 end), 0)::numeric as reserved_balance
    from relife.reward_credit_ledger
    where organization_id = ${tenant.organizationId}::uuid
      and clinic_id = ${tenant.clinicId}::uuid and staff_id = ${staffId}
  `;
  const ledgerBalance = Number(rows[0]?.ledger_balance || 0);
  const reservedBalance = Number(rows[0]?.reserved_balance || 0);
  const availableBalance = ledgerBalance - reservedBalance;
  const valid = [ledgerBalance, reservedBalance, availableBalance].every(Number.isFinite) &&
    ledgerBalance >= 0 && reservedBalance >= 0 && availableBalance >= 0;
  return { ledgerBalance, reservedBalance, availableBalance, valid };
}

function policySnapshot(policy: RewardPolicy): Record<string, unknown> {
  return {
    rewardKey: policy.key,
    redemptionType: policy.type,
    creditCost: policy.creditCost,
    cooldownDays: policy.cooldownDays,
    maxPerMonth: policy.maxPerMonth,
    maxPerQuarter: policy.maxPerQuarter,
    coverageRequired: policy.coverageRequired,
    configVersion: policy.configVersion,
  };
}

async function audit(tx: any, input: {
  tenant: Tenant;
  requestId: string;
  actorId: string;
  action: string;
  claimId: string;
  staffId: string;
  payload: Record<string, unknown>;
}) {
  await tx`
    insert into relife.audit_events(
      organization_id, clinic_id, request_id, actor_id, action,
      entity_type, entity_id, patient_id, payload
    ) values (
      ${input.tenant.organizationId}::uuid,
      ${input.tenant.clinicId}::uuid,
      ${input.requestId}, ${input.actorId}, ${input.action},
      'RewardClaim', ${input.claimId}, '',
      ${JSON.stringify({ staffId: input.staffId, ...input.payload })}::jsonb
    )
  `;
}

async function listClaims(tenant: Tenant, body: Record<string, unknown>) {
  const actorId = norm(body.actorId);
  const roles = stringArray(body.actorRoles);
  const status = norm(body.status || "pending");
  if (!actorId || roles.length === 0) throw new Error("ACCESS_DENIED");
  const owner = hasRole(roles, OWNER_ROLE);
  const allowedStatuses = new Set(["pending", "approved", "denied", "cancelled", "claimed", "expired", "all"]);
  if (!allowedStatuses.has(status)) throw new Error("INVALID_CLAIM_STATUS");

  const rows = await sql`
    select
      id::text, staff_id, department, reward_key, redemption_type,
      credit_cost::numeric, requested_for::text, request_notes,
      coverage_status, status, decision_reason, requested_at,
      owner_decision_by, owner_decision_at, claimed_at, claimed_by,
      cancelled_at, expires_at, state_version, config_version,
      policy_snapshot, eligible_after
    from relife.reward_redemptions
    where organization_id = ${tenant.organizationId}::uuid
      and clinic_id = ${tenant.clinicId}::uuid
      and (${owner} or staff_id = ${actorId})
      and (${status} = 'all' or status = ${status})
    order by requested_at desc
    limit 200
  `;
  return rows.map((row) => ({
    id: norm(row.id),
    staffId: norm(row.staff_id),
    department: norm(row.department),
    rewardKey: norm(row.reward_key),
    redemptionType: norm(row.redemption_type),
    creditCost: Number(row.credit_cost || 0),
    requestedFor: row.requested_for ? norm(row.requested_for) : null,
    requestNotes: norm(row.request_notes),
    coverageStatus: norm(row.coverage_status),
    status: norm(row.status),
    decisionReason: norm(row.decision_reason),
    requestedAt: row.requested_at ? new Date(row.requested_at).toISOString() : null,
    ownerDecisionBy: row.owner_decision_by ? norm(row.owner_decision_by) : null,
    ownerDecisionAt: row.owner_decision_at ? new Date(row.owner_decision_at).toISOString() : null,
    claimedAt: row.claimed_at ? new Date(row.claimed_at).toISOString() : null,
    claimedBy: row.claimed_by ? norm(row.claimed_by) : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    stateVersion: Number(row.state_version || 1),
    configVersion: row.config_version === null ? null : Number(row.config_version),
    policySnapshot: row.policy_snapshot || {},
    eligibleAfter: row.eligible_after ? new Date(row.eligible_after).toISOString() : null,
  }));
}

async function requestClaim(tenant: Tenant, body: Record<string, unknown>) {
  const requestId = norm(body.requestId);
  const idempotencyKey = norm(body.idempotencyKey);
  const actorId = norm(body.actorId);
  const staffId = norm(body.staffId);
  const roles = stringArray(body.actorRoles);
  const access = stringArray(body.actorDepartmentAccess);
  const department = norm(body.department);
  const rewardKey = norm(body.rewardKey);
  const requestedFor = validDateOrNull(body.requestedFor);
  const requestNotes = norm(body.requestNotes).slice(0, 1000);

  if (!validRequestId(requestId)) throw new Error("INVALID_REQUEST_ID");
  if (!validIdempotencyKey(idempotencyKey)) throw new Error("INVALID_IDEMPOTENCY_KEY");
  if (!actorId || actorId !== staffId || !claimantAllowed(roles)) throw new Error("ACCESS_DENIED");
  if (!CLAIM_DEPARTMENTS.has(department) || !departmentAllowed(access, department)) throw new Error("ACCESS_DENIED");
  if (!rewardKey) throw new Error("INVALID_REWARD_KEY");

  const policy = await rewardPolicy(tenant, department, rewardKey);
  if ((policy.type === "family_time" || policy.type === "leave") && !requestedFor) {
    throw new Error("INVALID_REQUESTED_DATE");
  }

  return await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`reward-claim:${tenant.clinicId}:${staffId}`}))`;

    const duplicate = await tx`
      select id::text, status, state_version
      from relife.reward_redemptions
      where organization_id = ${tenant.organizationId}::uuid
        and clinic_id = ${tenant.clinicId}::uuid and idempotency_key = ${idempotencyKey}
      limit 1
    `;
    if (duplicate[0]) {
      return { claimId: norm(duplicate[0].id), status: norm(duplicate[0].status), stateVersion: Number(duplicate[0].state_version), duplicate: true };
    }

    const todayRows = await tx`select (now() at time zone 'Asia/Dhaka')::date::text as today`;
    const today = norm(todayRows[0]?.today);
    if (requestedFor && requestedFor < today) throw new Error("INVALID_REQUESTED_DATE");

    const balance = await creditBalance(tx, tenant, staffId);
    if (!balance.valid) throw new Error("REWARD_CREDIT_LEDGER_INVALID");
    if (balance.availableBalance < policy.creditCost) {
      throw new Error(`INSUFFICIENT_REWARD_CREDIT:${policy.creditCost}:${balance.availableBalance}`);
    }

    let eligibleAfter: string | null = null;
    if (policy.cooldownDays && policy.cooldownDays > 0) {
      const previous = await tx`
        select claimed_at
        from relife.reward_redemptions
        where organization_id = ${tenant.organizationId}::uuid
          and clinic_id = ${tenant.clinicId}::uuid
          and staff_id = ${staffId}
          and reward_key = ${rewardKey}
          and status = 'claimed'
          and claimed_at is not null
        order by claimed_at desc
        limit 1
      `;
      if (previous[0]?.claimed_at) {
        const eligible = new Date(previous[0].claimed_at);
        eligible.setUTCDate(eligible.getUTCDate() + policy.cooldownDays);
        eligibleAfter = eligible.toISOString();
        if (eligible.getTime() > Date.now()) throw new Error(`REWARD_COOLDOWN:${eligibleAfter}`);
      }
    }

    const effectiveDate = requestedFor || today;
    if (policy.maxPerMonth && policy.maxPerMonth > 0) {
      const count = await tx`
        select count(*)::int as count
        from relife.reward_redemptions
        where organization_id = ${tenant.organizationId}::uuid
          and clinic_id = ${tenant.clinicId}::uuid
          and staff_id = ${staffId}
          and reward_key = ${rewardKey}
          and status in ('pending','approved','claimed')
          and date_trunc('month', coalesce(requested_for, (requested_at at time zone 'Asia/Dhaka')::date)::timestamp)
              = date_trunc('month', ${effectiveDate}::date::timestamp)
      `;
      if (Number(count[0]?.count || 0) >= policy.maxPerMonth) throw new Error("REWARD_MONTH_LIMIT");
    }
    if (policy.maxPerQuarter && policy.maxPerQuarter > 0) {
      const count = await tx`
        select count(*)::int as count
        from relife.reward_redemptions
        where organization_id = ${tenant.organizationId}::uuid
          and clinic_id = ${tenant.clinicId}::uuid
          and staff_id = ${staffId}
          and reward_key = ${rewardKey}
          and status in ('pending','approved','claimed')
          and date_trunc('quarter', coalesce(requested_for, (requested_at at time zone 'Asia/Dhaka')::date)::timestamp)
              = date_trunc('quarter', ${effectiveDate}::date::timestamp)
      `;
      if (Number(count[0]?.count || 0) >= policy.maxPerQuarter) throw new Error("REWARD_QUARTER_LIMIT");
    }

    const conflictKey = policy.type === "family_time" && requestedFor
      ? `family_time:${isoWeekKey(requestedFor)}`
      : "";
    const coverageStatus = policy.coverageRequired ? "pending" : "not_required";

    let claimRows;
    try {
      claimRows = await tx`
        insert into relife.reward_redemptions(
          organization_id, clinic_id, staff_id, department, reward_key,
          redemption_type, credit_cost, requested_for, request_notes,
          coverage_status, status, requested_by, state_version,
          config_version, policy_snapshot, conflict_key, idempotency_key,
          eligible_after
        ) values (
          ${tenant.organizationId}::uuid, ${tenant.clinicId}::uuid,
          ${staffId}, ${department}, ${rewardKey}, ${policy.type},
          ${policy.creditCost}, ${requestedFor}, ${requestNotes},
          ${coverageStatus}, 'pending', ${actorId}, 1,
          ${policy.configVersion}, ${JSON.stringify(policySnapshot(policy))}::jsonb,
          ${conflictKey}, ${idempotencyKey}, ${eligibleAfter}
        ) returning id::text
      `;
    } catch (error) {
      const code = norm((error as { code?: unknown })?.code);
      if (code === "23505") throw new Error("CLAIM_CONFLICT");
      throw error;
    }
    const claimId = norm(claimRows[0]?.id);
    if (!claimId) throw new Error("CLAIM_INSERT_FAILED");

    const reserveRows = await tx`
      insert into relife.reward_credit_ledger(
        organization_id, clinic_id, staff_id, department, entry_type,
        credit_amount, source_type, source_id, redemption_id,
        idempotency_key, reason, created_by
      ) values (
        ${tenant.organizationId}::uuid, ${tenant.clinicId}::uuid,
        ${staffId}, ${department}, 'reserved', ${policy.creditCost},
        'reward_claim', ${claimId}, ${claimId}::uuid,
        ${`claim:${claimId}:reserve:v1`}, 'Reward claim reservation', ${actorId}
      ) returning id::text
    `;
    const reserveEntryId = norm(reserveRows[0]?.id);

    await tx`
      insert into relife.reward_redemption_events(
        organization_id, clinic_id, redemption_id, staff_id, department,
        event_type, state_version, event_key, actor_id, reason, payload
      ) values (
        ${tenant.organizationId}::uuid, ${tenant.clinicId}::uuid,
        ${claimId}::uuid, ${staffId}, ${department}, 'requested', 1,
        ${`claim:${claimId}:requested:v1`}, ${actorId}, ${requestNotes},
        ${JSON.stringify({ policy: policySnapshot(policy), requestedFor, reserveEntryId, conflictKey })}::jsonb
      )
    `;
    await audit(tx, {
      tenant, requestId, actorId, action: 'gamification.reward_claim.request',
      claimId, staffId,
      payload: { rewardKey, department, creditCost: policy.creditCost, requestedFor, reserveEntryId, configVersion: policy.configVersion },
    });

    return { claimId, status: "pending", stateVersion: 1, duplicate: false, reservedCredits: policy.creditCost, availableCreditsAfterReserve: balance.availableBalance - policy.creditCost };
  });
}

async function transitionClaim(tenant: Tenant, body: Record<string, unknown>) {
  const requestId = norm(body.requestId);
  const idempotencyKey = norm(body.idempotencyKey);
  const actorId = norm(body.actorId);
  const roles = stringArray(body.actorRoles);
  const claimId = norm(body.claimId);
  const transition = norm(body.transition);
  const reason = norm(body.reason).slice(0, 1000);
  const expectedVersion = Number(body.expectedVersion);
  const coverageStatus = norm(body.coverageStatus);

  if (!validRequestId(requestId)) throw new Error("INVALID_REQUEST_ID");
  if (!validIdempotencyKey(idempotencyKey)) throw new Error("INVALID_IDEMPOTENCY_KEY");
  if (!validUuid(claimId)) throw new Error("INVALID_CLAIM_ID");
  if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) throw new Error("INVALID_CLAIM_VERSION");
  if (!["approve", "deny", "cancel", "claim"].includes(transition)) throw new Error("INVALID_CLAIM_ACTION");

  const owner = hasRole(roles, OWNER_ROLE);
  if (["approve", "deny", "claim"].includes(transition) && !owner) throw new Error("OWNER_REQUIRED");
  if (!actorId || roles.length === 0) throw new Error("ACCESS_DENIED");

  return await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`reward-claim-id:${tenant.clinicId}:${claimId}`}))`;
    const eventKey = `claim:${claimId}:${transition}:${idempotencyKey}`;
    const already = await tx`
      select state_version from relife.reward_redemption_events
      where organization_id = ${tenant.organizationId}::uuid
        and clinic_id = ${tenant.clinicId}::uuid and event_key = ${eventKey}
      limit 1
    `;
    if (already[0]) {
      const current = await tx`
        select status, state_version from relife.reward_redemptions
        where organization_id = ${tenant.organizationId}::uuid
          and clinic_id = ${tenant.clinicId}::uuid and id = ${claimId}::uuid limit 1
      `;
      return { claimId, status: norm(current[0]?.status), stateVersion: Number(current[0]?.state_version || already[0].state_version), duplicate: true };
    }

    const rows = await tx`
      select * from relife.reward_redemptions
      where organization_id = ${tenant.organizationId}::uuid
        and clinic_id = ${tenant.clinicId}::uuid and id = ${claimId}::uuid
      for update
    `;
    const claim = rows[0];
    if (!claim) throw new Error("CLAIM_NOT_FOUND");
    const staffId = norm(claim.staff_id);
    const department = norm(claim.department);
    const status = norm(claim.status);
    const stateVersion = Number(claim.state_version || 1);
    const cost = Number(claim.credit_cost || 0);
    const policy = objectValue(claim.policy_snapshot);
    const coverageRequired = policy.coverageRequired === true;

    if (transition === "cancel" && actorId !== staffId && !owner) throw new Error("ACCESS_DENIED");
    if (stateVersion !== expectedVersion) throw new Error("STALE_CLAIM_VERSION");

    const validState =
      (transition === "approve" && status === "pending") ||
      (transition === "deny" && status === "pending") ||
      (transition === "cancel" && OPEN_STATUSES.has(status)) ||
      (transition === "claim" && status === "approved");
    if (!validState) throw new Error("INVALID_CLAIM_STATE");

    if (transition === "approve" && coverageRequired) {
      if (coverageStatus === "unavailable") throw new Error("COVERAGE_UNAVAILABLE");
      if (coverageStatus !== "available") throw new Error("COVERAGE_REQUIRED");
    }

    const reservation = await tx`
      select id::text, credit_amount::numeric
      from relife.reward_credit_ledger
      where organization_id = ${tenant.organizationId}::uuid
        and clinic_id = ${tenant.clinicId}::uuid
        and redemption_id = ${claimId}::uuid
        and entry_type = 'reserved'
      order by created_at asc limit 1
    `;
    const reserveEntryId = norm(reservation[0]?.id);
    if (!reserveEntryId || Number(reservation[0]?.credit_amount || 0) !== cost) {
      throw new Error("CLAIM_RESERVATION_INVALID");
    }
    const releaseOrRedeem = await tx`
      select entry_type from relife.reward_credit_ledger
      where organization_id = ${tenant.organizationId}::uuid
        and clinic_id = ${tenant.clinicId}::uuid
        and redemption_id = ${claimId}::uuid
        and entry_type in ('released','redeemed')
      limit 1
    `;
    if (releaseOrRedeem[0]) throw new Error("CLAIM_RESERVATION_INVALID");

    const nextVersion = stateVersion + 1;
    let nextStatus = status;
    let ledgerEntryId: string | null = null;

    if (transition === "approve") {
      nextStatus = "approved";
      await tx`
        update relife.reward_redemptions set
          status = 'approved',
          coverage_status = ${coverageRequired ? "available" : norm(claim.coverage_status)},
          owner_decision_by = ${actorId}, owner_decision_at = now(),
          decision_reason = ${reason}, state_version = ${nextVersion}, updated_at = now()
        where organization_id = ${tenant.organizationId}::uuid
          and clinic_id = ${tenant.clinicId}::uuid and id = ${claimId}::uuid
      `;
    } else if (transition === "deny" || transition === "cancel") {
      nextStatus = transition === "deny" ? "denied" : "cancelled";
      const ledger = await tx`
        insert into relife.reward_credit_ledger(
          organization_id, clinic_id, staff_id, department, entry_type,
          credit_amount, source_type, source_id, redemption_id, related_entry_id,
          idempotency_key, reason, created_by
        ) values (
          ${tenant.organizationId}::uuid, ${tenant.clinicId}::uuid,
          ${staffId}, ${department}, 'released', ${cost}, 'reward_claim',
          ${claimId}, ${claimId}::uuid, ${reserveEntryId}::uuid,
          ${`claim:${claimId}:release:v${nextVersion}`},
          ${reason || (transition === "deny" ? "Reward claim denied" : "Reward claim cancelled")}, ${actorId}
        ) returning id::text
      `;
      ledgerEntryId = norm(ledger[0]?.id);
      await tx`
        update relife.reward_redemptions set
          status = ${nextStatus},
          owner_decision_by = case when ${transition} = 'deny' then ${actorId} else owner_decision_by end,
          owner_decision_at = case when ${transition} = 'deny' then now() else owner_decision_at end,
          decision_reason = ${reason},
          cancelled_at = case when ${transition} = 'cancel' then now() else cancelled_at end,
          state_version = ${nextVersion}, updated_at = now()
        where organization_id = ${tenant.organizationId}::uuid
          and clinic_id = ${tenant.clinicId}::uuid and id = ${claimId}::uuid
      `;
    } else if (transition === "claim") {
      nextStatus = "claimed";
      const ledger = await tx`
        insert into relife.reward_credit_ledger(
          organization_id, clinic_id, staff_id, department, entry_type,
          credit_amount, source_type, source_id, redemption_id, related_entry_id,
          idempotency_key, reason, created_by
        ) values (
          ${tenant.organizationId}::uuid, ${tenant.clinicId}::uuid,
          ${staffId}, ${department}, 'redeemed', ${cost}, 'reward_claim',
          ${claimId}, ${claimId}::uuid, ${reserveEntryId}::uuid,
          ${`claim:${claimId}:redeem:v${nextVersion}`},
          ${reason || "Reward claim fulfilled"}, ${actorId}
        ) returning id::text
      `;
      ledgerEntryId = norm(ledger[0]?.id);
      await tx`
        update relife.reward_redemptions set
          status = 'claimed', claimed_at = now(), claimed_by = ${actorId},
          decision_reason = case when ${reason} <> '' then ${reason} else decision_reason end,
          state_version = ${nextVersion}, updated_at = now()
        where organization_id = ${tenant.organizationId}::uuid
          and clinic_id = ${tenant.clinicId}::uuid and id = ${claimId}::uuid
      `;
    }

    const eventType = transition === "approve" ? "approved" : transition === "deny" ? "denied" : transition === "cancel" ? "cancelled" : "claimed";
    await tx`
      insert into relife.reward_redemption_events(
        organization_id, clinic_id, redemption_id, staff_id, department,
        event_type, state_version, event_key, actor_id, reason, payload
      ) values (
        ${tenant.organizationId}::uuid, ${tenant.clinicId}::uuid,
        ${claimId}::uuid, ${staffId}, ${department}, ${eventType}, ${nextVersion},
        ${eventKey}, ${actorId}, ${reason},
        ${JSON.stringify({ previousStatus: status, nextStatus, coverageStatus: transition === "approve" ? (coverageRequired ? "available" : norm(claim.coverage_status)) : norm(claim.coverage_status), ledgerEntryId })}::jsonb
      )
    `;
    await audit(tx, {
      tenant, requestId, actorId, action: `gamification.reward_claim.${transition}`,
      claimId, staffId,
      payload: { previousStatus: status, nextStatus, stateVersion: nextVersion, creditCost: cost, ledgerEntryId },
    });

    const balance = await creditBalance(tx, tenant, staffId);
    return {
      claimId, status: nextStatus, stateVersion: nextVersion, duplicate: false,
      rewardCredits: balance,
      settlementRequired: transition === "claim" && ["voucher", "treat"].includes(norm(claim.redemption_type)),
    };
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!(await authorized(req))) return response({ ok: false, error: "ACCESS_DENIED" }, 401);

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const tenant = await resolveTenant(body);
    const action = norm(body.action);

    if (action === "health") {
      const rows = await sql`
        select
          (select count(*)::int from relife.reward_redemptions where organization_id = ${tenant.organizationId}::uuid and clinic_id = ${tenant.clinicId}::uuid) as claims,
          (select count(*)::int from relife.reward_redemptions where organization_id = ${tenant.organizationId}::uuid and clinic_id = ${tenant.clinicId}::uuid and status = 'pending') as pending_claims,
          (select count(*)::int from relife.reward_redemption_events where organization_id = ${tenant.organizationId}::uuid and clinic_id = ${tenant.clinicId}::uuid) as claim_events,
          (select count(*)::int from relife.reward_credit_ledger where organization_id = ${tenant.organizationId}::uuid and clinic_id = ${tenant.clinicId}::uuid) as rc_entries
      `;
      return response({ ok: true, tenant, counts: rows[0] || {} });
    }
    if (action === "claims_list") return response({ ok: true, tenant, claims: await listClaims(tenant, body) });
    if (action === "claim_request") return response({ ok: true, tenant, ...(await requestClaim(tenant, body)) });
    if (action === "claim_action") return response({ ok: true, tenant, ...(await transitionClaim(tenant, body)) });
    return response({ ok: false, error: "INVALID_ACTION" }, 400);
  } catch (error) {
    console.error("relife-reward-claims-api", error);
    const message = error instanceof Error ? error.message : "EDGE_FAILED";
    return response({ ok: false, error: message }, errorStatus(message));
  }
});
