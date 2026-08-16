import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
if (!dbUrl) throw new Error("SUPABASE_DB_URL missing");
const sql = postgres(dbUrl, { prepare: false, max: 3, idle_timeout: 20 });

const SERVER_KEY_HASH = "50840a8a74de86a912cb2a268ff6d24b2a9fc3cf4ab016229e52d3219a3772fe";
const DEFAULT_ORGANIZATION_SLUG = "relife";
const DEFAULT_CLINIC_SLUG = "amtali-main";
const ACTIVE = ["scheduled", "received", "arrived", "waiting", "in treatment"];
const STATIONS = new Set(["BED-1", "BED-2", "BED-3", "BED-4", "TRACTION-BED"]);

type Tenant = { organizationId: string; clinicId: string };

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function norm(value: unknown) {
  return String(value ?? "").trim();
}

function lower(value: unknown) {
  return norm(value).toLowerCase();
}

function overlaps(a1: number, a2: number, b1: number, b2: number) {
  return a1 < b2 && a2 > b1;
}

function roomForBed(id: string) {
  if (id === "BED-1" || id === "BED-2") return "Room 1";
  if (id === "BED-3" || id === "BED-4") return "Room 2";
  if (id === "TRACTION-BED") return "Traction Room";
  return "";
}

function bedLabel(id: string) {
  if (id === "TRACTION-BED") return "Traction Bed";
  const match = /^BED-([1-4])$/.exec(id);
  return match ? `Bed ${match[1]}` : id;
}

function flowTag(
  remarks: string,
  gender: string,
  room: string,
  stationId: string
) {
  const clean = norm(remarks).replace(/\[PTFLOW\s+[^\]]+\]/gi, "").trim();
  const station = stationId === "TRACTION-BED" ? "Traction" : "Treatment";
  const tag = `[PTFLOW gender=${gender};room=${room};bed=${bedLabel(stationId)};station=${station}]`;
  return `${clean} ${tag}`.trim();
}

async function sha256Hex(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function authorized(req: Request) {
  const key = req.headers.get("x-relife-server-key") || "";
  return Boolean(key) && (await sha256Hex(key)) === SERVER_KEY_HASH;
}

async function resolveTenant(body: Record<string, unknown>): Promise<Tenant> {
  const organizationSlug = norm(body.organizationSlug || DEFAULT_ORGANIZATION_SLUG);
  const clinicSlug = norm(body.clinicSlug || DEFAULT_CLINIC_SLUG);
  const rows = await sql`
    select o.id::text as organization_id, c.id::text as clinic_id
    from relife.organizations o
    join relife.clinics c on c.organization_id=o.id
    where o.slug=${organizationSlug}
      and c.slug=${clinicSlug}
      and lower(o.status)='active'
      and lower(c.status)='active'
    limit 1
  `;
  if (!rows[0]) throw new Error("TENANT_NOT_FOUND");
  return {
    organizationId: norm(rows[0].organization_id),
    clinicId: norm(rows[0].clinic_id),
  };
}

async function appointmentForUpdate(
  executor: typeof sql,
  tenant: Tenant,
  appointmentId: string
) {
  const rows = await executor`
    select *,
      extract(hour from start_time)::int * 60 + extract(minute from start_time)::int as start_minute
    from relife.appointments
    where clinic_id=${tenant.clinicId}::uuid
      and department='Physio'
      and id=${appointmentId}
      and lower(status)=any(${ACTIVE})
    limit 1
  `;
  return rows[0] || null;
}

async function audit(
  executor: typeof sql,
  tenant: Tenant,
  actorId: string,
  action: string,
  appointmentId: string,
  patientId: string,
  payload: Record<string, unknown>
) {
  const requestId = `LIVE${crypto.randomUUID().replaceAll("-", "")}`;
  await executor`
    insert into relife.audit_events(
      organization_id, clinic_id, request_id, actor_id, action,
      entity_type, entity_id, patient_id, payload
    ) values(
      ${tenant.organizationId}::uuid, ${tenant.clinicId}::uuid,
      ${requestId}, ${actorId}, ${action}, 'Appointment', ${appointmentId},
      ${patientId}, ${JSON.stringify(payload)}::jsonb
    )
  `;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!(await authorized(req))) return response({ ok: false, error: "ACCESS_DENIED" }, 401);

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = norm(body.action || "health");
    const tenant = await resolveTenant(body);

    if (action === "health") {
      const rows = await sql`select now() as now`;
      return response({ ok: true, db: true, tenant, now: rows[0]?.now });
    }

    if (action === "assign_therapist") {
      const appointmentId = norm(body.appointmentId);
      const therapist = norm(body.therapist);
      const actorId = norm(body.actorId);
      if (!appointmentId) return response({ ok: false, error: "APPOINTMENT_NOT_FOUND" }, 404);
      if (!therapist) return response({ ok: false, error: "INVALID_THERAPIST" }, 400);
      if (!actorId) return response({ ok: false, error: "ACTOR_REQUIRED" }, 400);

      const result = await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext(${`relife-live:${tenant.clinicId}:${appointmentId}`}))`;
        const appointment = await appointmentForUpdate(tx as typeof sql, tenant, appointmentId);
        if (!appointment) return { error: "APPOINTMENT_NOT_FOUND" };
        if (norm(appointment.therapist) === therapist) {
          return { appointmentId, therapist, unchanged: true };
        }
        await tx`
          update relife.appointments
          set therapist=${therapist}, updated_by=${actorId}, updated_at=now()
          where clinic_id=${tenant.clinicId}::uuid and id=${appointmentId}
        `;
        await audit(
          tx as typeof sql,
          tenant,
          actorId,
          "CHAMBER_THERAPIST_ASSIGNED",
          appointmentId,
          norm(appointment.patient_id),
          { before: norm(appointment.therapist), after: therapist }
        );
        return { appointmentId, therapist, unchanged: false };
      });
      if ("error" in result) return response({ ok: false, error: result.error }, 404);
      return response({ ok: true, ...result });
    }

    if (action === "set_bed_preference") {
      const appointmentId = norm(body.appointmentId);
      const stationId = norm(body.stationId);
      const actorId = norm(body.actorId);
      if (!appointmentId) return response({ ok: false, error: "APPOINTMENT_NOT_FOUND" }, 404);
      if (!STATIONS.has(stationId)) return response({ ok: false, error: "STATION_NOT_FOUND" }, 404);
      if (!actorId) return response({ ok: false, error: "ACTOR_REQUIRED" }, 400);

      const result = await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext(${`relife-live-bed:${tenant.clinicId}:${appointmentId}`}))`;
        const appointment = await appointmentForUpdate(tx as typeof sql, tenant, appointmentId);
        if (!appointment) return { error: "APPOINTMENT_NOT_FOUND", status: 404 };
        const gender = norm(appointment.gender);
        if (stationId !== "TRACTION-BED" && !gender) {
          return { error: "PATIENT_GENDER_REQUIRED", status: 409 };
        }

        const resource = await tx`
          select resource_id, resource_name, room_id
          from relife.chamber_resources
          where clinic_id=${tenant.clinicId}::uuid
            and department='Physio'
            and enabled=true
            and resource_id=${stationId}
          limit 1
        `;
        if (!resource[0]) return { error: "STATION_NOT_FOUND", status: 404 };
        const roomId = norm(resource[0].room_id) || roomForBed(stationId);
        const startMinute = Number(appointment.start_minute);
        const endMinute = startMinute + Math.max(1, Number(appointment.expected_duration_min || 30));

        const existing = await tx`
          select id, patient_name, gender, bed_id,
            extract(hour from start_time)::int * 60 + extract(minute from start_time)::int as start_minute,
            expected_duration_min
          from relife.appointments
          where clinic_id=${tenant.clinicId}::uuid
            and date=${appointment.date}::date
            and department='Physio'
            and id <> ${appointmentId}
            and lower(status)=any(${ACTIVE})
        `;
        for (const row of existing) {
          const otherStart = Number(row.start_minute);
          const otherEnd = otherStart + Math.max(1, Number(row.expected_duration_min || 30));
          if (!overlaps(startMinute, endMinute, otherStart, otherEnd)) continue;
          if (norm(row.bed_id) === stationId) {
            return { error: `CHAMBER_CAPACITY:STATION_BUSY:${norm(row.patient_name)}`, status: 409 };
          }
          if (
            stationId !== "TRACTION-BED" &&
            norm(row.bed_id) !== "TRACTION-BED" &&
            roomForBed(norm(row.bed_id)) === roomId &&
            norm(row.gender) &&
            lower(row.gender) !== lower(gender)
          ) {
            return { error: `CHAMBER_CAPACITY:ROOM_GENDER:${norm(row.gender)}`, status: 409 };
          }
        }

        const nextRemarks = flowTag(norm(appointment.remarks), gender, roomId, stationId);
        const unchanged = norm(appointment.bed_id) === stationId && norm(appointment.remarks) === nextRemarks;
        if (!unchanged) {
          await tx`
            update relife.appointments
            set bed_id=${stationId}, remarks=${nextRemarks}, updated_by=${actorId}, updated_at=now()
            where clinic_id=${tenant.clinicId}::uuid and id=${appointmentId}
          `;
          await tx`
            update relife.treatment_timeline
            set bed_id=${stationId}, updated_at=now()
            where clinic_id=${tenant.clinicId}::uuid and appointment_id=${appointmentId}
          `;
          await tx`
            update relife.machine_reservations
            set bed_id=${stationId}, updated_at=now()
            where clinic_id=${tenant.clinicId}::uuid and appointment_id=${appointmentId}
          `;
          await audit(
            tx as typeof sql,
            tenant,
            actorId,
            "CHAMBER_BED_PREFERENCE_SET",
            appointmentId,
            norm(appointment.patient_id),
            { before: norm(appointment.bed_id), after: stationId, roomId }
          );
        }
        return { appointmentId, stationId, unchanged };
      });

      if ("error" in result) {
        return response({ ok: false, error: result.error }, Number(result.status || 409));
      }
      return response({ ok: true, ...result });
    }

    return response({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    console.error("relife-live-chamber-api", error);
    return response(
      { ok: false, error: error instanceof Error ? error.message : "EDGE_FAILED" },
      500
    );
  }
});
