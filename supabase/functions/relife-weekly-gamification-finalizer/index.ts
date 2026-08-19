import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
if (!dbUrl) throw new Error("SUPABASE_DB_URL missing");
const sql = postgres(dbUrl, { prepare: false, max: 3, idle_timeout: 20 });

const APP_KEY_HASHES = new Set([
  "50840a8a74de86a912cb2a268ff6d24b2a9fc3cf4ab016229e52d3219a3772fe",
  "340a6b07dbfe883d2ecad82971bb4226a32974c00e89138ad71e8279a89e58d2",
]);
const CRON_KEY_HASH = "a283612e2cdd1350bb2b4e85a92b36f717388565020e4cb4d8ef22b6b092e3d4";
const DEFAULT_ORGANIZATION_SLUG = "relife";
const DEFAULT_CLINIC_SLUG = "amtali-main";
const SUPPORTED_ROLES = new Set(["Therapist", "Receptionist"]);
const SUPPORTED_DEPARTMENTS = new Set(["Physio", "Dental"]);

type AuthKind = "app" | "cron" | null;
type Tenant = { organizationId: string; clinicId: string };
type WeeklyRole = "Therapist" | "Receptionist";
type RolePolicy = {
  role: WeeklyRole;
  version: number;
  weights: Record<string, number>;
  targets: Record<string, number>;
  raw: Record<string, unknown>;
};
type EarningTier = { minScore: number; rewardCredits: number };
type EarningPolicy = {
  version: number | null;
  enabled: boolean;
  roles: Partial<Record<WeeklyRole, EarningTier[]>>;
  raw: Record<string, unknown>;
};
type EventCounts = Record<string, number>;
type ScoreComponent = {
  score: number | null;
  numerator: number | null;
  denominator: number | null;
  source: string;
  verified: boolean;
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

function numberMap(value: unknown): Record<string, number> | null {
  const object = objectValue(value);
  const output: Record<string, number> = {};
  for (const [key, raw] of Object.entries(object)) {
    const number = Number(raw);
    if (!Number.isFinite(number) || number < 0) return null;
    output[key] = number;
  }
  return output;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function validDateKey(value: unknown): string {
  const text = norm(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("INVALID_WEEK_START");
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error("INVALID_WEEK_START");
  }
  if (parsed.getUTCDay() !== 1) throw new Error("WEEK_START_MUST_BE_MONDAY");
  return text;
}

function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKey(date);
}

function todayDhaka(ref = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ref);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function weekForDate(value: string): { start: string; end: string } {
  const date = new Date(`${value}T00:00:00Z`);
  const weekday = date.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  date.setUTCDate(date.getUTCDate() + mondayOffset);
  const start = dateKey(date);
  return { start, end: addDays(start, 6) };
}

function previousWeek(): { start: string; end: string } {
  const current = weekForDate(todayDhaka());
  const end = addDays(current.start, -1);
  return { start: addDays(end, -6), end };
}

function sourceCutoffForWeekEnd(weekEnd: string): string {
  // Bangladesh is UTC+06 year-round. Sunday 23:59:59.999 Asia/Dhaka.
  return `${weekEnd}T17:59:59.999Z`;
}

function validFinishedWeek(start: string, cutoff: string): void {
  if (Date.parse(cutoff) >= Date.now()) throw new Error("WEEK_NOT_FINISHED");
  if (addDays(start, 6) !== cutoff.slice(0, 10)) {
    throw new Error("INVALID_WEEK_RANGE");
  }
}

async function sha256Hex(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function authKind(req: Request): Promise<AuthKind> {
  const key = req.headers.get("x-relife-server-key") || "";
  if (!key) return null;
  const hash = await sha256Hex(key);
  if (hash === CRON_KEY_HASH) return "cron";
  return APP_KEY_HASHES.has(hash) ? "app" : null;
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
  return {
    organizationId: norm(rows[0].organization_id),
    clinicId: norm(rows[0].clinic_id),
  };
}

async function configAt(
  tx: any,
  tenant: Tenant,
  department: string,
  key: string,
  cutoff: string
): Promise<{ version: number; value: Record<string, unknown> } | null> {
  const rows = await tx`
    select version, config_value
    from relife.gamification_config
    where clinic_id = ${tenant.clinicId}::uuid
      and config_key = ${key}
      and status in ('active','archived')
      and department in ('All', ${department})
      and effective_from <= ${cutoff}::timestamptz
      and (effective_until is null or effective_until > ${cutoff}::timestamptz)
    order by
      case when department = ${department} then 0 else 1 end,
      version desc,
      effective_from desc
    limit 1
  `;
  if (!rows[0]) return null;
  return {
    version: Number(rows[0].version || 0),
    value: objectValue(rows[0].config_value),
  };
}

function parseRolePolicy(
  role: WeeklyRole,
  row: { version: number; value: Record<string, unknown> } | null
): RolePolicy | null {
  if (!row || row.value.enabled !== true || Number(row.value.scale) !== 100) return null;
  const weights = numberMap(row.value.weights);
  const targets = numberMap(row.value.targets) || {};
  if (!weights || Object.keys(weights).length === 0) return null;
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 0.0001) return null;
  for (const weight of Object.values(weights)) {
    if (weight <= 0 || weight > 1) return null;
  }
  return { role, version: row.version, weights, targets, raw: row.value };
}

function parseEarningPolicy(
  row: { version: number; value: Record<string, unknown> } | null
): EarningPolicy {
  if (!row) return { version: null, enabled: false, roles: {}, raw: {} };
  const rolesObject = objectValue(row.value.roles);
  const roles: Partial<Record<WeeklyRole, EarningTier[]>> = {};
  for (const role of ["Therapist", "Receptionist"] as const) {
    const rawTiers = Array.isArray(rolesObject[role]) ? rolesObject[role] as unknown[] : [];
    const tiers = rawTiers.flatMap((raw) => {
      const item = objectValue(raw);
      const minScore = Number(item.min_score ?? item.minScore);
      const rewardCredits = Number(item.rc ?? item.reward_credits ?? item.rewardCredits);
      if (
        !Number.isFinite(minScore) || minScore < 0 || minScore > 100 ||
        !Number.isFinite(rewardCredits) || rewardCredits < 0
      ) return [];
      return [{ minScore, rewardCredits }];
    }).sort((a, b) => b.minScore - a.minScore);
    roles[role] = tiers;
  }
  return {
    version: row.version,
    enabled: row.value.enabled === true && norm(row.value.mode) === "score_tiers",
    roles,
    raw: row.value,
  };
}

function target(policy: RolePolicy, key: string): number | null {
  const value = policy.targets[key];
  return Number.isFinite(value) && value > 0 ? value : null;
}

function percentOfTarget(actual: number, denominator: number | null): number | null {
  if (denominator === null || denominator <= 0) return null;
  return round2(Math.min(100, (Math.max(0, actual) / denominator) * 100));
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return round2(Math.min(100, (Math.max(0, numerator) / denominator) * 100));
}

function metric(
  score: number | null,
  numerator: number | null,
  denominator: number | null,
  source: string
): ScoreComponent {
  return { score, numerator, denominator, source, verified: score !== null };
}

function componentsFor(
  role: WeeklyRole,
  policy: RolePolicy,
  counts: EventCounts
): Record<string, ScoreComponent> {
  const onTime = counts.attendance_on_time || 0;
  const attendanceTotal = onTime + (counts.attendance_check_in || 0);
  if (role === "Therapist") {
    const completed = counts.session_completed || 0;
    const documented = Math.min(counts.treatment_documented || 0, completed);
    const sessionsTarget = target(policy, "sessions_per_week");
    return {
      productivity: metric(
        percentOfTarget(completed, sessionsTarget),
        completed,
        sessionsTarget,
        "performance_events:session_completed"
      ),
      attendance: metric(
        ratio(onTime, attendanceTotal),
        onTime,
        attendanceTotal,
        "performance_events:attendance_on_time|attendance_check_in"
      ),
      documentation: metric(
        ratio(documented, completed),
        documented,
        completed,
        "performance_events:treatment_documented"
      ),
      quality: metric(null, null, null, "verified_source_missing"),
      reliability: metric(null, null, null, "verified_source_missing"),
    };
  }

  const workflow =
    (counts.patient_registered || 0) +
    (counts.payment_processed || 0) +
    (counts.appointment_booked || 0);
  const workflowTarget = target(policy, "workflow_transactions_per_week");
  const cashExact = counts.cash_reconciliation_exact || 0;
  const cashTotal = cashExact + (counts.cash_reconciliation_mismatch || 0);
  return {
    workflow: metric(
      percentOfTarget(workflow, workflowTarget),
      workflow,
      workflowTarget,
      "performance_events:patient_registered|payment_processed|appointment_booked"
    ),
    cash_accuracy: metric(
      ratio(cashExact, cashTotal),
      cashExact,
      cashTotal,
      "performance_events:cash_reconciliation_exact|cash_reconciliation_mismatch"
    ),
    appointment_accuracy: metric(null, null, null, "verified_source_missing"),
    attendance: metric(
      ratio(onTime, attendanceTotal),
      onTime,
      attendanceTotal,
      "performance_events:attendance_on_time|attendance_check_in"
    ),
    error_control: metric(null, null, null, "verified_source_missing"),
  };
}

function calculateScore(
  policy: RolePolicy,
  components: Record<string, ScoreComponent>
): {
  officialScore: number | null;
  provisionalScore: number | null;
  coveredWeight: number;
  missingMetrics: string[];
} {
  let total = 0;
  let coveredWeight = 0;
  const missingMetrics: string[] = [];
  for (const [key, weight] of Object.entries(policy.weights)) {
    const value = components[key]?.score;
    if (value === null || value === undefined) {
      missingMetrics.push(key);
      continue;
    }
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      missingMetrics.push(key);
      continue;
    }
    total += value * weight;
    coveredWeight += weight;
  }
  const provisionalScore = coveredWeight > 0 ? round2(total / coveredWeight) : null;
  return {
    officialScore: missingMetrics.length === 0 ? round2(total) : null,
    provisionalScore,
    coveredWeight: round2(coveredWeight),
    missingMetrics,
  };
}

function rewardForScore(
  role: WeeklyRole,
  score: number | null,
  policy: EarningPolicy
): { amount: number; matchedMinScore: number | null } {
  if (!policy.enabled || score === null) return { amount: 0, matchedMinScore: null };
  const matched = (policy.roles[role] || []).find((tier) => score >= tier.minScore) || null;
  return matched
    ? { amount: matched.rewardCredits, matchedMinScore: matched.minScore }
    : { amount: 0, matchedMinScore: null };
}

async function audit(
  tx: any,
  input: {
    tenant: Tenant;
    requestId: string;
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    payload: Record<string, unknown>;
  }
) {
  await tx`
    insert into relife.audit_events(
      organization_id, clinic_id, request_id, actor_id, action,
      entity_type, entity_id, patient_id, payload
    ) values (
      ${input.tenant.organizationId}::uuid,
      ${input.tenant.clinicId}::uuid,
      ${input.requestId}, ${input.actorId}, ${input.action},
      ${input.entityType}, ${input.entityId}, '',
      ${JSON.stringify(input.payload)}::jsonb
    )
  `;
}

async function finalizationStatus(
  tenant: Tenant,
  weekStart?: string
): Promise<Record<string, unknown>> {
  const rows = weekStart
    ? await sql`
        select finalization_id::text, week_start::text, week_end::text,
          finalization_key, source_cutoff_at, status, trigger_source,
          requested_by, result_summary, created_at, finalized_at
        from relife.weekly_gamification_finalizations
        where clinic_id = ${tenant.clinicId}::uuid
          and week_start = ${weekStart}::date
        limit 1
      `
    : await sql`
        select finalization_id::text, week_start::text, week_end::text,
          finalization_key, source_cutoff_at, status, trigger_source,
          requested_by, result_summary, created_at, finalized_at
        from relife.weekly_gamification_finalizations
        where clinic_id = ${tenant.clinicId}::uuid
        order by week_start desc
        limit 1
      `;
  if (!rows[0]) return { finalization: null };
  const row = rows[0];
  const performance = await sql`
    select id::text, staff_id, department, role_context,
      normalized_score::numeric, provisional_score::numeric,
      score_covered_weight::numeric, missing_score_metrics,
      ranking_position, reward_credits_earned::numeric,
      eligibility_reason, score_config_version, earning_config_version,
      score_components, source_cutoff_at
    from relife.weekly_performance
    where clinic_id = ${tenant.clinicId}::uuid
      and finalization_id = ${norm(row.finalization_id)}::uuid
    order by ranking_position nulls last, provisional_score desc nulls last, staff_id
  `;
  return {
    finalization: {
      finalizationId: norm(row.finalization_id),
      weekStart: norm(row.week_start),
      weekEnd: norm(row.week_end),
      finalizationKey: norm(row.finalization_key),
      sourceCutoffAt: row.source_cutoff_at,
      status: norm(row.status),
      triggerSource: norm(row.trigger_source),
      requestedBy: norm(row.requested_by),
      resultSummary: row.result_summary || {},
      createdAt: row.created_at,
      finalizedAt: row.finalized_at,
      performance: performance.map((item) => ({
        id: norm(item.id),
        staffId: norm(item.staff_id),
        department: norm(item.department),
        roleContext: norm(item.role_context),
        normalizedScore: item.normalized_score === null ? null : Number(item.normalized_score),
        provisionalScore: item.provisional_score === null ? null : Number(item.provisional_score),
        scoreCoveredWeight: Number(item.score_covered_weight || 0),
        missingScoreMetrics: Array.isArray(item.missing_score_metrics) ? item.missing_score_metrics : [],
        rank: item.ranking_position === null ? null : Number(item.ranking_position),
        rewardCreditsEarned: Number(item.reward_credits_earned || 0),
        eligibilityReason: norm(item.eligibility_reason),
        scoreConfigVersion: item.score_config_version === null ? null : Number(item.score_config_version),
        earningConfigVersion: item.earning_config_version === null ? null : Number(item.earning_config_version),
        scoreComponents: item.score_components || {},
        sourceCutoffAt: item.source_cutoff_at,
      })),
    },
  };
}

async function finalizeWeek(
  tenant: Tenant,
  input: {
    weekStart: string;
    trigger: "cron" | "owner_manual" | "system_recovery";
    actorId: string;
  }
): Promise<Record<string, unknown>> {
  const weekStart = validDateKey(input.weekStart);
  const weekEnd = addDays(weekStart, 6);
  const cutoff = sourceCutoffForWeekEnd(weekEnd);
  validFinishedWeek(weekStart, cutoff);
  const finalizationKey = `weekly:${tenant.clinicId}:${weekStart}:v2`;

  return await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${finalizationKey}))`;

    const existing = await tx`
      select finalization_id::text, status, result_summary
      from relife.weekly_gamification_finalizations
      where clinic_id = ${tenant.clinicId}::uuid
        and finalization_key = ${finalizationKey}
      limit 1
    `;
    if (existing[0]?.status === "finalized") {
      await audit(tx, {
        tenant,
        requestId: `gam-week-retry-${weekStart}`,
        actorId: input.actorId,
        action: "gamification.weekly.already_finalized",
        entityType: "WeeklyGamificationFinalization",
        entityId: norm(existing[0].finalization_id),
        payload: { weekStart, weekEnd, finalizationKey, trigger: input.trigger },
      });
      return {
        alreadyFinalized: true,
        finalizationId: norm(existing[0].finalization_id),
        weekStart,
        weekEnd,
        resultSummary: existing[0].result_summary || {},
      };
    }

    const legacyFinal = await tx`
      select id::text
      from relife.weekly_performance
      where clinic_id = ${tenant.clinicId}::uuid
        and week_start = ${weekStart}::date
        and status = 'final'
        and finalization_id is null
      limit 1
    `;
    if (legacyFinal[0]) throw new Error("LEGACY_FINAL_WEEK_EXISTS");

    const earningRow = await configAt(
      tx,
      tenant,
      "All",
      "reward.weekly_score_tiers",
      cutoff
    );
    const earning = parseEarningPolicy(earningRow);

    const finalizationRows = await tx`
      insert into relife.weekly_gamification_finalizations(
        organization_id, clinic_id, week_start, week_end,
        finalization_key, source_cutoff_at, config_snapshot,
        trigger_source, requested_by, status
      ) values (
        ${tenant.organizationId}::uuid,
        ${tenant.clinicId}::uuid,
        ${weekStart}::date,
        ${weekEnd}::date,
        ${finalizationKey},
        ${cutoff}::timestamptz,
        ${JSON.stringify({
          earningConfigVersion: earning.version,
          earningConfig: earning.raw,
          configResolvedAtWeekCutoff: true,
        })}::jsonb,
        ${input.trigger},
        ${input.actorId},
        'running'
      )
      on conflict (clinic_id, finalization_key) do update
        set requested_by = excluded.requested_by
      returning finalization_id::text
    `;
    const finalizationId = norm(finalizationRows[0]?.finalization_id);
    if (!finalizationId) throw new Error("FINALIZATION_INSERT_FAILED");

    const eventRows = await tx`
      select staff_id, department, role_context, event_type, count(*)::int as event_count
      from relife.performance_events
      where clinic_id = ${tenant.clinicId}::uuid
        and role_context in ('Therapist','Receptionist')
        and department in ('Physio','Dental')
        and (event_at at time zone 'Asia/Dhaka')::date
          between ${weekStart}::date and ${weekEnd}::date
        and event_at <= ${cutoff}::timestamptz
      group by staff_id, department, role_context, event_type
      order by staff_id, department, role_context, event_type
    `;

    const xpRows = await tx`
      select x.staff_id, coalesce(sum(x.xp_awarded), 0)::numeric as xp_earned
      from relife.xp_ledger x
      join relife.performance_events e
        on e.id = x.performance_event_id
       and e.organization_id = x.organization_id
       and e.clinic_id = x.clinic_id
      where x.clinic_id = ${tenant.clinicId}::uuid
        and (e.event_at at time zone 'Asia/Dhaka')::date
          between ${weekStart}::date and ${weekEnd}::date
        and e.event_at <= ${cutoff}::timestamptz
      group by x.staff_id
    `;
    const xpByStaff = new Map(
      xpRows.map((row) => [norm(row.staff_id), Number(row.xp_earned || 0)])
    );

    const byStaff = new Map<string, Array<Record<string, unknown>>>();
    for (const row of eventRows) {
      const staffId = norm(row.staff_id);
      const list = byStaff.get(staffId) || [];
      list.push(row as Record<string, unknown>);
      byStaff.set(staffId, list);
    }

    let scored = 0;
    let incomplete = 0;
    let awarded = 0;
    let awardedCredits = 0;
    let ambiguous = 0;

    for (const [staffId, rows] of byStaff) {
      const roles = [...new Set(rows.map((row) => norm(row.role_context)).filter((role) => SUPPORTED_ROLES.has(role)))];
      const departments = [...new Set(rows.map((row) => norm(row.department)).filter((department) => SUPPORTED_DEPARTMENTS.has(department)))];
      if (roles.length !== 1 || departments.length !== 1) {
        ambiguous += 1;
        await audit(tx, {
          tenant,
          requestId: `gam-week-${weekStart}-${staffId}`,
          actorId: input.actorId,
          action: "gamification.weekly.staff_skipped",
          entityType: "Staff",
          entityId: staffId,
          payload: {
            weekStart,
            weekEnd,
            reason: "single_scoring_role_required",
            roles,
            departments,
            finalizationId,
          },
        });
        continue;
      }

      const role = roles[0] as WeeklyRole;
      const department = departments[0];
      const counts: EventCounts = {};
      for (const row of rows) {
        if (norm(row.role_context) !== role || norm(row.department) !== department) continue;
        counts[norm(row.event_type)] = Number(row.event_count || 0);
      }

      const roleKey = `score.role.${role.toLowerCase()}`;
      const roleConfigRow = await configAt(tx, tenant, department, roleKey, cutoff);
      const rolePolicy = parseRolePolicy(role, roleConfigRow);
      let officialScore: number | null = null;
      let provisionalScore: number | null = null;
      let coveredWeight = 0;
      let missingMetrics: string[] = ["role_config_or_verified_sources"];
      let components: Record<string, ScoreComponent> = {};
      let eligibilityReason = "not_eligible_role_config";

      if (rolePolicy) {
        components = componentsFor(role, rolePolicy, counts);
        const score = calculateScore(rolePolicy, components);
        officialScore = score.officialScore;
        provisionalScore = score.provisionalScore;
        coveredWeight = score.coveredWeight;
        missingMetrics = score.missingMetrics;
        eligibilityReason = officialScore === null
          ? "not_eligible_incomplete_score"
          : "not_eligible_earning_disabled";
      }

      const reward = rewardForScore(role, officialScore, earning);
      if (officialScore !== null) {
        scored += 1;
        if (!earning.enabled) {
          eligibilityReason = "not_eligible_earning_disabled";
        } else if (reward.amount <= 0) {
          eligibilityReason = "not_eligible_no_tier";
        } else {
          eligibilityReason = "eligible";
        }
      } else {
        incomplete += 1;
      }

      const scoreComponents = {
        metrics: components,
        coverage: {
          coveredWeight,
          missingMetrics,
          complete: officialScore !== null,
        },
        eventCounts: counts,
        sourceCutoffAt: cutoff,
      };
      const rowConfigSnapshot = {
        scoreConfigVersion: rolePolicy?.version ?? null,
        scoreConfig: rolePolicy?.raw ?? {},
        earningConfigVersion: earning.version,
        earningRoleTiers: earning.roles[role] || [],
        configResolvedAtWeekCutoff: true,
      };

      const performanceRows = await tx`
        insert into relife.weekly_performance(
          organization_id, clinic_id, staff_id, department, role_context,
          week_start, week_end, normalized_score, provisional_score,
          score_covered_weight, missing_score_metrics, score_components,
          xp_earned, ranking_position, reward_credits_earned,
          calculation_version, status, calculated_at, finalized_at,
          finalization_id, score_config_version, earning_config_version,
          config_snapshot, source_cutoff_at, eligibility_reason
        ) values (
          ${tenant.organizationId}::uuid,
          ${tenant.clinicId}::uuid,
          ${staffId}, ${department}, ${role},
          ${weekStart}::date, ${weekEnd}::date,
          ${officialScore}, ${provisionalScore},
          ${coveredWeight}, ${JSON.stringify(missingMetrics)}::jsonb,
          ${JSON.stringify(scoreComponents)}::jsonb,
          ${xpByStaff.get(staffId) || 0}, null, 0,
          ${`v2:weekly-finalizer:${rolePolicy?.version ?? "no-config"}`},
          'final', now(), now(),
          ${finalizationId}::uuid,
          ${rolePolicy?.version ?? null}, ${earning.version},
          ${JSON.stringify(rowConfigSnapshot)}::jsonb,
          ${cutoff}::timestamptz,
          ${eligibilityReason}
        )
        on conflict (clinic_id, week_start, staff_id) do update set
          department = excluded.department,
          role_context = excluded.role_context,
          week_end = excluded.week_end,
          normalized_score = excluded.normalized_score,
          provisional_score = excluded.provisional_score,
          score_covered_weight = excluded.score_covered_weight,
          missing_score_metrics = excluded.missing_score_metrics,
          score_components = excluded.score_components,
          xp_earned = excluded.xp_earned,
          ranking_position = null,
          reward_credits_earned = 0,
          calculation_version = excluded.calculation_version,
          status = 'final',
          calculated_at = now(),
          finalized_at = now(),
          finalization_id = excluded.finalization_id,
          score_config_version = excluded.score_config_version,
          earning_config_version = excluded.earning_config_version,
          config_snapshot = excluded.config_snapshot,
          source_cutoff_at = excluded.source_cutoff_at,
          eligibility_reason = excluded.eligibility_reason,
          updated_at = now()
        where relife.weekly_performance.finalization_id is null
          and relife.weekly_performance.status <> 'final'
        returning id::text
      `;
      const weeklyPerformanceId = norm(performanceRows[0]?.id);
      if (!weeklyPerformanceId) throw new Error("WEEKLY_PERFORMANCE_ALREADY_FINALIZED");

      if (eligibilityReason === "eligible" && reward.amount > 0) {
        const scoreSnapshot = {
          weekStart,
          weekEnd,
          role,
          department,
          officialScore,
          scoreConfigVersion: rolePolicy?.version ?? null,
          earningConfigVersion: earning.version,
          matchedMinScore: reward.matchedMinScore,
          finalizationId,
        };
        const ledgerRows = await tx`
          insert into relife.reward_credit_ledger(
            organization_id, clinic_id, staff_id, department,
            entry_type, credit_amount, source_type, source_id,
            redemption_id, related_entry_id, idempotency_key,
            reason, created_by, weekly_performance_id, score_snapshot
          ) values (
            ${tenant.organizationId}::uuid,
            ${tenant.clinicId}::uuid,
            ${staffId}, ${department},
            'earned', ${reward.amount}, 'weekly_score_tier', ${weeklyPerformanceId},
            null, null,
            ${`weekly-score-tier:${weeklyPerformanceId}:v1`},
            ${`Weekly ${role} score ${officialScore}`},
            'weekly_gamification_finalizer',
            ${weeklyPerformanceId}::uuid,
            ${JSON.stringify(scoreSnapshot)}::jsonb
          )
          on conflict (clinic_id, idempotency_key) do nothing
          returning id::text
        `;
        if (ledgerRows[0]) {
          awarded += 1;
          awardedCredits += reward.amount;
        }
        await tx`
          update relife.weekly_performance
          set reward_credits_earned = ${reward.amount}, updated_at = now()
          where id = ${weeklyPerformanceId}::uuid
        `;
      }

      await audit(tx, {
        tenant,
        requestId: `gam-week-${weekStart}-${staffId}`,
        actorId: input.actorId,
        action: "gamification.weekly.score_snapshot",
        entityType: "WeeklyPerformance",
        entityId: weeklyPerformanceId,
        payload: {
          weekStart,
          weekEnd,
          role,
          department,
          officialScore,
          provisionalScore,
          coveredWeight,
          missingMetrics,
          eligibilityReason,
          rewardCredits: reward.amount,
          scoreConfigVersion: rolePolicy?.version ?? null,
          earningConfigVersion: earning.version,
          finalizationId,
          sourceCutoffAt: cutoff,
        },
      });
    }

    await tx`
      update relife.weekly_performance
      set ranking_position = null, updated_at = now()
      where clinic_id = ${tenant.clinicId}::uuid
        and finalization_id = ${finalizationId}::uuid
    `;
    await tx`
      with ranked as (
        select id,
          dense_rank() over (order by normalized_score desc) as rank
        from relife.weekly_performance
        where clinic_id = ${tenant.clinicId}::uuid
          and finalization_id = ${finalizationId}::uuid
          and normalized_score is not null
      )
      update relife.weekly_performance p
      set ranking_position = ranked.rank, updated_at = now()
      from ranked
      where p.id = ranked.id
    `;

    const summary = {
      staffCandidates: byStaff.size,
      officialScores: scored,
      incompleteScores: incomplete,
      ambiguousStaff: ambiguous,
      rewardAwards: awarded,
      rewardCreditsAwarded: awardedCredits,
      earningEnabled: earning.enabled,
      earningConfigVersion: earning.version,
    };
    await tx`
      update relife.weekly_gamification_finalizations
      set status = 'finalized', result_summary = ${JSON.stringify(summary)}::jsonb,
          finalized_at = now()
      where finalization_id = ${finalizationId}::uuid
    `;
    await audit(tx, {
      tenant,
      requestId: `gam-week-finalize-${weekStart}`,
      actorId: input.actorId,
      action: "gamification.weekly.finalized",
      entityType: "WeeklyGamificationFinalization",
      entityId: finalizationId,
      payload: { weekStart, weekEnd, finalizationKey, sourceCutoffAt: cutoff, ...summary },
    });

    return {
      alreadyFinalized: false,
      finalizationId,
      weekStart,
      weekEnd,
      resultSummary: summary,
    };
  });
}

function errorStatus(message: string): number {
  if (message === "ACCESS_DENIED" || message === "OWNER_REQUIRED") return 403;
  if (message === "FINALIZATION_NOT_FOUND") return 404;
  if (
    message.startsWith("INVALID_") ||
    message === "WEEK_START_MUST_BE_MONDAY" ||
    message === "WEEK_NOT_FINISHED"
  ) return 400;
  if (
    message === "LEGACY_FINAL_WEEK_EXISTS" ||
    message === "WEEKLY_PERFORMANCE_ALREADY_FINALIZED"
  ) return 409;
  return 500;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }
  const auth = await authKind(req);
  if (!auth) return response({ ok: false, error: "ACCESS_DENIED" }, 401);

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = norm(body.action || "health");
    const tenant = await resolveTenant(body);

    if (action === "health") {
      return response({ ok: true, tenant, authKind: auth });
    }

    if (action === "status") {
      if (auth !== "app") throw new Error("ACCESS_DENIED");
      const weekStart = norm(body.weekStart);
      if (weekStart) validDateKey(weekStart);
      return response({ ok: true, tenant, ...(await finalizationStatus(tenant, weekStart || undefined)) });
    }

    if (action !== "finalize_previous_week" && action !== "finalize_week") {
      return response({ ok: false, error: "INVALID_ACTION" }, 400);
    }

    const triggerText = norm(body.trigger || (auth === "cron" ? "cron" : "owner_manual"));
    const trigger = triggerText === "cron"
      ? "cron"
      : triggerText === "system_recovery"
        ? "system_recovery"
        : "owner_manual";
    const actorId = norm(body.actorId || (auth === "cron" ? "system:weekly-gamification" : ""));
    const actorRoles = Array.isArray(body.actorRoles) ? body.actorRoles.map(norm) : [];

    if (trigger === "cron") {
      if (auth !== "cron") throw new Error("ACCESS_DENIED");
    } else {
      if (auth !== "app" || !actorId || !actorRoles.includes("Owner")) {
        throw new Error("OWNER_REQUIRED");
      }
    }

    const week = action === "finalize_previous_week"
      ? previousWeek()
      : { start: validDateKey(body.weekStart), end: addDays(validDateKey(body.weekStart), 6) };
    const result = await finalizeWeek(tenant, {
      weekStart: week.start,
      trigger,
      actorId,
    });
    return response({ ok: true, tenant, ...result });
  } catch (error) {
    console.error("relife-weekly-gamification-finalizer", error);
    const message = error instanceof Error ? error.message : "EDGE_FAILED";
    return response({ ok: false, error: message }, errorStatus(message));
  }
});
