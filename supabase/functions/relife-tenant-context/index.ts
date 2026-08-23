import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";

// Same server-to-server key rotation hashes used by the existing protected
// Relife Edge endpoints. The raw secret remains only in server environments.
const SERVER_KEY_HASHES = new Set([
  "efbaa7cde590048b656a566db1e0a8b09c8ad4d3b251c62116949de8eabf3027",
  "dc57fe48d7ab3b3f9bb93ac6b1559baf3c29dc71ffee728c2b9c45160c748281",
]);

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
if (!dbUrl) throw new Error("SUPABASE_DB_URL missing");
const sql = postgres(dbUrl, { prepare: false, max: 3, idle_timeout: 20 });

type Body = { staffId?: unknown };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function authorized(request: Request): Promise<boolean> {
  const key = request.headers.get("x-relife-lock-key")?.trim() || "";
  if (!key) return false;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key)
  );
  return SERVER_KEY_HASHES.has(hex(digest));
}

function validStaffId(value: unknown): string | null {
  const staffId = String(value ?? "").trim();
  return /^[A-Za-z0-9_-]{2,64}$/.test(staffId) ? staffId : null;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }
  if (!(await authorized(request))) {
    return json({ ok: false, error: "ACCESS_DENIED" }, 401);
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const staffId = validStaffId(body.staffId);
    if (!staffId) return json({ ok: false, error: "INVALID_STAFF_ID" }, 400);

    const rows = await sql`
      select
        b.organization_id,
        o.slug as organization_slug,
        o.name as organization_name,
        b.clinic_id,
        c.slug as clinic_slug,
        c.name as clinic_name,
        c.timezone,
        b.is_default
      from relife.staff_tenant_bindings b
      join relife.organizations o
        on o.id = b.organization_id
       and o.status = 'active'
      join relife.clinics c
        on c.id = b.clinic_id
       and c.organization_id = b.organization_id
       and c.status = 'active'
      where b.staff_id = ${staffId}
        and b.status = 'active'
      order by b.is_default desc, c.slug asc
    `;

    if (rows.length === 0) {
      return json({ ok: false, error: "TENANT_BINDING_NOT_FOUND" }, 404);
    }

    const defaults = rows.filter((row) => row.is_default === true);
    if (defaults.length !== 1) {
      return json({ ok: false, error: "TENANT_BINDING_AMBIGUOUS" }, 409);
    }

    const selected = defaults[0];
    return json({
      ok: true,
      staffId,
      tenant: {
        organizationId: String(selected.organization_id),
        organizationSlug: String(selected.organization_slug),
        organizationName: String(selected.organization_name),
        clinicId: String(selected.clinic_id),
        clinicSlug: String(selected.clinic_slug),
        clinicName: String(selected.clinic_name),
        timezone: String(selected.timezone || "Asia/Dhaka"),
      },
    });
  } catch (error) {
    console.error("relife-tenant-context", error);
    return json({ ok: false, error: "TENANT_CONTEXT_UNAVAILABLE" }, 503);
  }
});
