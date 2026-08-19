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
const DEPARTMENTS = new Set(["Physio", "Dental"]);

type Tenant = { organizationId: string; clinicId: string };
type XpRule = {
  mode: "per_event" | "every_n";
  xp: number;
  n: number;
  configVersion: number;
};

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function norm(value: unknown): string {
  return String(value ?? "").trim();
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function validRequestId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,160}$/.test(value);
}

function validDateKey(value: unknown): string {
  const text = norm(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("INVALID_DATE");
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error("INVALID_DATE");
  }
  return text;
}

function validateWeek(start: string, end: string): void {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (endMs - startMs !== 6 * 24 * 60 * 60 * 1000) {
    throw new Error("INVALID_WEEK_RANGE");
  }
}

async function sha256Hex(value: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
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
  const organizationSlug = norm(
    body.organizationSlug || DEFAULT_ORGANIZATION_SLUG
  );
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

async function activeConfig(
  tenant: Tenant,
  requestedDepartment: string
): Promise<Record<string, unknown>> {
  const department = DEPARTMENTS.has(requestedDepartment)
    ? requestedDepartment
    : "All";
  const rows = await sql`
    select distinct on (config_key)
      config_key,
      version,
      department,
      config_value
    from relife.gamification_config
    where clinic_id = ${tenant.clinicId}::uuid
      and status = 'active'
      and department in ('All', ${department})
      and effective_from <= now()
      and (effective_until is null or effective_until > now())
    order by
      config_key,
      case when department = ${department} then 0 else 1 end,
      version desc
  `;

  const configs: Record<string, unknown> = {};
  const versions: Record<string, number> = {};
  for (const row of rows) {
    const key = norm(row.config_key);
    if (!key) continue;
    configs[key] = row.config_value;
    versions[key] = Number(row.version || 0);
  }
  return { department, configs, versions };
}

async function activeXpRule(input: {
  tenant: Tenant;
  department: string;
  eventType: string;
  roleContext: string;
}): Promise<XpRule | null> {
  const rows = await sql`
    select version, config_value
    from relife.gamification_config
    where clinic_id = ${input.tenant.clinicId}::uuid
      and status = 'active'
      and config_key = 'xp.rules'
      and department in ('All', ${input.department})
      and effective_from <= now()
      and (effective_until is null or effective_until > now())
    order by
      case when department = ${input.department} then 0 else 1 end,
      version desc
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  const config = jsonObject(row.config_value);
  const rules = Array.isArray(config.rules) ? config.rules : [];

  for (const raw of rules) {
    const rule = jsonObject(raw);
    if (norm(rule.event_type) !== input.eventType) continue;
    const roles = Array.isArray(rule.roles) ? rule.roles.map(norm) : [];
    if (!roles.includes(input.roleContext)) continue;

    const xp = positiveNumber(rule.xp);
    const mode = norm(rule.mode);
    if (!xp || (mode !== "per_event" && mode !== "every_n")) return null;
    if (mode === "per_event") {
      return {
        mode,
        xp,
        n: 1,
        configVersion: Number(row.version || 0),
      };
    }

    const n = Number(rule.n);
    if (!Number.isInteger(n) || n <= 0) return null;
    return {
      mode,
      xp,
      n,
      configVersion: Number(row.version || 0),
    };
  }

  return null;
}

async function staffSummary(
  tenant: Tenant,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const staffId = norm(body.staffId);
  if (!staffId) throw new Error("STAFF_REQUIRED");
  const weekStart = validDateKey(body.weekStart);
  const weekEnd = validDateKey(body.weekEnd);
  const today = validDateKey(body.today);
  validateWeek(weekStart, weekEnd);

  const [xpRows, creditRows, eventRows, weeklyRows] = await Promise.all([
    sql`
      select
        coalesce(sum(x.xp_awarded), 0)::numeric as lifetime_xp,
        coalesce(sum(x.xp_awarded) filter (
          where (e.event_at at time zone 'Asia/Dhaka')::date
            between ${weekStart}::date and ${weekEnd}::date
        ), 0)::numeric as week_xp,
        coalesce(sum(x.xp_awarded) filter (
          where (e.event_at at time zone 'Asia/Dhaka')::date = ${today}::date
        ), 0)::numeric as today_xp
      from relife.xp_ledger x
      join relife.performance_events e
        on e.id = x.performance_event_id
       and e.clinic_id = x.clinic_id
       and e.organization_id = x.organization_id
      where x.clinic_id = ${tenant.clinicId}::uuid
        and x.staff_id = ${staffId}
    `,
    sql`
      select
        coalesce(sum(
          case
            when entry_type in ('earned','refunded','adjustment_credit') then credit_amount
            when entry_type in ('redeemed','expired','adjustment_debit') then -credit_amount
            else 0
          end
        ), 0)::numeric as ledger_balance,
        coalesce(sum(
          case
            when entry_type = 'reserved' then credit_amount
            when entry_type in ('released','redeemed') then -credit_amount
            else 0
          end
        ), 0)::numeric as reserved_balance
      from relife.reward_credit_ledger
      where clinic_id = ${tenant.clinicId}::uuid
        and staff_id = ${staffId}
    `,
    sql`
      select event_type, role_context, count(*)::int as event_count
      from relife.performance_events
      where clinic_id = ${tenant.clinicId}::uuid
        and staff_id = ${staffId}
      group by event_type, role_context
      order by event_type, role_context
    `,
    sql`
      select
        week_start::text,
        week_end::text,
        normalized_score::numeric,
        ranking_position,
        status,
        calculation_version
      from relife.weekly_performance
      where clinic_id = ${tenant.clinicId}::uuid
        and staff_id = ${staffId}
        and week_start = ${weekStart}::date
      limit 1
    `,
  ]);

  const lifetimeXp = Number(xpRows[0]?.lifetime_xp || 0);
  const weekXp = Number(xpRows[0]?.week_xp || 0);
  const todayXp = Number(xpRows[0]?.today_xp || 0);
  const ledgerBalance = Number(creditRows[0]?.ledger_balance || 0);
  const reservedBalance = Number(creditRows[0]?.reserved_balance || 0);
  const availableBalance = ledgerBalance - reservedBalance;
  const valid =
    Number.isFinite(ledgerBalance) &&
    Number.isFinite(reservedBalance) &&
    ledgerBalance >= 0 &&
    reservedBalance >= 0 &&
    availableBalance >= 0;

  const weekly = weeklyRows[0]
    ? {
        weekStart: norm(weeklyRows[0].week_start),
        weekEnd: norm(weeklyRows[0].week_end),
        normalizedScore: Number(weeklyRows[0].normalized_score),
        rank:
          weeklyRows[0].ranking_position === null
            ? null
            : Number(weeklyRows[0].ranking_position),
        status: norm(weeklyRows[0].status),
        calculationVersion: norm(weeklyRows[0].calculation_version),
      }
    : null;

  return {
    staffId,
    lifetimeXp,
    weekXp,
    todayXp,
    rewardCredits: {
      ledgerBalance,
      reservedBalance,
      availableBalance,
      valid,
    },
    eventCounts: eventRows.map((row) => ({
      eventType: norm(row.event_type),
      roleContext: norm(row.role_context),
      count: Number(row.event_count || 0),
    })),
    weeklyPerformance: weekly,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }
  if (!(await authorized(req))) {
    return response({ ok: false, error: "ACCESS_DENIED" }, 401);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = norm(body.action || "health");
    const tenant = await resolveTenant(body);

    if (action === "health") {
      const rows = await sql`
        select
          (select count(*)::int from relife.performance_events where clinic_id = ${tenant.clinicId}::uuid) as performance_events,
          (select count(*)::int from relife.xp_ledger where clinic_id = ${tenant.clinicId}::uuid) as xp_entries,
          (select count(*)::int from relife.reward_credit_ledger where clinic_id = ${tenant.clinicId}::uuid) as reward_credit_entries,
          (select count(*)::int from relife.gamification_config where clinic_id = ${tenant.clinicId}::uuid and status = 'active') as active_configs
      `;
      return response({
        ok: true,
        db: true,
        tenant,
        counts: rows[0] || {},
      });
    }

    if (action === "config") {
      const result = await activeConfig(tenant, norm(body.department));
      return response({ ok: true, tenant, ...result });
    }

    if (action === "staff_summary") {
      const result = await staffSummary(tenant, body);
      return response({ ok: true, tenant, ...result });
    }

    if (action !== "record_verified_event") {
      return response({ ok: false, error: "INVALID_ACTION" }, 400);
    }

    const requestId = norm(body.requestId);
    const staffId = norm(body.staffId);
    const department = norm(body.department);
    const roleContext = norm(body.roleContext);
    const eventType = norm(body.eventType);
    const eventKey = norm(body.eventKey);
    const sourceType = norm(body.sourceType);
    const sourceId = norm(body.sourceId);
    const eventAt = norm(body.eventAt);
    const verifiedBy = norm(body.verifiedBy || "system");
    const verificationMethod = norm(body.verificationMethod || "canonical_data");
    const reason = norm(body.reason || eventType);
    const actorId = norm(body.actorId || verifiedBy || "system");
    const metricValue = Number(body.metricValue ?? 1);
    const qualityRaw = body.qualityScore;
    const qualityScore =
      qualityRaw === null || qualityRaw === undefined || qualityRaw === ""
        ? null
        : Number(qualityRaw);
    const payload = jsonObject(body.payload);

    if (!validRequestId(requestId)) {
      return response({ ok: false, error: "INVALID_REQUEST_ID" }, 400);
    }
    if (!staffId || !roleContext || !eventType || !eventKey || !sourceType || !sourceId || !eventAt) {
      return response({ ok: false, error: "INVALID_PERFORMANCE_EVENT" }, 400);
    }
    if (!DEPARTMENTS.has(department)) {
      return response({ ok: false, error: "INVALID_DEPARTMENT" }, 400);
    }
    if (!Number.isFinite(metricValue) || metricValue < 0) {
      return response({ ok: false, error: "INVALID_METRIC_VALUE" }, 400);
    }
    if (
      qualityScore !== null &&
      (!Number.isFinite(qualityScore) || qualityScore < 0 || qualityScore > 100)
    ) {
      return response({ ok: false, error: "INVALID_QUALITY_SCORE" }, 400);
    }
    if (Number.isNaN(Date.parse(eventAt))) {
      return response({ ok: false, error: "INVALID_EVENT_AT" }, 400);
    }

    const xpRule = await activeXpRule({
      tenant,
      department,
      eventType,
      roleContext,
    });

    const result = await sql.begin(async (tx) => {
      await tx`
        select pg_advisory_xact_lock(
          hashtext(${`relife-gamification:${tenant.clinicId}:${eventKey}`})
        )
      `;

      const existing = await tx`
        select id::text
        from relife.performance_events
        where clinic_id = ${tenant.clinicId}::uuid
          and event_key = ${eventKey}
        limit 1
      `;
      if (existing[0]) {
        const existingXp = await tx`
          select coalesce(sum(xp_awarded), 0)::numeric as xp_awarded
          from relife.xp_ledger
          where clinic_id = ${tenant.clinicId}::uuid
            and performance_event_id = ${norm(existing[0].id)}::uuid
        `;
        return {
          eventId: norm(existing[0].id),
          xpAwarded: Number(existingXp[0]?.xp_awarded || 0),
          duplicate: true,
        };
      }

      if (xpRule) {
        await tx`
          select pg_advisory_xact_lock(
            hashtext(${`relife-xp-rule:${tenant.clinicId}:${staffId}:${roleContext}:${eventType}`})
          )
        `;
      }

      const storedPayload = {
        ...payload,
        gamification: {
          xpRuleVersion: xpRule?.configVersion ?? null,
          xpRuleMode: xpRule?.mode ?? null,
          xpRuleEveryN: xpRule?.mode === "every_n" ? xpRule.n : null,
        },
      };

      const eventRows = await tx`
        insert into relife.performance_events(
          organization_id,
          clinic_id,
          staff_id,
          department,
          role_context,
          event_type,
          event_key,
          source_type,
          source_id,
          event_at,
          metric_value,
          quality_score,
          verified_by,
          verification_method,
          payload
        ) values (
          ${tenant.organizationId}::uuid,
          ${tenant.clinicId}::uuid,
          ${staffId},
          ${department},
          ${roleContext},
          ${eventType},
          ${eventKey},
          ${sourceType},
          ${sourceId},
          ${eventAt}::timestamptz,
          ${metricValue},
          ${qualityScore},
          ${verifiedBy},
          ${verificationMethod},
          ${JSON.stringify(storedPayload)}::jsonb
        )
        returning id::text
      `;
      const eventId = norm(eventRows[0]?.id);
      if (!eventId) throw new Error("PERFORMANCE_EVENT_INSERT_FAILED");

      let xpAwarded = 0;
      if (xpRule?.mode === "per_event") {
        xpAwarded = xpRule.xp;
      } else if (xpRule?.mode === "every_n") {
        const countRows = await tx`
          select count(*)::int as event_count
          from relife.performance_events
          where clinic_id = ${tenant.clinicId}::uuid
            and staff_id = ${staffId}
            and role_context = ${roleContext}
            and event_type = ${eventType}
        `;
        const eventCount = Number(countRows[0]?.event_count || 0);
        if (eventCount > 0 && eventCount % xpRule.n === 0) {
          xpAwarded = xpRule.xp;
        }
      }

      if (xpAwarded > 0 && xpRule) {
        await tx`
          insert into relife.xp_ledger(
            organization_id,
            clinic_id,
            staff_id,
            department,
            role_context,
            performance_event_id,
            xp_awarded,
            reason,
            calculation_version
          ) values (
            ${tenant.organizationId}::uuid,
            ${tenant.clinicId}::uuid,
            ${staffId},
            ${department},
            ${roleContext},
            ${eventId}::uuid,
            ${xpAwarded},
            ${reason},
            ${`v2:xp.rules:${xpRule.configVersion}`}
          )
        `;
      }

      await tx`
        insert into relife.audit_events(
          organization_id,
          clinic_id,
          request_id,
          actor_id,
          action,
          entity_type,
          entity_id,
          patient_id,
          payload
        ) values (
          ${tenant.organizationId}::uuid,
          ${tenant.clinicId}::uuid,
          ${requestId},
          ${actorId},
          'gamification.performance_event.record',
          'PerformanceEvent',
          ${eventId},
          '',
          ${JSON.stringify({
            staffId,
            department,
            roleContext,
            eventType,
            eventKey,
            sourceType,
            sourceId,
            metricValue,
            qualityScore,
            xpAwarded,
            xpRuleVersion: xpRule?.configVersion ?? null,
            reason,
          })}::jsonb
        )
      `;

      return { eventId, xpAwarded, duplicate: false };
    });

    return response({ ok: true, ...result });
  } catch (error) {
    console.error("relife-gamification-api", error);
    const message = error instanceof Error ? error.message : "EDGE_FAILED";
    return response({ ok: false, error: message }, 500);
  }
});
