import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
if (!dbUrl) throw new Error("SUPABASE_DB_URL missing");
const sql = postgres(dbUrl, { prepare: false, max: 3, idle_timeout: 20 });

const SERVER_KEY_HASH =
  "50840a8a74de86a912cb2a268ff6d24b2a9fc3cf4ab016229e52d3219a3772fe";
const DEFAULT_ORGANIZATION_SLUG = "relife";
const DEFAULT_CLINIC_SLUG = "amtali-main";
const DEPARTMENTS = new Set(["Physio", "Dental"]);
const ENTITY_TYPES = new Set([
  "Payment",
  "Expense",
  "CashMovement",
  "SalaryPayment",
]);
const EVENT_ACTIONS = new Set([
  "finance.payment.create",
  "finance.expense.request",
  "finance.expense.approve",
  "finance.expense.reject",
  "finance.expense.pay",
  "finance.cash.request",
  "finance.cash.accept",
  "finance.cash.reject",
  "finance.salary.pay",
]);

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

function validRequestId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,160}$/.test(value);
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
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
  return (await sha256Hex(key)) === SERVER_KEY_HASH;
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
          count(*)::int as finance_operations,
          count(*) filter (where updated_at > now() - interval '24 hours')::int as last_24h
        from relife.finance_operations
        where organization_id = ${tenant.organizationId}::uuid
          and clinic_id = ${tenant.clinicId}::uuid
      `;
      return response({
        ok: true,
        db: true,
        tenant,
        financeOperations: Number(rows[0]?.finance_operations || 0),
        last24h: Number(rows[0]?.last_24h || 0),
      });
    }

    if (action !== "record") {
      return response({ ok: false, error: "INVALID_ACTION" }, 400);
    }

    const requestId = norm(body.requestId);
    const eventAction = norm(body.eventAction || body.financeAction);
    const entityType = norm(body.entityType);
    const entityId = norm(body.entityId);
    const department = norm(body.department);
    const status = norm(body.status);
    const actorId = norm(body.actorId);
    const patientId = norm(body.patientId);
    const staffId = norm(body.staffId);
    const amount = Number(body.amount || 0);
    const payload = jsonObject(body.payload);

    if (!validRequestId(requestId)) {
      return response({ ok: false, error: "INVALID_REQUEST_ID" }, 400);
    }
    if (!EVENT_ACTIONS.has(eventAction)) {
      return response({ ok: false, error: "INVALID_FINANCE_ACTION" }, 400);
    }
    if (!ENTITY_TYPES.has(entityType)) {
      return response({ ok: false, error: "INVALID_ENTITY_TYPE" }, 400);
    }
    if (!DEPARTMENTS.has(department)) {
      return response({ ok: false, error: "INVALID_DEPARTMENT" }, 400);
    }
    if (!entityId || !status || !actorId) {
      return response({ ok: false, error: "INVALID_FINANCE_RECORD" }, 400);
    }
    if (!Number.isFinite(amount) || amount < 0) {
      return response({ ok: false, error: "INVALID_AMOUNT" }, 400);
    }

    const result = await sql.begin(async (tx) => {
      await tx`
        select pg_advisory_xact_lock(
          hashtext(${`relife-finance:${tenant.organizationId}:${tenant.clinicId}:${requestId}:${eventAction}`})
        )
      `;

      const duplicateAudit = await tx`
        select entity_id
        from relife.audit_events
        where organization_id = ${tenant.organizationId}::uuid
          and clinic_id = ${tenant.clinicId}::uuid
          and request_id = ${requestId}
          and action = ${eventAction}
        limit 1
      `;
      if (duplicateAudit[0]) {
        const existing = await tx`
          select *
          from relife.finance_operations
          where organization_id = ${tenant.organizationId}::uuid
            and clinic_id = ${tenant.clinicId}::uuid
            and entity_type = ${entityType}
            and entity_id = ${norm(duplicateAudit[0].entity_id)}
          limit 1
        `;
        return {
          operation: existing[0] || null,
          duplicate: true,
        };
      }

      const existing = await tx`
        select *
        from relife.finance_operations
        where organization_id = ${tenant.organizationId}::uuid
          and clinic_id = ${tenant.clinicId}::uuid
          and entity_type = ${entityType}
          and entity_id = ${entityId}
        limit 1
        for update
      `;

      let operation;
      if (existing[0]) {
        const rows = await tx`
          update relife.finance_operations
          set
            department = ${department},
            status = ${status},
            amount = case
              when ${amount}::numeric > 0 then ${amount}
              else amount
            end,
            actor_id = ${actorId},
            patient_id = case
              when ${patientId} <> '' then ${patientId}
              else patient_id
            end,
            staff_id = case
              when ${staffId} <> '' then ${staffId}
              else staff_id
            end,
            payload = payload || ${JSON.stringify(payload)}::jsonb,
            updated_at = now()
          where id = ${norm(existing[0].id)}::uuid
            and organization_id = ${tenant.organizationId}::uuid
            and clinic_id = ${tenant.clinicId}::uuid
          returning *
        `;
        operation = rows[0];
      } else {
        const rows = await tx`
          insert into relife.finance_operations(
            organization_id,
            clinic_id,
            department,
            entity_type,
            entity_id,
            status,
            amount,
            actor_id,
            patient_id,
            staff_id,
            payload
          ) values (
            ${tenant.organizationId}::uuid,
            ${tenant.clinicId}::uuid,
            ${department},
            ${entityType},
            ${entityId},
            ${status},
            ${amount},
            ${actorId},
            ${patientId},
            ${staffId},
            ${JSON.stringify(payload)}::jsonb
          )
          returning *
        `;
        operation = rows[0];
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
          payload,
          created_at
        ) values (
          ${tenant.organizationId}::uuid,
          ${tenant.clinicId}::uuid,
          ${requestId},
          ${actorId},
          ${eventAction},
          ${entityType},
          ${entityId},
          ${patientId},
          ${JSON.stringify({
            department,
            status,
            amount,
            staffId,
            ...payload,
          })}::jsonb,
          now()
        )
      `;

      return { operation, duplicate: false };
    });

    if (!result.operation) {
      return response({ ok: false, error: "FINANCE_OPERATION_NOT_FOUND" }, 500);
    }

    return response({
      ok: true,
      entityId: norm(result.operation.entity_id),
      status: norm(result.operation.status),
      duplicate: result.duplicate,
    });
  } catch (error) {
    console.error("relife-finance-api", error);
    const message = error instanceof Error ? error.message : "EDGE_FAILED";
    return response({ ok: false, error: message }, 500);
  }
});