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

function validRequestId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,160}$/.test(value);
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
    const xpAwarded = Number(body.xpAwarded ?? 0);
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
    if (!Number.isFinite(xpAwarded) || xpAwarded < 0) {
      return response({ ok: false, error: "INVALID_XP" }, 400);
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
          ${JSON.stringify(payload)}::jsonb
        )
        returning id::text
      `;
      const eventId = norm(eventRows[0]?.id);
      if (!eventId) throw new Error("PERFORMANCE_EVENT_INSERT_FAILED");

      if (xpAwarded > 0) {
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
            'v2'
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
